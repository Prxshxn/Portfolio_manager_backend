/**
 * One-off: deal 20260701/GSEC/0004 had remaining_face_value driven to 0 with no linked
 * sell, no buyback and no allocation record to justify it. That zero excluded the deal
 * from the EOD amortisation query and made the accrual calculation bail out with
 * "no remaining face", so 2026-08-10 posted neither accrual nor amortisation.
 *
 * The drift guard in gsecCouponPeriod.js only rescues a partially-reduced balance
 * (it requires remaining > 0), so a wrongly-zeroed balance is not recovered.
 *
 * This script restores the balance to face - sells - buybacks and backfills the
 * 2026-08-10 accrual and amortisation. It refuses to run if any real reduction exists.
 *
 *   node scripts/restore-gsec-20260701-0004-rfv-and-accrual-aug10.js
 *   node scripts/restore-gsec-20260701-0004-rfv-and-accrual-aug10.js --execute
 */
const db = require('../config/database');
const accountMapping = require('../services/accountMappingService');
const {
  computeGsecPerDayAccrual,
  computeGsecDailyAmortization
} = require('../services/gsecCouponPeriod');

const EXECUTE = process.argv.includes('--execute');
const DEAL = '20260701/GSEC/0004';
const BACKFILL_DATE = '2026-08-10';
const REFERENCE_DATE = '2026-08-09'; // last day that posted correctly

const fmt = (v) => Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

async function resolveAccountIdByCode(code) {
  const [rows] = await db.query(
    'SELECT id, account_code, name AS account_name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [code]
  );
  if (!rows.length) throw new Error(`Account not found for code: ${code}`);
  return rows[0];
}

