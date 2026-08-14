/**
 * One-off: post missing GSec daily accruals for 20260803/GSEC/0007 on 2026-08-03
 * and 2026-08-04. Sell 20260805/GSEC/0001 (value date 05 Aug) had zeroed RFV at
 * booking on 03 Aug, so EOD skipped this deal those days.
 *
 *   node scripts/post-gsec-0007-missing-accrual-aug3-4.js
 *   node scripts/post-gsec-0007-missing-accrual-aug3-4.js --execute
 */
const db = require('../config/database');
const accountMapping = require('../services/accountMappingService');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

const EXECUTE = process.argv.includes('--execute');
const DEAL = '20260803/GSEC/0007';
const DATES = ['2026-08-03', '2026-08-04'];

async function resolveAccountIdByCode(code) {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [code]
  );
  if (!rows.length) throw new Error(`Account not found: ${code}`);
  return rows[0].id;
}

async function soldAgainst(dealNumber, asAt) {
  const [r] = await db.query(
    `SELECT COALESCE(SUM(face_value), 0) AS s FROM gsec
     WHERE transaction_type = 'Sell'
       AND TRIM(buy_deal_number) = TRIM(?)
       AND COALESCE(status, '') <> 'rejected'
       AND value_date IS NOT NULL
       AND DATE(value_date) <= DATE(?)`,
    [dealNumber, asAt]
  );
  return Number(r[0]?.s) || 0;
}

async function main() {
  const [rows] = await db.query(
    `SELECT g.id, g.deal_number, g.value_date, g.maturity_date, g.face_value, g.remaining_face_value,
            g.coupon_interest, g.isin_number, g.status, g.matured, g.per_day_accrual,
            im.coupon_rate, im.coupon_date_1, im.coupon_date_2
     FROM gsec g
     LEFT JOIN isin_master im
       ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.deal_number = ? AND g.transaction_type = 'Buy'
     LIMIT 1`,
    [DEAL]
  );
  const deal = rows[0];
  if (!deal) throw new Error(`Buy deal not found: ${DEAL}`);

  console.log(`Deal ${DEAL} face=${deal.face_value} stored_rfv=${deal.remaining_face_value}`);
  console.log(EXECUTE ? 'MODE: EXECUTE' : 'MODE: DRY-RUN (pass --execute to post)');

  const drCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
  const crCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);
  const drId = await resolveAccountIdByCode(drCode);
  const crId = await resolveAccountIdByCode(crCode);

  const plan = [];
  for (const date of DATES) {
    const sold = await soldAgainst(DEAL, date);
    const remaining = Math.max(0, Number(deal.face_value) - sold);
    const computed = computeGsecPerDayAccrual(
      {
        ...deal,
        remaining_face_value: remaining,
        linked_sold_face_value: sold,
        linked_buyback_face_value: 0
      },
      date,
      2
    );

    const [exists] = await db.query(
      `SELECT id FROM ledger_entries
       WHERE TRIM(deal_number) = ?
         AND DATE(entry_date) = DATE(?)
         AND description LIKE 'GSec Daily Accrual%'
         AND debit_amount > 0
       LIMIT 1`,
      [DEAL, date]
    );

    plan.push({
      date,
      sold,
      remaining,
      computed,
      alreadyPosted: exists.length > 0
    });

    console.log(
      `\n${date}: sold_as_at=${sold} remaining=${remaining}` +
        ` computed=${computed.ok ? computed.amount : computed.reason}` +
        ` alreadyPosted=${exists.length > 0}`
    );
  }

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to post.');
    process.exit(0);
  }

  for (const p of plan) {
    if (p.alreadyPosted) {
      console.log(`Skip ${p.date}: already posted`);
      continue;
    }
    if (!p.computed.ok || !(p.computed.amount > 0)) {
      console.log(`Skip ${p.date}: ${p.computed.reason || 'zero amount'}`);
      continue;
    }
    const amount = p.computed.amount;
    const desc = `GSec Daily Accrual for Deal ${DEAL}`;
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
      [p.date, drId, amount, DEAL, desc]
    );
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
      [p.date, crId, amount, DEAL, desc]
    );
    console.log(`Posted ${p.date}: ${Number(amount).toFixed(2)}`);
  }

  const [verify] = await db.query(
    `SELECT DATE(entry_date) AS d, debit_amount, credit_amount, account_id, description
     FROM ledger_entries
     WHERE TRIM(deal_number) = ?
       AND description LIKE 'GSec Daily Accrual%'
     ORDER BY entry_date, id`,
    [DEAL]
  );
  console.log('\nAccrual ledger now:');
  for (const e of verify) {
    console.log(String(e.d).slice(0, 10), 'dr', e.debit_amount, 'cr', e.credit_amount, e.description);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
