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
  // Strict "<" so that a settlement date landing exactly on a coupon date is
  // treated as the start of the new period (0 days accrued), not the end of
  // the previous one (full period accrued).
  while (settle < prev) {
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
  LKB00529L150: { coupon_date_1: '12-15', coupon_date_2: '06-15' },
  // Market schedule: 15-May / 15-Nov coupon dates => E=184 for these ISINs.
  LKB00426E154: { coupon_date_1: '05-15', coupon_date_2: '11-15' },
  LKB01530E152: { coupon_date_1: '05-15', coupon_date_2: '11-15' }
};

/**
 * Finance policy overrides for coupon period length E (day count).
 * Some instruments are treated with a fixed semi-annual basis for daily accrual reporting.
 * Keyed by ISIN.
 */
const ISIN_COUPON_PERIOD_E_OVERRIDE = {
  // Per ops workbook: treat these ISINs as E=184 for accrual calculations.
  LKB00426E154: 184,
  LKB01530E152: 184
};

function getCouponPeriodEOverride(isinNumber) {
  const isin = isinNumber && String(isinNumber).trim();
  if (!isin) return null;
  const v = ISIN_COUPON_PERIOD_E_OVERRIDE[isin];
  return v ? Number(v) : null;
}

function parseNumberLike(x) {
  if (x === null || x === undefined || x === '') return NaN;
  if (typeof x === 'number') return x;
  const s = String(x).trim().replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

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
  // DD-MMM-YY or DD-MMM-YYYY (e.g. 15-Oct-25, 15-Apr-2026)
  m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = String(m[2] || '').toLowerCase();
    const monthMap = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12
    };
    const month = monthMap[mon];
    if (month && day >= 1 && day <= 31) return { month, day };
  }
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
  const faceVal = parseNumberLike(deal.face_value) || 0;
  let remaining = deal.remaining_face_value;
  if (remaining === null || remaining === undefined || remaining === '') {
    remaining = faceVal;
  } else {
    remaining = parseNumberLike(remaining);
  }
  // Guard: if remaining_face_value is wrongly reduced but there is NO known reduction
  // from any source (sells, buybacks, or any other passed-in reduction signal), treat
  // remaining as full face to avoid suppressing accrual (data sometimes gets out of sync).
  // IMPORTANT: callers MUST pass `linked_buyback_face_value` whenever the deal has been
  // partially bought back, otherwise this guard will wrongly inflate the accrual back to
  // the full-face level. Same for any other reduction source via `linked_reduced_face_value`.
  const linkedSoldRaw = parseNumberLike(deal.linked_sold_face_value);
  const linkedBuybackRaw = parseNumberLike(deal.linked_buyback_face_value);
  const linkedReducedRaw = parseNumberLike(deal.linked_reduced_face_value);
  const linkedSold = Number.isFinite(linkedSoldRaw) ? linkedSoldRaw : 0;
  const linkedBuyback = Number.isFinite(linkedBuybackRaw) ? linkedBuybackRaw : 0;
  const linkedReducedExtra = Number.isFinite(linkedReducedRaw) ? linkedReducedRaw : 0;
  const totalKnownReduction = linkedSold + linkedBuyback + linkedReducedExtra;
  if (
    Number.isFinite(faceVal) &&
    faceVal > 0 &&
    Number.isFinite(remaining) &&
    remaining > 0 &&
    remaining < faceVal &&
    totalKnownReduction <= 0
  ) {
    remaining = faceVal;
  }
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { ok: false, reason: 'no remaining face' };
  }
  const scale = faceVal > 0 ? remaining / faceVal : 1;
  // IMPORTANT: In our DB, `coupon_interest` is not consistently stored as "coupon per period".
  // Some records store the ANNUAL coupon amount (= face * rate%), while others store per-period.
  // Daily accrual should always use the coupon amount for the current coupon period.
  const storedCouponInterest = parseNumberLike(deal.coupon_interest);
  const rate = parseNumberLike(deal.coupon_rate);
  const freq = Number.isFinite(frequency) && frequency > 0 ? frequency : 2;

  let couponPerPeriodForFullFace = null;
  if (Number.isFinite(rate) && rate > 0 && faceVal > 0) {
    const annual = faceVal * (rate / 100);
    const perPeriod = annual / freq;

    if (Number.isFinite(storedCouponInterest) && storedCouponInterest > 0) {
      // Pick the closer interpretation (annual vs per-period) when both are plausible.
      const diffAnnual = Math.abs(storedCouponInterest - annual);
      const diffPer = Math.abs(storedCouponInterest - perPeriod);
      couponPerPeriodForFullFace = diffPer <= diffAnnual ? perPeriod : annual / freq;
    } else {
      couponPerPeriodForFullFace = perPeriod;
    }
  } else {
    if (!Number.isFinite(storedCouponInterest) || storedCouponInterest <= 0) {
      return { ok: false, reason: 'invalid coupon_interest and no coupon_rate fallback' };
    }
    // No coupon_rate to infer annual vs period → assume stored value already represents a period coupon.
    couponPerPeriodForFullFace = storedCouponInterest;
  }

  const effectiveCouponInterest = couponPerPeriodForFullFace * scale;
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
  // Apply fixed-E overrides (after computing schedule) if configured.
  const eOverride = getCouponPeriodEOverride(deal.isin_number);
  if (eOverride) E = eOverride;
  if (!E || E <= 0) {
    return { ok: false, reason: `invalid coupon period E (${E})` };
  }
  const amount = Math.floor((effectiveCouponInterest / E) * 100000000) / 100000000;
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, reason: 'zero daily accrual' };
  }
  return { ok: true, amount, E, effectiveCouponInterest };
}