async function main() {
  console.log(EXECUTE ? 'MODE: EXECUTE\n' : 'MODE: DRY-RUN (pass --execute to apply)\n');

  // ── 1. Load the deal
  const [rows] = await db.query(
    `SELECT g.id, g.deal_number, g.value_date, g.maturity_date, g.face_value,
            g.remaining_face_value, g.coupon_interest, g.clean_price, g.isin_number,
            g.status, g.matured, g.per_day_accrual,
            im.coupon_rate, im.coupon_date_1, im.coupon_date_2
       FROM gsec g
       LEFT JOIN isin_master im
         ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
      WHERE TRIM(g.deal_number) = TRIM(?) AND g.transaction_type = 'Buy'
      LIMIT 1`,
    [DEAL]
  );
  const deal = rows[0];
  if (!deal) throw new Error(`Buy deal not found: ${DEAL}`);

  const face = Number(deal.face_value) || 0;
  console.log(`Deal ${DEAL} (gsec id ${deal.id})`);
  console.log(`  face_value            : ${fmt(face)}`);
  console.log(`  remaining_face_value  : ${fmt(deal.remaining_face_value)}  <-- current`);
  console.log(`  clean_price           : ${deal.clean_price}`);
  console.log(`  value / maturity      : ${String(deal.value_date).slice(0, 10)} -> ${String(deal.maturity_date).slice(0, 10)}`);

  // ── 2. Prove the zero is unjustified before touching anything
  const [sellAgg] = await db.query(
    `SELECT COALESCE(SUM(face_value), 0) AS sold
       FROM gsec
      WHERE transaction_type = 'Sell'
        AND buy_deal_number IS NOT NULL
        AND TRIM(buy_deal_number) = TRIM(?)
        AND COALESCE(status, '') NOT IN ('rejected', 'cancelled')`,
    [DEAL]
  );
  const sold = Number(sellAgg[0].sold) || 0;

  const [bbRows] = await db.query(
    `SELECT deal_number, TRIM(source_buy_deal_number) AS src, leg1_face_value,
            sell_deal_allocations
       FROM buyback_deals
      WHERE deal_status = 'Approved' AND approved_at IS NOT NULL
        AND leg1_transaction_type = 'Sell'
        AND ((source_buy_deal_number IS NOT NULL AND TRIM(source_buy_deal_number) = TRIM(?))
             OR (sell_deal_allocations IS NOT NULL AND sell_deal_allocations LIKE ?))`,
    [DEAL, '%' + DEAL + '%']
  );
  let buyback = 0;
  for (const r of bbRows) {
    let allocs = r.sell_deal_allocations;
    if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch { allocs = null; } }
    if (Array.isArray(allocs) && allocs.length) {
      for (const a of allocs) {
        if (String((a && a.deal_number) || '').trim() === DEAL) {
          buyback += Number(a.amountToSell) || 0;
        }
      }
    } else if (r.src === DEAL) {
      buyback += Number(r.leg1_face_value) || 0;
    }
  }

  console.log(`\n  linked sells          : ${fmt(sold)}`);
  console.log(`  buyback deductions    : ${fmt(buyback)}`);

  if (sold > 0 || buyback > 0) {
    throw new Error(
      'ABORT: this deal has real reductions (sells or buybacks). The zero balance may be '
      + 'legitimate — do not blindly restore it. Investigate manually.'
    );
  }

  const restoredRfv = Math.max(0, face - sold - buyback);
  console.log(`  => justified balance   : ${fmt(restoredRfv)}`);
  if (Number(deal.remaining_face_value) === restoredRfv) {
    console.log('\nBalance already correct; nothing to restore.');
  }

  // ── 3. Compute the 2026-08-10 amounts on the restored balance
  const dealAtFullFace = {
    ...deal,
    remaining_face_value: restoredRfv,
    linked_sold_face_value: 0,
    linked_buyback_face_value: 0
  };
  const accrual = computeGsecPerDayAccrual(dealAtFullFace, BACKFILL_DATE, 2);
  const amort = computeGsecDailyAmortization(dealAtFullFace, BACKFILL_DATE);

  if (!accrual.ok) throw new Error(`ABORT: accrual not computable: ${accrual.reason}`);
  if (!amort.ok) throw new Error(`ABORT: amortisation not computable: ${amort.reason}`);

  console.log(`\n  computed accrual for ${BACKFILL_DATE} : ${fmt(accrual.amount)}  (E=${accrual.E})`);
  console.log(`  computed amort   for ${BACKFILL_DATE} : ${fmt(amort.dailyAmount)}  (${amort.scenario}, days=${amort.days})`);

  // ── 4. Cross-check against the last correctly-posted day so we cannot drift
  const [refAccr] = await db.query(
    `SELECT debit_amount, account_id FROM ledger_entries
      WHERE TRIM(deal_number) = TRIM(?) AND DATE(entry_date) = DATE(?)
        AND description LIKE 'GSec Daily Accrual%' AND debit_amount > 0 LIMIT 1`,
    [DEAL, REFERENCE_DATE]
  );
  const [refAmort] = await db.query(
    `SELECT debit_amount, account_id FROM ledger_entries
      WHERE TRIM(deal_number) = TRIM(?) AND DATE(entry_date) = DATE(?)
        AND description LIKE 'GSec Daily Amorti%' AND debit_amount > 0 LIMIT 1`,
    [DEAL, REFERENCE_DATE]
  );
  if (refAccr.length) {
    const diff = Math.abs(Number(refAccr[0].debit_amount) - accrual.amount);
    console.log(`  ${REFERENCE_DATE} posted accrual        : ${fmt(refAccr[0].debit_amount)}  (diff ${diff.toFixed(8)})`);
    if (diff > 0.01) throw new Error('ABORT: computed accrual disagrees with the last posted day.');
  }
  if (refAmort.length) {
    const diff = Math.abs(Number(refAmort[0].debit_amount) - amort.dailyAmount);
    console.log(`  ${REFERENCE_DATE} posted amortisation   : ${fmt(refAmort[0].debit_amount)}  (diff ${diff.toFixed(8)})`);
    if (diff > 0.01) throw new Error('ABORT: computed amortisation disagrees with the last posted day.');
  }

  // ── 5. Resolve accounts the same way EOD does, and check against history
  const accrDr = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET)
  );
  const accrCr = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME)
  );
  const amortTrading = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_AMORTISATION_TRADING)
  );
  const amortFa = await resolveAccountIdByCode(
    await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_FINANCIAL_ASSETS_AMORTISED_COST)
  );
  const amortDr = amort.scenario === 'premium' ? amortTrading : amortFa;
  const amortCr = amort.scenario === 'premium' ? amortFa : amortTrading;

  console.log('\n  accrual  Dr ' + accrDr.account_code + ' ' + accrDr.account_name);
  console.log('  accrual  Cr ' + accrCr.account_code + ' ' + accrCr.account_name);
  console.log('  amort    Dr ' + amortDr.account_code + ' ' + amortDr.account_name);
  console.log('  amort    Cr ' + amortCr.account_code + ' ' + amortCr.account_name);
  if (refAccr.length && Number(refAccr[0].account_id) !== Number(accrDr.id)) {
    console.warn('  WARNING: accrual debit account differs from ' + REFERENCE_DATE + ' postings.');
  }
  if (refAmort.length && Number(refAmort[0].account_id) !== Number(amortDr.id)) {
    console.warn('  WARNING: amortisation debit account differs from ' + REFERENCE_DATE + ' postings.');
  }

  // ── 6. Idempotency
  const [dup] = await db.query(
    `SELECT description, COUNT(*) AS ct FROM ledger_entries
      WHERE TRIM(deal_number) = TRIM(?) AND DATE(entry_date) = DATE(?)
        AND (description LIKE 'GSec Daily Accrual%' OR description LIKE 'GSec Daily Amorti%')
      GROUP BY description`,
    [DEAL, BACKFILL_DATE]
  );
  const accrualExists = dup.some((r) => /Daily Accrual/i.test(r.description));
  const amortExists = dup.some((r) => /Amorti/i.test(r.description));
  console.log(`\n  ${BACKFILL_DATE} accrual already posted : ${accrualExists}`);
  console.log(`  ${BACKFILL_DATE} amort   already posted : ${amortExists}`);

  const hasAmortCol = (await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gsec'
        AND COLUMN_NAME = 'per_day_amortization'`
  ))[0].length > 0;

  console.log('\n' + '-'.repeat(70));
  console.log('PLANNED CHANGES');
  console.log('-'.repeat(70));
  console.log(`  UPDATE gsec id=${deal.id}: remaining_face_value ${fmt(deal.remaining_face_value)} -> ${fmt(restoredRfv)}`);
  console.log(`  UPDATE gsec id=${deal.id}: per_day_accrual ${fmt(deal.per_day_accrual)} -> ${fmt(accrual.amount)}`);
  if (hasAmortCol) console.log(`  UPDATE gsec id=${deal.id}: per_day_amortization -> ${fmt(amort.dailyAmount)}`);
  if (!accrualExists) {
    console.log(`  INSERT ${BACKFILL_DATE} accrual  Dr ${accrDr.account_code} / Cr ${accrCr.account_code}  ${fmt(accrual.amount)}`);
  } else {
    console.log(`  SKIP   ${BACKFILL_DATE} accrual (already present)`);
  }
  if (!amortExists) {
    console.log(`  INSERT ${BACKFILL_DATE} amort    Dr ${amortDr.account_code} / Cr ${amortCr.account_code}  ${fmt(amort.dailyAmount)}`);
  } else {
    console.log(`  SKIP   ${BACKFILL_DATE} amortisation (already present)`);
  }

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to apply.');
    process.exit(0);
  }

  // ── 7. Apply atomically
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      'UPDATE gsec SET remaining_face_value = ?, per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?',
      [restoredRfv, accrual.amount, accrual.E, deal.id]
    );
    if (hasAmortCol) {
      await conn.query('UPDATE gsec SET per_day_amortization = ? WHERE id = ?', [amort.dailyAmount, deal.id]);
    }

    if (!accrualExists) {
      const desc = `GSec Daily Accrual for Deal ${DEAL}`;
      await conn.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
        [BACKFILL_DATE, accrDr.id, accrual.amount, DEAL, desc]
      );
      await conn.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
        [BACKFILL_DATE, accrCr.id, accrual.amount, DEAL, desc]
      );
    }

    if (!amortExists) {
      const desc = `GSec Daily Amortization for Deal ${DEAL}`;
      await conn.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
        [BACKFILL_DATE, amortDr.id, amort.dailyAmount, DEAL, desc]
      );
      await conn.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
        [BACKFILL_DATE, amortCr.id, amort.dailyAmount, DEAL, desc]
      );
    }

    await conn.commit();
    console.log('\nCommitted.');
  } catch (err) {
    await conn.rollback();
    console.error('\nRolled back:', err.message);
    throw err;
  } finally {
    conn.release();
  }

  // ── 8. Verify
  const [after] = await db.query(
    'SELECT remaining_face_value, per_day_accrual FROM gsec WHERE id = ?',
    [deal.id]
  );
  console.log(`\nremaining_face_value now: ${fmt(after[0].remaining_face_value)}`);
  console.log(`per_day_accrual now     : ${fmt(after[0].per_day_accrual)}`);

  const [check] = await db.query(
    `SELECT DATE(entry_date) AS dt, description,
            SUM(debit_amount) AS dr, SUM(credit_amount) AS cr, COUNT(*) AS ct
       FROM ledger_entries
      WHERE TRIM(deal_number) = TRIM(?)
        AND DATE(entry_date) BETWEEN '2026-08-08' AND '2026-08-11'
        AND (description LIKE 'GSec Daily%')
      GROUP BY DATE(entry_date), description
      ORDER BY dt, description`,
    [DEAL]
  );
  console.log('\nLedger 08-08 .. 08-11:');
  for (const r of check) {
    console.log('  ' + String(r.dt).slice(0, 10)
      + ' | Dr ' + fmt(r.dr).padStart(12)
      + ' | Cr ' + fmt(r.cr).padStart(12)
      + ' | rows=' + r.ct
      + ' | ' + r.description);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('\n' + e.message);
  process.exit(1);
});
