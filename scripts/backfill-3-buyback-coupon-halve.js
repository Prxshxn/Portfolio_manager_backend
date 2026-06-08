/**
 * One-off backfill: halve the doubled `coupon_interest` for 3 specific
 * buyback-created GSEC buy deals so the Coupon Maturity Blotter tallies.
 *
 * Background: buyback/premature auto-creation stored the FULL annual coupon
 * (face * rate/100) instead of the semi-annual coupon (face * rate/100 / 2).
 * The blotter reads `coupon_interest` directly, so it showed double.
 *
 * Idempotent: only halves a row whose stored coupon_interest still matches the
 * full ANNUAL amount (face * rate/100). If it already looks semi-annual, it is
 * skipped. `per_day_accrual` is left untouched because computeGsecPerDayAccrual
 * already derives it from the per-period coupon.
 *
 * Usage:
 *   node scripts/backfill-3-buyback-coupon-halve.js          (dry run)
 *   node scripts/backfill-3-buyback-coupon-halve.js --apply  (writes changes)
 */
const db = require('../config/db');

const TARGET_DEALS = ['20260421/GSEC/0004', '20260421/GSEC/0005', '20260513/GSEC/0002'];
const APPLY = process.argv.includes('--apply');

(async () => {
  try {
    const [rows] = await db.query(
      `SELECT g.id, g.deal_number, g.isin_number, g.face_value,
              g.coupon_interest, g.per_day_accrual,
              im.coupon_rate
       FROM gsec g
       LEFT JOIN isin_master im
         ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
       WHERE g.deal_number IN (?, ?, ?)`,
      TARGET_DEALS
    );

    if (!rows.length) {
      console.log('No matching deals found.');
      process.exit(0);
    }

    console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN (use --apply to write) ===');

    const updates = [];
    for (const r of rows) {
      const face = Number(r.face_value) || 0;
      const rate = Number(r.coupon_rate) || 0;
      const current = Number(r.coupon_interest) || 0;
      const annual = face * (rate / 100);
      const semi = annual / 2;
      const looksAnnual = annual > 0 && Math.abs(current - annual) < 1;
      const looksSemi = semi > 0 && Math.abs(current - semi) < 1;

      let action;
      if (looksAnnual) {
        action = 'HALVE';
        updates.push({ id: r.id, deal_number: r.deal_number, newCoupon: semi });
      } else if (looksSemi) {
        action = 'SKIP (already semi-annual)';
      } else {
        action = 'SKIP (does not match annual or semi-annual; manual review)';
      }

      console.log(
        `\n${r.deal_number} (id ${r.id}) ISIN ${r.isin_number} rate ${rate}%\n` +
        `  face_value:     ${face.toFixed(2)}\n` +
        `  current coupon: ${current.toFixed(4)}\n` +
        `  annual (×):     ${annual.toFixed(4)}\n` +
        `  semi (correct): ${semi.toFixed(4)}\n` +
        `  per_day_accrual: ${r.per_day_accrual} (unchanged)\n` +
        `  => ${action}`
      );
    }

    if (!updates.length) {
      console.log('\nNothing to update.');
      process.exit(0);
    }

    if (!APPLY) {
      console.log(`\nWould update ${updates.length} deal(s). Re-run with --apply to write.`);
      process.exit(0);
    }

    for (const u of updates) {
      await db.query(
        `UPDATE gsec SET coupon_interest = ?, updated_at = NOW() WHERE id = ?`,
        [u.newCoupon, u.id]
      );
      console.log(`Updated ${u.deal_number}: coupon_interest -> ${u.newCoupon.toFixed(4)}`);
    }

    console.log(`\nDone. Updated ${updates.length} deal(s).`);
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