/**
 * Calendar days from value_date to maturity_date (MySQL DATEDIFF-style: maturity - value).
 * @returns {number}
 */
function daysFromValueToMaturity(valueDate, maturityDate) {
  const v = new Date(valueDate);
  const m = new Date(maturityDate);
  if (Number.isNaN(v.getTime()) || Number.isNaN(m.getTime())) {
    return 0;
  }
  const vUtc = Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
  const mUtc = Date.UTC(m.getFullYear(), m.getMonth(), m.getDate());
  return (mUtc - vUtc) / (24 * 60 * 60 * 1000);
}

/**
 * Straight-line daily premium/discount amortization for a GSEC buy row.
 * @param {object} deal - { face_value, remaining_face_value, clean_price, value_date, maturity_date }
 * @param {Date|string} [_settlementDate] - reserved for future use (as-of date)
 * @returns {{ ok: true, dailyAmount: number, scenario: 'premium'|'discount', days: number, scaledCal2: number } | { ok: false, reason: string }}
 */
function computeGsecDailyAmortization(deal, _settlementDate) {
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

  const clean = Number(deal.clean_price);
  if (!Number.isFinite(clean)) {
    return { ok: false, reason: 'missing clean_price' };
  }
  if (Math.abs(clean - 100) < 1e-6) {
    return { ok: false, reason: 'par bond' };
  }

  const cal1 = faceVal * (clean / 100);
  const cal2 = faceVal - cal1;
  const scale = faceVal > 0 ? remaining / faceVal : 1;
  const scaledCal2 = cal2 * scale;
  if (!Number.isFinite(scaledCal2) || Math.abs(scaledCal2) < 1e-12) {
    return { ok: false, reason: 'zero scaled premium/discount' };
  }

  const rawDays = daysFromValueToMaturity(deal.value_date, deal.maturity_date);
  if (!Number.isFinite(rawDays) || rawDays <= 0) {
    return { ok: false, reason: `invalid amortization days (${rawDays})` };
  }
  // Maturity calendar day is excluded from the straight-line divisor (not amortized on maturity).
  const days = Math.max(1, rawDays - 1);

  const dailyAmount =
    Math.floor((Math.abs(scaledCal2) / days) * 100000000) / 100000000;
  if (!Number.isFinite(dailyAmount) || dailyAmount === 0) {
    return { ok: false, reason: 'zero daily amortization' };
  }

  const scenario = clean > 100 ? 'premium' : 'discount';
  return { ok: true, dailyAmount, scenario, days, scaledCal2 };
}

/**
 * Remaining face for EOD accrual/amortization: derive from linked sells and buybacks
 * when available so stale gsec.remaining_face_value cannot keep posting after exit.
 */
function resolveGsecRemainingForDailyPosting(deal, options = {}) {
  const faceVal = parseNumberLike(deal.face_value) || 0;
  const soldRaw = parseNumberLike(deal.linked_sold_face_value);
  const buybackRaw = parseNumberLike(
    options.linked_buyback_face_value ?? deal.linked_buyback_face_value
  );
  const sold = Number.isFinite(soldRaw) ? soldRaw : 0;
  const buyback = Number.isFinite(buybackRaw) ? buybackRaw : 0;
  if (sold > 0 || buyback > 0) {
    return Math.max(0, faceVal - sold - buyback);
  }
  let remaining = deal.remaining_face_value;
  if (remaining === null || remaining === undefined || remaining === '') {
    return faceVal;
  }
  remaining = parseNumberLike(remaining);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : faceVal;
}

module.exports = {
  getDaysDifference,
  findCouponPeriodFromMaturity,
  getCouponPeriodLengthDays,
  parseCouponMMDD,
  getCouponPeriodLengthDaysFromIsinSchedule,
  resolveIsinCouponDates,
  ISIN_COUPON_SCHEDULE_OVERRIDE,
  ISIN_COUPON_PERIOD_E_OVERRIDE,
  getCouponPeriodEOverride,
  computeGsecPerDayAccrual,
  daysFromValueToMaturity,
  computeGsecDailyAmortization,
  resolveGsecRemainingForDailyPosting
};
