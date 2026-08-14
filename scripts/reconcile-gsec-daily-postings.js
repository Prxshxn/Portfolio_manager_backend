/**
 * Recomputes GSec daily accrual / amortization for a given entry date using the current
 * (corrected) EOD logic and reconciles it against what is actually in ledger_entries.
 *
 * Use after an EOD run that posted on a stale balance -- typically because a sell or
 * buyback that is approved but not yet value-dated had already written
 * gsec.remaining_face_value down, so the lot stopped accruing before its value date.
 *
 * Differences are reported; with --apply each differing deal's accrual/amortization
 * pair for that date is deleted and reposted at the corrected amount, so exactly one
 * clean pair remains. Removed rows are copied to a backup table first and the run
 * refuses to commit if the day would not balance.
 *
 *   node scripts/reconcile-gsec-daily-postings.js 2026-08-13
 *   node scripts/reconcile-gsec-daily-postings.js 2026-08-13 --apply
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

const DAY = (process.argv[2] || '').match(/^\d{4}-\d{2}-\d{2}$/) ? process.argv[2] : null;
const APPLY = process.argv.includes('--apply');
const TOLERANCE = 0.005;

if (!DAY) {
  console.error('Usage: node scripts/reconcile-gsec-daily-postings.js YYYY-MM-DD [--apply]');
  process.exit(1);
}
const BACKUP_TABLE = `ledger_entries_bkp_recon_${DAY.replace(/-/g, '')}`;

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

async function loadAccrualCandidates() {
  const [rows] = await db.query(
    `SELECT g.id, g.deal_number, g.value_date, g.coupon_interest, g.maturity_date, g.face_value,
            g.remaining_face_value, g.isin_number, g.clean_price,
            im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g
     LEFT JOIN isin_master im
       ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.transaction_type = 'Buy'
       AND g.status = 'final_approved'
       AND COALESCE(g.matured, 0) = 0
       AND DATE(g.maturity_date) > DATE(?)
       AND g.value_date IS NOT NULL
       AND DATE(g.value_date) <= DATE(?)
       AND (g.coupon_interest IS NOT NULL AND g.coupon_interest > 0
            OR im.coupon_rate IS NOT NULL AND im.coupon_rate > 0)
       AND NOT (
         g.buyback_deal_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM buyback_deals bd
           WHERE bd.id = g.buyback_deal_id
             AND bd.leg1_transaction_type = 'Buy' AND bd.leg2_transaction_type = 'Sell'
         )
       )`,
    [DAY, DAY]
  );
  return rows;
}

async function loadAmortCandidates() {
  const [rows] = await db.query(
    `SELECT g.id, g.deal_number, g.value_date, g.maturity_date, g.face_value,
            g.remaining_face_value, g.clean_price
     FROM gsec g
     WHERE g.transaction_type = 'Buy'
       AND g.status = 'final_approved'
       AND COALESCE(g.matured, 0) = 0
       AND DATE(g.maturity_date) > DATE(?)
       AND g.value_date IS NOT NULL
       AND DATE(g.value_date) <= DATE(?)
       AND (
         COALESCE(g.remaining_face_value, g.face_value, 0) > 0
         OR EXISTS (
           SELECT 1 FROM buyback_deals bd_pending
           WHERE bd_pending.deal_status = 'Approved'
             AND bd_pending.leg1_transaction_type = 'Sell'
             AND bd_pending.leg1_value_date IS NOT NULL
             AND DATE(bd_pending.leg1_value_date) > DATE(?)
             AND (
               TRIM(COALESCE(bd_pending.source_buy_deal_number, '')) = TRIM(g.deal_number)
               OR bd_pending.sell_deal_allocations LIKE CONCAT('%', TRIM(g.deal_number), '%')
             )
         )
         OR EXISTS (
           SELECT 1 FROM gsec s_pending
           WHERE s_pending.transaction_type = 'Sell'
             AND s_pending.buyback_deal_id IS NULL
             AND s_pending.value_date IS NOT NULL
             AND DATE(s_pending.value_date) > DATE(?)
             AND (
               TRIM(COALESCE(s_pending.buy_deal_number, '')) = TRIM(g.deal_number)
               OR s_pending.sell_deal_allocations LIKE CONCAT('%', TRIM(g.deal_number), '%')
             )
         )
       )
       AND NOT (
         g.buyback_deal_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM buyback_deals bd_letter
           WHERE bd_letter.id = g.buyback_deal_id
             AND bd_letter.leg1_transaction_type = 'Buy' AND bd_letter.leg2_transaction_type = 'Sell'
         )
       )`,
    [DAY, DAY, DAY, DAY]
  );
  return rows;
}

async function buildBuybackMaps(dealNumbers) {
  const dealSet = new Set(dealNumbers);
  const effective = {};
  const pending = {};
  const [rows] = await db.query(
    `SELECT leg1_face_value, TRIM(COALESCE(source_buy_deal_number, '')) AS src,
            sell_deal_allocations,
            DATE(COALESCE(leg1_value_date, approved_at)) AS eff_date
     FROM buyback_deals
     WHERE deal_status = 'Approved'
       AND leg1_transaction_type = 'Sell'
       AND COALESCE(leg1_value_date, approved_at) IS NOT NULL`
  );
  for (const b of rows) {
    const bucket = ymd(b.eff_date) <= DAY ? effective : pending;
    let allocs = b.sell_deal_allocations;
    if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch (_) { allocs = null; } }
    if (Array.isArray(allocs) && allocs.length) {
      for (const a of allocs) {
        const dn = String(a.deal_number || '').trim();
        const amt = Number(a.amountToSell) || 0;
        if (dn && amt > 0 && dealSet.has(dn)) bucket[dn] = (bucket[dn] || 0) + amt;
      }
    } else if (b.src && dealSet.has(b.src)) {
      const amt = Number(b.leg1_face_value) || 0;
      if (amt > 0) bucket[b.src] = (bucket[b.src] || 0) + amt;
    }
  }
  return { effective, pending };
}

(async () => {
  console.log(APPLY ? '*** APPLY MODE ***' : '--- DRY RUN (pass --apply to write) ---');
  console.log(`Reconciling GSec daily accrual / amortization for ${DAY}\n`);

  const accrualCands = await loadAccrualCandidates();
  const amortCands = await loadAmortCandidates();
  console.log(`Accrual candidates: ${accrualCands.length}`);
  console.log(`Amortization candidates: ${amortCands.length}`);

  const allDealNumbers = [
    ...new Set(
      [...accrualCands, ...amortCands].map((d) => String(d.deal_number || '').trim()).filter(Boolean)
    )
  ];

  const soldToDate = await buildSoldByDealMap(db, allDealNumbers, DAY);
  const soldEver = await buildSoldByDealMap(db, allDealNumbers, null);
  const pendingSold = {};
  for (const dn of allDealNumbers) {
    const diff = Number(soldEver[dn] || 0) - Number(soldToDate[dn] || 0);
    if (diff > 0) pendingSold[dn] = diff;
  }
  const bb = await buildBuybackMaps(allDealNumbers);

  const baseFor = (deal) => {
    const dn = String(deal.deal_number || '').trim();
    return resolveGsecRemainingForDailyPosting(
      Object.assign({}, deal, { linked_sold_face_value: Number(soldToDate[dn] || 0) }),
      {
        linked_buyback_face_value: Number(bb.effective[dn] || 0),
        pending_buyback_face_value: Number(bb.pending[dn] || 0),
        pending_sold_face_value: Number(pendingSold[dn] || 0)
      }
    );
  };

  // Expected postings
  const expected = new Map(); // deal_number -> { accrual, amort }
  for (const d of accrualCands) {
    const dn = String(d.deal_number || '').trim();
    const base = baseFor(d);
    const r = computeGsecPerDayAccrual(
      Object.assign({}, d, {
        remaining_face_value: base,
        linked_sold_face_value: Number(soldToDate[dn] || 0),
        linked_buyback_face_value: Number(bb.effective[dn] || 0)
      }),
      DAY,
      2
    );
    const e = expected.get(dn) || {};
    e.accrual = r.ok ? r.amount : null;
    e.base = base;
    expected.set(dn, e);
  }
  for (const d of amortCands) {
    const dn = String(d.deal_number || '').trim();
    const base = baseFor(d);
    const r =
      base > 0
        ? computeGsecDailyAmortization(Object.assign({}, d, { remaining_face_value: base }), DAY)
        : { ok: false, reason: 'no remaining face' };
    const e = expected.get(dn) || {};
    e.amort = r.ok ? r.dailyAmount : null;
    e.amortScenario = r.ok ? r.scenario : null;
    if (e.base === undefined) e.base = base;
    expected.set(dn, e);
  }

  // Actual postings
  const [actualRows] = await db.query(
    `SELECT TRIM(deal_number) AS deal_number, description, ROUND(SUM(debit_amount), 2) AS amt
     FROM ledger_entries
     WHERE DATE(entry_date) = ?
       AND (description LIKE 'GSec Daily Accrual for Deal %'
         OR description LIKE 'GSec Daily Amortization for Deal %')
     GROUP BY TRIM(deal_number), description`,
    [DAY]
  );
  const actual = new Map();
  for (const r of actualRows) {
    const e = actual.get(r.deal_number) || {};
    if (r.description.includes('Accrual')) e.accrual = Number(r.amt);
    else e.amort = Number(r.amt);
    actual.set(r.deal_number, e);
  }

  // Compare
  const diffs = [];
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const dn of keys) {
    const e = expected.get(dn) || {};
    const a = actual.get(dn) || {};
    const accDiff = Math.abs((e.accrual || 0) - (a.accrual || 0)) > TOLERANCE;
    const amDiff = Math.abs((e.amort || 0) - (a.amort || 0)) > TOLERANCE;
    if (accDiff || amDiff) diffs.push({ dn, e, a, accDiff, amDiff });
  }
  diffs.sort((x, y) => x.dn.localeCompare(y.dn));

  console.log(`\nDeals with a difference: ${diffs.length}\n`);
  let accDelta = 0;
  let amDelta = 0;
  for (const d of diffs) {
    console.log(`  ${d.dn}   base=${fmt(d.e.base)}`);
    if (d.accDiff) {
      console.log(
        `      accrual : posted=${d.a.accrual === undefined ? 'NONE' : fmt(d.a.accrual)}  ->  ${d.e.accrual === null || d.e.accrual === undefined ? 'NONE' : fmt(d.e.accrual)}`
      );
      accDelta += (d.e.accrual || 0) - (d.a.accrual || 0);
    }
    if (d.amDiff) {
      console.log(
        `      amort   : posted=${d.a.amort === undefined ? 'NONE' : fmt(d.a.amort)}  ->  ${d.e.amort === null || d.e.amort === undefined ? 'NONE' : fmt(d.e.amort)}`
      );
      amDelta += (d.e.amort || 0) - (d.a.amort || 0);
    }
  }
  console.log(`\nNet accrual change: ${fmt(accDelta)}`);
  console.log(`Net amortization change: ${fmt(amDelta)}`);

  if (!diffs.length) {
    console.log('\nNothing to correct.');
    process.exit(0);
  }
  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write these corrections.');
    process.exit(0);
  }

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

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} LIKE ledger_entries`);

    let deleted = 0;
    let inserted = 0;

    for (const d of diffs) {
      const accrualDesc = `GSec Daily Accrual for Deal ${d.dn}`;
      const amortDesc = `GSec Daily Amortization for Deal ${d.dn}`;
      const descs = [];
      if (d.accDiff) descs.push(accrualDesc);
      if (d.amDiff) descs.push(amortDesc);

      const placeholders = descs.map(() => '?').join(',');
      await conn.query(
        `INSERT INTO ${BACKUP_TABLE}
         SELECT * FROM ledger_entries
         WHERE DATE(entry_date) = ? AND TRIM(deal_number) = ? AND description IN (${placeholders})`,
        [DAY, d.dn, ...descs]
      );
      const [del] = await conn.query(
        `DELETE FROM ledger_entries
         WHERE DATE(entry_date) = ? AND TRIM(deal_number) = ? AND description IN (${placeholders})`,
        [DAY, d.dn, ...descs]
      );
      deleted += del.affectedRows;

      const post = async (drId, crId, amount, description) => {
        await conn.query(
          `INSERT INTO ledger_entries
             (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
           VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
          [DAY, drId, amount, d.dn, description]
        );
        await conn.query(
          `INSERT INTO ledger_entries
             (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
           VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
          [DAY, crId, amount, d.dn, description]
        );
        inserted += 2;
      };

      if (d.accDiff && d.e.accrual) {
        await post(accrualDrId, accrualCrId, d.e.accrual, accrualDesc);
      }
      if (d.amDiff && d.e.amort) {
        const drId = d.e.amortScenario === 'premium' ? amortTradingId : amortFaId;
        const crId = d.e.amortScenario === 'premium' ? amortFaId : amortTradingId;
        await post(drId, crId, d.e.amort, amortDesc);
      }
    }

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
