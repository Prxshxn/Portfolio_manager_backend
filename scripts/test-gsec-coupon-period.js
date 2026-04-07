/**
 * Quick sanity check: Apr 1 2026 in Feb 1 – Aug 1 2026 semi-annual window => E = 181.
 * Run: node scripts/test-gsec-coupon-period.js
 */
const assert = require('assert');
const {
  getCouponPeriodLengthDays,
  getDaysDifference
} = require('../services/gsecCouponPeriod');

const settlement = '2026-04-01';
const maturity = '2031-08-01'; // any maturity after Aug 2026; algorithm walks from maturity

const { E, lastCoupon, nextCoupon } = getCouponPeriodLengthDays(settlement, maturity, 2);

assert.ok(E > 0, 'E should be positive');
assert.strictEqual(
  E,
  181,
  `Expected E=181 for Feb–Aug 2026 half-year; got E=${E}, last=${lastCoupon && lastCoupon.toISOString()}, next=${nextCoupon && nextCoupon.toISOString()}`
);

// Spot-check: Aug 1 2025 → Feb 1 2026 span is 184 days (previous coupon period)
const aug2025 = new Date(2025, 7, 1);
const feb2026 = new Date(2026, 1, 1);
const spanAugFeb = getDaysDifference(feb2026, aug2025);
assert.strictEqual(spanAugFeb, 184, 'Aug–Feb half-year should be 184 days');

console.log('gsecCouponPeriod OK:', { E, lastCoupon: lastCoupon && lastCoupon.toISOString(), nextCoupon: nextCoupon && nextCoupon.toISOString(), spanAugFeb });
