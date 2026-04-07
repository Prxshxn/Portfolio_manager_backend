/**
 * Backfill gsec.per_day_accrual and number_of_days_for_coupon_period using the same
 * logic as EOD (maturity-based coupon period E, remaining-face scaling).
 * Does not post ledger entries.
 *
 * Usage (from Portfolio_manager_backend):
 *   node scripts/backfill-gsec-per-day-accrual.js
 *   node scripts/backfill-gsec-per-day-accrual.js --as-of=2026-04-01
 *   node scripts/backfill-gsec-per-day-accrual.js --as-of=2026-04-01 --execute
 *
 * Default --as-of: latest system_day from DB, else today's UTC date.
 *
 * Optional: --isin=LKB00931E153  or  --isin=LKB00931E153,LKB01534I155  (restrict to these ISINs)
 */

const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

function toYmd(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  let asOf = null;
  let isinFilter = null;
  for (const a of args) {
    if (a.startsWith('--as-of=')) {
      asOf = a.slice('--as-of='.length).trim();
    }
    if (a.startsWith('--isin=')) {
      isinFilter = a.slice('--isin='.length).trim().split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!asOf) {
    const sd = await getSystemDay();
    asOf = (sd && sd.system_date && toYmd(sd.system_date)) || new Date().toISOString().slice(0, 10);
  }

  let sql = `
    SELECT g.id, g.deal_number, g.coupon_interest, g.maturity_date, g.face_value, g.remaining_face_value,
           g.per_day_accrual, g.number_of_days_for_coupon_period, g.isin_number,
           im.coupon_date_1, im.coupon_date_2, im.coupon_rate
    FROM gsec g
    LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
    WHERE g.transaction_type = 'Buy'
      AND g.status = 'final_approved'
      AND g.maturity_date >= ?
      AND (g.coupon_interest IS NOT NULL AND g.coupon_interest > 0
           OR im.coupon_rate IS NOT NULL AND im.coupon_rate > 0)`;
  const params = [asOf];
  if (isinFilter && isinFilter.length > 0) {
    sql += ` AND g.isin_number IN (${isinFilter.map(() => '?').join(',')})`;
    params.push(...isinFilter);
  }
  const [rows] = await db.query(sql, params);

  console.log(`as-of=${asOf}  isin=${isinFilter ? isinFilter.join(',') : 'all'}  rows=${rows.length}  execute=${execute}\n`);

  let updateCount = 0;
  for (const deal of rows) {
    const computed = computeGsecPerDayAccrual(deal, asOf, 2);
    if (!computed.ok) {
      console.log(`SKIP ${deal.deal_number}: ${computed.reason}`);
      continue;
    }
    const { amount, E } = computed;
    const oldPd = deal.per_day_accrual;
    const oldNd = deal.number_of_days_for_coupon_period;
    console.log(
      `${deal.deal_number}  per_day ${oldPd} -> ${amount}  days_period ${oldNd} -> ${E}  isin=${deal.isin_number || ''}`
    );
    if (execute) {
      const ciToStore = computed.effectiveCouponInterest;
      const existingCi = Number(deal.coupon_interest);
      const needCiFix = !Number.isFinite(existingCi) || existingCi <= 0;
      if (needCiFix) {
        await db.query(
          `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ?, coupon_interest = ? WHERE id = ?`,
          [amount, E, ciToStore, deal.id]
        );
      } else {
        await db.query(
          `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?`,
          [amount, E, deal.id]
        );
      }
      updateCount += 1;
    }
  }

  if (execute) {
    console.log(`\nUpdated ${updateCount} row(s).`);
  } else {
    console.log('\nDry run. Re-run with --execute to apply UPDATEs.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
