const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

(async () => {
  const [rows] = await db.query(
    `SELECT g.id, g.deal_number, g.transaction_type, g.status, g.isin_number, g.value_date, g.maturity_date,
            g.face_value, g.remaining_face_value, g.coupon_interest, g.number_of_days_for_coupon_period,
            g.per_day_accrual, im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.isin_number='LKB00934F154' AND DATE(g.value_date)='2026-03-04'
     ORDER BY g.deal_number`
  );
  console.log('LKB00934F154 @ 2026-03-04 candidates:');
  let totFace = 0, totRem = 0, totCoupon = 0, totPerDay = 0;
  for (const r of rows) {
    totFace += Number(r.face_value || 0);
    totRem += Number(r.remaining_face_value || 0);
    totCoupon += Number(r.coupon_interest || 0);
    const c = computeGsecPerDayAccrual(r, '2026-04-16', 2);
    const pd = c.ok ? Number(c.amount || 0) : 0;
    totPerDay += pd;
    console.log({
      deal: r.deal_number,
      status: r.status,
      type: r.transaction_type,
      face: Number(r.face_value),
      remaining: Number(r.remaining_face_value),
      coupon: Number(r.coupon_interest),
      per_day_stored: Number(r.per_day_accrual),
      per_day_computed_today: pd,
      eligible_today: c.ok,
      reason: c.ok ? null : c.reason,
    });
  }
  console.log('\n--- totals for this ISIN@value_date ---');
  console.log('sum face           :', totFace);
  console.log('sum remaining      :', totRem);
  console.log('sum coupon interest:', totCoupon);
  console.log('sum per-day today  :', totPerDay.toFixed(4));
  console.log('CSV per-day target :', (177197.80).toFixed(4));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
