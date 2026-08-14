/**
 * Corrects GSec daily accrual / amortization for a day on which EOD deducted buyback
 * leg1 sells on their APPROVAL date instead of their leg1 VALUE date.
 *
 * The underlying code defect is fixed in routes/moneyMarketEodRoutes.js and
 * services/gsecCouponPeriod.js; this repairs the ledger for the day already posted.
 *
 * For each affected buy deal it recomputes the posting on the correct base, then
 * deletes and reposts that deal's accrual/amortization pair for the date so exactly
 * one clean pair remains. Deleted rows are copied to a backup table first.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node scripts/fix-gsec-accrual-early-buyback-20260812.js
 *   node scripts/fix-gsec-accrual-early-buyback-20260812.js --apply
 */
require('dotenv').config();
const db = require('../config/database');
const accountMapping = require('../services/accountMappingService');
const {
  computeGsecPerDayAccrual,
  computeGsecDailyAmortization,
  resolveGsecRemainingForDailyPosting
} = require('../services/gsecCouponPeriod');
const { buildSoldByDealMap } = require('../services/gsecSellDeductionService');

const DAY = '2026-08-12';
const BACKUP_TABLE = 'ledger_entries_bkp_early_bb_20260812';
const APPLY = process.argv.includes('--apply');

const fmt = (n) =>
  !Number.isFinite(Number(n))
    ? String(n)
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function resolveAccountIdByCode(code) {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [code]
  );
  if (!rows.length) throw new Error(`Account code not found in chart_of_accounts: ${code}`);
  return rows[0].id;
}

