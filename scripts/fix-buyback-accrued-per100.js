// Backfill garbage accrued-interest values (999999.9999 sentinel or rupee
// amounts stored where a per-100 figure belongs) on a buyback deal, using the
// same coupon-calendar formula as processBuybackPrematureMaturity.
// Usage: node scripts/fix-buyback-accrued-per100.js BB20260728003 [--execute]
require('dotenv').config();
const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const DEAL_NUMBER = process.argv.find(a => a.startsWith('BB'));
if (!DEAL_NUMBER) { console.error('Usage: node scripts/fix-buyback-accrued-per100.js <BB deal number> [--execute]'); process.exit(1); }

// A sane per-100 accrued is 0..(coupon/2) at most; anything above 200 is garbage.
const isSanePer100 = (v) => Number.isFinite(v) && v >= 0 && v <= 200;

const round4 = (n) => Math.round(n * 10000) / 10000;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const daysBetween = (d1, d2) => Math.ceil(Math.abs(new Date(d2) - new Date(d1)) / 86400000);

function accruedPer100(couponRate, valueDate, issueDate) {
  const cr = parseFloat(couponRate) / 100;
  const settle = new Date(valueDate);
  const issue = new Date(issueDate);
  const couponPer100 = (100 * cr) / 2;
  let lastCoupon = new Date(issue);
  while (lastCoupon <= settle) lastCoupon.setMonth(lastCoupon.getMonth() + 6);
  lastCoupon.setMonth(lastCoupon.getMonth() - 6);
  const nextCoupon = new Date(lastCoupon);
  nextCoupon.setMonth(nextCoupon.getMonth() + 6);
  const daysInPeriod = daysBetween(nextCoupon, lastCoupon);
  const daysAccrued = daysBetween(settle, lastCoupon);
  return { value: round4(couponPer100 * (daysAccrued / daysInPeriod)), daysAccrued, daysInPeriod };
}

(async () => {
  const [rows] = await db.query(
    `SELECT id, deal_number, leg1_isin, leg2_isin, leg1_value_date, leg2_value_date,
            leg1_accrued_interest, leg2_accrued_interest
     FROM buyback_deals WHERE deal_number = ?`, [DEAL_NUMBER]);
  const bb = rows[0];
  if (!bb) throw new Error(`${DEAL_NUMBER} not found`);
  console.log('Current:', bb);

  const updates = [];
  for (const leg of [1, 2]) {
    const stored = parseFloat(bb[`leg${leg}_accrued_interest`]);
    if (isSanePer100(stored)) {
      console.log(`leg${leg}: stored ${stored} looks like a sane per-100 - leaving unchanged`);
      continue;
    }
    const isinNo = bb[`leg${leg}_isin`];
    const valueDate = ymd(bb[`leg${leg}_value_date`]);
    const [isinRows] = await db.query(
      'SELECT coupon_rate, issue_date FROM isin_master WHERE isin_number = ?', [isinNo]);
    const isin = isinRows[0];
    if (!isin) throw new Error(`isin_master missing for ${isinNo}`);
    const calc = accruedPer100(isin.coupon_rate, valueDate, ymd(isin.issue_date));
    console.log(`leg${leg}: garbage ${stored} -> ${calc.value} (${isinNo}, value ${valueDate}, ${calc.daysAccrued}/${calc.daysInPeriod} days at ${isin.coupon_rate}%)`);
    updates.push({ col: `leg${leg}_accrued_interest`, value: calc.value });
  }

  if (!updates.length) { console.log('\nNothing to update.'); process.exit(0); }
  if (!EXECUTE) { console.log('\nDRY-RUN. Re-run with --execute to apply.'); process.exit(0); }

  const setSql = updates.map(u => `${u.col} = ?`).join(', ');
  await db.query(
    `UPDATE buyback_deals SET ${setSql}, updated_at = NOW() WHERE id = ?`,
    [...updates.map(u => u.value), bb.id]);

  const [after] = await db.query(
    'SELECT leg1_accrued_interest, leg2_accrued_interest FROM buyback_deals WHERE id = ?', [bb.id]);
  console.log('\nAfter update:', after[0]);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
