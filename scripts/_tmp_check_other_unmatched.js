const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

async function check(isin, vdate) {
  console.log(`\n=== ${isin} @ ${vdate} ===`);
  const [rows] = await db.query(
    `SELECT g.id, g.deal_number, g.transaction_type, g.status, g.isin_number, g.value_date, g.maturity_date,
            g.face_value, g.remaining_face_value, g.coupon_interest, g.number_of_days_for_coupon_period,
            g.per_day_accrual, im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.isin_number=? AND DATE(g.value_date)=?
     ORDER BY g.deal_number`,
    [isin, vdate]
  );
  let totFace = 0, totPd = 0;
  for (const r of rows) {
    totFace += Number(r.face_value || 0);
    const c = computeGsecPerDayAccrual(r, '2026-04-16', 2);
    const pd = c.ok ? Number(c.amount || 0) : 0;
    totPd += pd;
    console.log({
      deal: r.deal_number,
      status: r.status,
      type: r.transaction_type,
      face: Number(r.face_value),
      remaining_raw: r.remaining_face_value,
      coupon: Number(r.coupon_interest),
      per_day_stored: Number(r.per_day_accrual),
      per_day_today: pd,
      eligible: c.ok,
      reason: c.ok ? null : c.reason,
    });
  }
  console.log('sum face   :', totFace);
  console.log('sum per-day:', totPd.toFixed(4));
}

(async () => {
  await check('LKB02033F013', '2026-04-08');
  await check('LKB01534I155', '2026-03-10');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