(async () => {
  console.log(`${APPLY ? '*** APPLY MODE ***' : '--- DRY RUN (pass --apply to write) ---'}`);
  console.log(`Correcting GSec accrual/amortization for ${DAY}\n`);

  // 1. Which buybacks did the run deduct early: approved on/before DAY, leg1 value date after DAY.
  const [earlyBBs] = await db.query(
    `SELECT deal_number, leg1_face_value, TRIM(source_buy_deal_number) AS source_buy_deal_number,
            sell_deal_allocations, DATE(approved_at) AS approved_on, DATE(leg1_value_date) AS leg1_vd
     FROM buyback_deals
     WHERE deal_status = 'Approved'
       AND leg1_transaction_type = 'Sell'
       AND approved_at IS NOT NULL AND DATE(approved_at) <= DATE(?)
       AND leg1_value_date IS NOT NULL AND DATE(leg1_value_date) > DATE(?)`,
    [DAY, DAY]
  );

  const affected = new Set();
  console.log(`Buybacks deducted early on ${DAY}: ${earlyBBs.length}`);
  for (const b of earlyBBs) {
    let allocs = b.sell_deal_allocations;
    if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch (_) { allocs = null; } }
    const lines = Array.isArray(allocs) && allocs.length
      ? allocs.map((a) => String(a.deal_number || '').trim())
      : [String(b.source_buy_deal_number || '').trim()];
    console.log(`  ${b.deal_number}  approved=${ymd(b.approved_on)}  leg1_value_date=${ymd(b.leg1_vd)}  -> ${lines.join(', ')}`);
    lines.filter(Boolean).forEach((dn) => affected.add(dn));
  }
  if (!affected.size) {
    console.log('\nNothing to correct.');
    process.exit(0);
  }

  // 2. Account ids, exactly as EOD resolves them.
  const accrualDrId = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET)
  );
  const accrualCrId = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME)
  );
  const amortTradingId = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_AMORTISATION_TRADING)
  );
  const amortFaId = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_FINANCIAL_ASSETS_AMORTISED_COST)
  );

  // 3. Reductions as of DAY, split into value-dated (apply) and pending (add back),
  //    mirroring the corrected EOD aggregation.
  const dealNumbers = [...affected];
  const soldByDeal = await buildSoldByDealMap(db, dealNumbers, DAY);

  const [allBBs] = await db.query(
    `SELECT leg1_face_value, TRIM(source_buy_deal_number) AS source_buy_deal_number,
            sell_deal_allocations, DATE(COALESCE(leg1_value_date, approved_at)) AS eff_date
     FROM buyback_deals
     WHERE deal_status = 'Approved'
       AND leg1_transaction_type = 'Sell'
       AND COALESCE(leg1_value_date, approved_at) IS NOT NULL`
  );
  const effective = {};
  const pending = {};
  const dealSet = new Set(dealNumbers);
  for (const b of allBBs) {
    const target = ymd(b.eff_date) <= DAY ? effective : pending;
    let allocs = b.sell_deal_allocations;
    if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch (_) { allocs = null; } }
    if (Array.isArray(allocs) && allocs.length) {
      for (const a of allocs) {
        const dn = String(a.deal_number || '').trim();
        const amt = Number(a.amountToSell) || 0;
        if (dn && amt > 0 && dealSet.has(dn)) target[dn] = (target[dn] || 0) + amt;
      }
    } else if (b.source_buy_deal_number && dealSet.has(b.source_buy_deal_number)) {
      const amt = Number(b.leg1_face_value) || 0;
      if (amt > 0) {
        target[b.source_buy_deal_number] = (target[b.source_buy_deal_number] || 0) + amt;
      }
    }
  }

  // 4. Build the correction plan.
  const plan = [];
  for (const dn of dealNumbers) {
    const [rows] = await db.query(
      `SELECT g.*, im.coupon_rate
       FROM gsec g
       LEFT JOIN isin_master im
         ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
       WHERE TRIM(g.deal_number) = ? AND g.transaction_type = 'Buy'`,
      [dn]
    );
    if (!rows.length) {
      console.log(`\n${dn}: no Buy row found, skipping`);
      continue;
    }
    const deal = rows[0];
    const sold = Number(soldByDeal[dn] || 0);
    const eff = Number(effective[dn] || 0);
    const pend = Number(pending[dn] || 0);

    const dealWithSold = Object.assign({}, deal, { linked_sold_face_value: sold });
    const remaining = resolveGsecRemainingForDailyPosting(dealWithSold, {
      linked_buyback_face_value: eff,
      pending_buyback_face_value: pend
    });

    const accrual = computeGsecPerDayAccrual(
      Object.assign({}, dealWithSold, {
        remaining_face_value: remaining,
        linked_buyback_face_value: eff
      }),
      DAY,
      2
    );
    const amort = computeGsecDailyAmortization(
      Object.assign({}, dealWithSold, { remaining_face_value: remaining }),
      DAY
    );

    const [existing] = await db.query(
      `SELECT description, ROUND(SUM(debit_amount), 2) AS amt, COUNT(*) AS n
       FROM ledger_entries
       WHERE DATE(entry_date) = ? AND TRIM(deal_number) = ?
         AND (description = ? OR description = ?)
       GROUP BY description`,
      [DAY, dn, `GSec Daily Accrual for Deal ${dn}`, `GSec Daily Amortization for Deal ${dn}`]
    );
    const postedAccrual = existing.find((e) => e.description.includes('Accrual'));
    const postedAmort = existing.find((e) => e.description.includes('Amortization'));

    console.log(`\n${dn}`);
    console.log(`  face=${fmt(deal.face_value)}  stored_remaining=${fmt(deal.remaining_face_value)}  clean_price=${deal.clean_price}`);
    console.log(`  sold(value-dated)=${fmt(sold)}  buyback(value-dated)=${fmt(eff)}  buyback(pending)=${fmt(pend)}`);
    console.log(`  corrected base for ${DAY} = ${fmt(remaining)}`);
    console.log(`  accrual : posted=${postedAccrual ? fmt(postedAccrual.amt) : 'NONE'}  ->  ${accrual.ok ? fmt(accrual.amount) : 'skip (' + accrual.reason + ')'}`);
    console.log(`  amort   : posted=${postedAmort ? fmt(postedAmort.amt) : 'NONE'}  ->  ${amort.ok ? fmt(amort.dailyAmount) + ' (' + amort.scenario + ')' : 'skip (' + amort.reason + ')'}`);

    plan.push({ dn, accrual, amort, postedAccrual, postedAmort });
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write these corrections.');
    process.exit(0);
  }

  // 5. Apply: back up, delete, repost. One transaction.
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} LIKE ledger_entries`
    );

    let deleted = 0;
    let inserted = 0;

    for (const p of plan) {
      const accrualDesc = `GSec Daily Accrual for Deal ${p.dn}`;
      const amortDesc = `GSec Daily Amortization for Deal ${p.dn}`;

      await conn.query(
        `INSERT INTO ${BACKUP_TABLE}
         SELECT * FROM ledger_entries
         WHERE DATE(entry_date) = ? AND TRIM(deal_number) = ?
           AND (description = ? OR description = ?)`,
        [DAY, p.dn, accrualDesc, amortDesc]
      );
      const [del] = await conn.query(
        `DELETE FROM ledger_entries
         WHERE DATE(entry_date) = ? AND TRIM(deal_number) = ?
           AND (description = ? OR description = ?)`,
        [DAY, p.dn, accrualDesc, amortDesc]
      );
      deleted += del.affectedRows;

      const post = async (drId, crId, amount, description) => {
        await conn.query(
          `INSERT INTO ledger_entries
             (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
           VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
          [DAY, drId, amount, p.dn, description]
        );
        await conn.query(
          `INSERT INTO ledger_entries
             (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
           VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
          [DAY, crId, amount, p.dn, description]
        );
        inserted += 2;
      };

      if (p.accrual.ok) {
        await post(accrualDrId, accrualCrId, p.accrual.amount, accrualDesc);
      }
      if (p.amort.ok) {
        const drId = p.amort.scenario === 'premium' ? amortTradingId : amortFaId;
        const crId = p.amort.scenario === 'premium' ? amortFaId : amortTradingId;
        await post(drId, crId, p.amort.dailyAmount, amortDesc);
      }
    }

    // 6. Guard: the day must still balance before committing.
    const [[bal]] = await conn.query(
      `SELECT ROUND(SUM(debit_amount) - SUM(credit_amount), 2) AS imbalance
       FROM ledger_entries WHERE DATE(entry_date) = ?`,
      [DAY]
    );
    if (Math.abs(Number(bal.imbalance)) >= 0.01) {
      throw new Error(`Refusing to commit: ${DAY} would be out of balance by ${bal.imbalance}`);
    }

    await conn.commit();
    console.log(`\nCommitted. Backed up + deleted ${deleted} rows, inserted ${inserted} rows.`);
    console.log(`Backup table: ${BACKUP_TABLE}`);
    console.log(`${DAY} imbalance after correction: ${bal.imbalance}`);
  } catch (err) {
    await conn.rollback();
    console.error('\nRolled back:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
  }

  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
