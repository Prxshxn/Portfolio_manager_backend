'use strict';

/**
 * Mirrors Portfolio__manager/src/utils/gsecUtils.js (getDaysDifference, findCouponPeriodFromMaturity)
 * so EOD daily accrual uses the same coupon period length (E) as Excel PRICE / front-end pricing.
 */

function getDaysDifference(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.abs(utc1 - utc2) / (24 * 60 * 60 * 1000);
}

/**
 * Coupon period containing settlement, walking backward from maturity (Excel PRICE; no issue date).
 * @param {Date|string} settlement
 * @param {Date|string} maturity
 * @param {number} frequency - coupons per year (e.g. 2 for semi-annual)
 */
function findCouponPeriodFromMaturity(settlement, maturity, frequency) {
  const settle = new Date(settlement);
  const monthsPerPeriod = 12 / frequency;
  let next = new Date(maturity);
  let prev = new Date(maturity);
  prev.setMonth(prev.getMonth() - monthsPerPeriod);
  while (settle <= prev) {
    next = new Date(prev);
    prev = new Date(prev);
    prev.setMonth(prev.getMonth() - monthsPerPeriod);
  }
  return { lastCoupon: prev, nextCoupon: next };
}

/**
 * Actual/Actual length of the coupon period containing settlement (days between last and next coupon).
 * @param {Date|string} settlementDate - typically system date (EOD)
 * @param {Date|string} maturityDate - bond maturity from gsec
 * @param {number} [frequency=2]
 * @returns {{ E: number, lastCoupon: Date, nextCoupon: Date } | { E: 0, lastCoupon: null, nextCoupon: null }}
 */
function getCouponPeriodLengthDays(settlementDate, maturityDate, frequency = 2) {
  const settle = new Date(settlementDate);
  const mat = new Date(maturityDate);
  if (isNaN(settle.getTime()) || isNaN(mat.getTime())) {
    return { E: 0, lastCoupon: null, nextCoupon: null };
  }
  if (settle >= mat) {
    return { E: 0, lastCoupon: null, nextCoupon: null };
  }
  const { lastCoupon, nextCoupon } = findCouponPeriodFromMaturity(settle, mat, frequency);
  const E = getDaysDifference(nextCoupon, lastCoupon);
  return { E, lastCoupon, nextCoupon };
}

/**
 * When isin_master coupon_date_1/2 are wrong or missing, use known market schedule
 * (last/next coupon boundaries and E must match official calendar).
 */
const ISIN_COUPON_SCHEDULE_OVERRIDE = {
  LKB00931E153: { coupon_date_1: '11-01', coupon_date_2: '05-01' },
  // Finance policy: LKB01534I155 must use coupon dates 15-Mar / 15-Sep (E=184).
  // The maturity is 2034-09-15 and the maturity-based rollback gives 15-Mar / 15-Sep.
  // We pin it explicitly so the value cannot regress if isin_master ever drifts.
  LKB01534I155: { coupon_date_1: '03-15', coupon_date_2: '09-15' },
  LKB00529L150: { coupon_date_1: '12-15', coupon_date_2: '06-15' }
};

function resolveIsinCouponDates(deal) {
  const isin = deal.isin_number && String(deal.isin_number).trim();
  if (isin && ISIN_COUPON_SCHEDULE_OVERRIDE[isin]) {
    const o = ISIN_COUPON_SCHEDULE_OVERRIDE[isin];
    return { coupon_date_1: o.coupon_date_1, coupon_date_2: o.coupon_date_2 };
  }
  return { coupon_date_1: deal.coupon_date_1, coupon_date_2: deal.coupon_date_2 };
}

/**
 * Parse MM-DD or MM/DD from isin_master (e.g. 11-01, 05-01).
 * @param {string|null|undefined} s
 * @returns {{ month: number, day: number } | null}
 */
