const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');
const { getSystemDay } = require('../models/systemDayModel');

(async () => {
  const sdRow = await getSystemDay();
  const sd = new Date(sdRow.system_date);
  const iso = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
  console.log('System day:', iso);

  const [deals] = await db.query(
    `SELECT g.id, g.deal_number, g.isin_number, g.face_value, g.remaining_face_value, g.coupon_interest,
            g.value_date, g.maturity_date, im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.transaction_type='Buy' AND g.status='final_approved'
       AND DATE(g.value_date) <= DATE(?) AND DATE(g.maturity_date) >= DATE(?)`,
    [iso, iso]
  );

  let ok = 0, skipped = 0, total = 0;
  const byReason = {};
  const eligible = [];
  for (const d of deals) {
    const c = computeGsecPerDayAccrual(d, iso, 2);
    if (c.ok) {
      ok += 1;
      total += Number(c.amount || 0);
      eligible.push({ deal: d.deal_number, isin: d.isin_number, pd: Number(c.amount || 0) });
    } else {
      skipped += 1;
      byReason[c.reason] = (byReason[c.reason] || 0) + 1;
    }
  }

  console.log('Total Buy/final_approved deals considered:', deals.length);
  console.log('Eligible (will post today)              :', ok);
  console.log('Skipped                                 :', skipped, byReason);
  console.log('TOTAL PER-DAY ACCRUAL TODAY             :', total.toFixed(4));
  console.log('CSV target                              : 706150.1100');
  console.log('Diff (CSV - actual)                     :', (706150.11 - total).toFixed(4));

  // Top 10 eligible
  eligible.sort((a, b) => b.pd - a.pd);
  console.log('\nTop 10 contributors:');
  eligible.slice(0, 10).forEach(x => console.log(' ', x.deal, x.isin, x.pd.toFixed(4)));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
