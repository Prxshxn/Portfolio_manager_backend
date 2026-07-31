/* eslint-disable no-console */
const db = require('../config/database');

const SELL_DATE = '2026-05-25';
const SLICES = [
  { dn: '20251014/GSEC/0001', sold: 9016697 },
  { dn: '20260318/GSEC/0002', sold: 32113853 }
];
const SELL_ACCRUED_PER100 = 99.5857 - 98.3835; // 1.2022 leg1 dirty-clean

const ACC_RECEIVABLE = '131-101-290-218-44'; // 568
const ACC_INCOME = '467-101-190-470-44';     // 570

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

(async () => {
  for (const s of SLICES) {
    console.log(`\n========== ${s.dn}  (sold ${s.sold.toLocaleString()}) ==========`);
    const [g] = await db.query(
      `SELECT g.id, g.face_value, g.remaining_face_value, g.value_date, g.maturity_date,
              g.clean_price, g.dirty_price, g.isin_number,
              im.coupon_date_1, im.coupon_date_2, im.coupon_rate
         FROM gsec g LEFT JOIN isin_master im
           ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
        WHERE g.deal_number=? AND g.transaction_type='Buy'`,
      [s.dn]
    );
    const row = g[0];
    const face = num(row.face_value);
    const soldFrac = s.sold / face;
    console.log(`  ISIN=${row.isin_number} coupon_rate=${row.coupon_rate} c1=${row.coupon_date_1} c2=${row.coupon_date_2}`);
    console.log(`  face=${face.toLocaleString()} soldFrac=${(soldFrac*100).toFixed(2)}%`);

    // All daily accrual DR (568) postings on this source deal
    const [acc] = await db.query(
      `SELECT DATE(le.entry_date) AS d, le.debit_amount
         FROM ledger_entries le
        WHERE TRIM(le.deal_number)=? AND le.description LIKE 'GSec Daily Accrual%' AND le.debit_amount>0
        ORDER BY le.entry_date`,
      [s.dn]
    );
    const totalAccrued = acc.reduce((t, r) => t + num(r.debit_amount), 0);
    const first = acc.length ? new Date(acc[0].d).toISOString().slice(0,10) : '-';
    const last = acc.length ? new Date(acc[acc.length-1].d).toISOString().slice(0,10) : '-';
    console.log(`  daily accrual (568 DR): rows=${acc.length} total=${totalAccrued.toFixed(2)} range=${first}..${last}`);

    // Any coupon receipt / accrual clearing on this deal (DR/CR on 568 or 570 not from daily accrual)?
    const [clears] = await db.query(
      `SELECT DATE(le.entry_date) AS d, coa.account_code, le.debit_amount, le.credit_amount, le.description
         FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON le.account_id=coa.id
        WHERE TRIM(le.deal_number)=?
          AND coa.account_code IN (?,?)
          AND le.description NOT LIKE 'GSec Daily Accrual%'
        ORDER BY le.entry_date`,
      [s.dn, ACC_RECEIVABLE, ACC_INCOME]
    );
    console.log(`  non-accrual 568/570 movements (coupon clearings etc.): ${clears.length}`);
    clears.forEach((c) => console.log(`     ${new Date(c.d).toISOString().slice(0,10)} [${c.account_code}] DR=${num(c.debit_amount).toFixed(2)} CR=${num(c.credit_amount).toFixed(2)} :: ${c.description}`));

    // Interpretation 1: true unwind = accrued posted in 568 for the sold portion
    const unwindSold = totalAccrued * soldFrac;
    // Interpretation 2: market accrued since last coupon = sellAccruedPer100 × soldFace/100
    const marketSold = (SELL_ACCRUED_PER100 * s.sold) / 100;

    console.log(`  >> Interpretation 1 (unwind posted 568 receivable × soldFrac): ${unwindSold.toFixed(2)}`);
    console.log(`  >> Interpretation 2 (sellAccruedPer100 ${SELL_ACCRUED_PER100.toFixed(4)} × sold/100): ${marketSold.toFixed(2)}`);
  }

  console.log('\nReversal pair would be: DR 467-101-190-470-44 (570 income)  /  CR 131-101-290-218-44 (568 receivable)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