function parseCouponMMDD(s) {
  if (s === null || s === undefined || s === '') return null;
  const t = String(s).trim();
  // MM-DD or MM/DD
  let m = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m) return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
  // Full date YYYY-MM-DD (or Date object serialised as string) — extract month+day
  m = t.match(/^\d{4}[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
  // Date object
  const d = new Date(t);
  if (!isNaN(d.getTime())) return { month: d.getMonth() + 1, day: d.getDate() };
  return null;
}

/**
 * Semi-annual coupon period length using actual calendar coupon days from isin_master
 * (e.g. 1-Nov / 1-May vs 15-Oct / 15-Apr). Matches market last/next coupon boundaries.
 * @returns {{ E: number, lastCoupon: Date, nextCoupon: Date } | null}
 */
function getCouponPeriodLengthDaysFromIsinSchedule(settlementDate, maturityDate, couponDate1Str, couponDate2Str) {
  const a = parseCouponMMDD(couponDate1Str);
  const b = parseCouponMMDD(couponDate2Str);
  if (!a || !b) return null;
  const settle = new Date(settlementDate);
  const mat = new Date(maturityDate);
  if (isNaN(settle.getTime()) || isNaN(mat.getTime()) || settle >= mat) return null;

  const y0 = settle.getFullYear();
  const allDates = [];
  for (let y = y0 - 2; y <= y0 + 2; y += 1) {
    allDates.push(new Date(y, a.month - 1, a.day));
    allDates.push(new Date(y, b.month - 1, b.day));
  }
  allDates.sort((x, y) => x - y);
  const uniq = [];
  const seen = new Set();
  for (const d of allDates) {
    if (d > mat) continue;
    const t = d.getTime();
    if (seen.has(t)) continue;
    seen.add(t);
    uniq.push(d);
  }
  let last = null;
  let next = null;
  for (let i = 0; i < uniq.length; i += 1) {
    const d = uniq[i];
    if (d <= settle) last = d;
    if (d > settle) {
      next = d;
      break;
    }
  }
  if (!last || !next) return null;
  const E = getDaysDifference(next, last);
  return { E, lastCoupon: last, nextCoupon: next };
}

/**
 * Daily accrual for a GSEC buy row (same formula as EOD / gsec create truncation).
 * @param {object} deal - { face_value, remaining_face_value, coupon_interest, maturity_date, coupon_date_1?, coupon_date_2? }
 * @param {Date|string} settlementDate - as-of date (system day)
 * @param {number} [frequency=2]
 * @returns {{ ok: true, amount: number, E: number, effectiveCouponInterest: number } | { ok: false, reason: string }}
 */
function computeGsecPerDayAccrual(deal, settlementDate, frequency = 2) {
  const faceVal = Number(deal.face_value) || 0;
  let remaining = deal.remaining_face_value;
  if (remaining === null || remaining === undefined || remaining === '') {
    remaining = faceVal;
  } else {
    remaining = Number(remaining);
  }
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { ok: false, reason: 'no remaining face' };
  }
  const scale = faceVal > 0 ? remaining / faceVal : 1;
  let couponInterestFull = Number(deal.coupon_interest);
  if (!Number.isFinite(couponInterestFull) || couponInterestFull <= 0) {
    // Derive from isin_master.coupon_rate if coupon_interest was never stored
    const rate = Number(deal.coupon_rate);
    if (Number.isFinite(rate) && rate > 0 && faceVal > 0) {
      couponInterestFull = faceVal * (rate / 100) / (frequency || 2);
    } else {
      return { ok: false, reason: 'invalid coupon_interest and no coupon_rate fallback' };
    }
  }
  const effectiveCouponInterest = couponInterestFull * scale;
  let E = 0;
  const { coupon_date_1: c1, coupon_date_2: c2 } = resolveIsinCouponDates(deal);
  if (c1 && c2) {
    const sched = getCouponPeriodLengthDaysFromIsinSchedule(
      settlementDate,
      deal.maturity_date,
      c1,
      c2
    );
    if (sched && sched.E > 0) {
      E = sched.E;
    }
  }
  if (!E) {
    const r = getCouponPeriodLengthDays(settlementDate, deal.maturity_date, frequency);
    E = r.E;
  }
  if (!E || E <= 0) {
    return { ok: false, reason: `invalid coupon period E (${E})` };
  }
  const amount = Math.floor((effectiveCouponInterest / E) * 100000000) / 100000000;
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, reason: 'zero daily accrual' };
  }
  return { ok: true, amount, E, effectiveCouponInterest };
}

module.exports = {
  getDaysDifference,
  findCouponPeriodFromMaturity,
  getCouponPeriodLengthDays,
  parseCouponMMDD,
  getCouponPeriodLengthDaysFromIsinSchedule,
  resolveIsinCouponDates,
  ISIN_COUPON_SCHEDULE_OVERRIDE,
  computeGsecPerDayAccrual
};
