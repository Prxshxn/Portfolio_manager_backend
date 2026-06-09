/**
 * Backend port of Microsoft Excel's PRICE(settlement, maturity, rate, yld, redemption, frequency, basis)
 * Mirrors Portfolio__manager/src/utils/gsecUtils.js excelPRICE so backend posting can compute the
 * carrying clean price at the original purchase yield (effective-yield amortization).
 */

const { findCouponPeriodFromMaturity, getDaysDifference } = require('./gsecCouponPeriod');

function getDaysDifference360US(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  let y1 = d1.getFullYear();
  let m1 = d1.getMonth() + 1;
  let day1 = d1.getDate();
  let y2 = d2.getFullYear();
  let m2 = d2.getMonth() + 1;
  let day2 = d2.getDate();
  if (day1 === 31) day1 = 30;
  if (day2 === 31 && day1 >= 30) day2 = 30;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (day2 - day1);
}

function getDaysDifference360EU(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  let y1 = d1.getFullYear();
  let m1 = d1.getMonth() + 1;
  let day1 = d1.getDate();
  let y2 = d2.getFullYear();
  let m2 = d2.getMonth() + 1;
  let day2 = d2.getDate();
  if (day1 === 31) day1 = 30;
  if (day2 === 31) day2 = 30;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (day2 - day1);
}

/**
 * Returns clean price per 100. Defaults: redemption=100, frequency=2, basis=1 (Actual/Actual).
 */
function excelPRICE(
  settlement,
  maturity,
  rate,
  yld,
  redemption = 100,
  frequency = 2,
  basis = 1
) {
  const settle = new Date(settlement);
  const mat = new Date(maturity);
  if (Number.isNaN(settle.getTime()) || Number.isNaN(mat.getTime())) return NaN;
  if (settle >= mat) return NaN;

  const ratePerPeriod = rate / frequency;
  const yldPerPeriod = yld / frequency;
  const monthsPerPeriod = 12 / frequency;
  const { lastCoupon, nextCoupon } = findCouponPeriodFromMaturity(settle, mat, frequency);

  let E;
  let A;
  let DSC;
  if (basis === 1 || basis === 2 || basis === 3) {
    E = getDaysDifference(nextCoupon, lastCoupon);
    A = getDaysDifference(settle, lastCoupon);
    DSC = getDaysDifference(nextCoupon, settle);
  } else if (basis === 0) {
    E = 180;
    DSC = getDaysDifference360US(nextCoupon, settle);
    A = getDaysDifference360US(settle, lastCoupon);
  } else if (basis === 4) {
    E = 180;
    DSC = getDaysDifference360EU(nextCoupon, settle);
    A = getDaysDifference360EU(settle, lastCoupon);
  } else {
    E = getDaysDifference(nextCoupon, lastCoupon);
    A = getDaysDifference(settle, lastCoupon);
    DSC = getDaysDifference(nextCoupon, settle);
  }
  if (E === 0) return NaN;

  const couponPayment = redemption * ratePerPeriod;

  let N = 0;
  let currentDate = new Date(nextCoupon);
  while (currentDate <= mat) {
    N += 1;
    if (currentDate.getTime() === mat.getTime()) break;
    currentDate.setMonth(currentDate.getMonth() + monthsPerPeriod);
  }

  const dscOverE = DSC / E;

  if (N === 1) {
    const DSR = E - A;
    const T1 = redemption * ratePerPeriod + redemption;
    const T2 = yldPerPeriod * (DSR / E) + 1;
    const T3 = redemption * ratePerPeriod * (A / E);
    return T1 / T2 - T3;
  }

  const pvRedemption = redemption / Math.pow(1 + yldPerPeriod, (N - 1) + dscOverE);
  let pvCoupons = 0;
  for (let i = 1; i <= N; i += 1) {
    const periodNum = (i - 1) + dscOverE;
    pvCoupons += couponPayment / Math.pow(1 + yldPerPeriod, periodNum);
  }
  const accruedInterest = couponPayment * (A / E);
  return pvRedemption + pvCoupons - accruedInterest;
}

/**
 * Convenience: full price triplet (clean/dirty/accruedPer100) per 100 at given yield.
 * couponRate / yieldRate as PERCENT (e.g. 10 for 10% annual, 11.86 for 11.86% yield).
 */
function priceTripletAtYield({ couponRate, yieldRate, valueDate, maturityDate, frequency = 2 }) {
  const settle = new Date(valueDate);
  const mat = new Date(maturityDate);
  if (Number.isNaN(settle.getTime()) || Number.isNaN(mat.getTime())) {
    return { cleanPrice: NaN, dirtyPrice: NaN, accruedPer100: NaN };
  }
  const rate = Number(couponRate) / 100;
  const yld = Number(yieldRate) / 100;
  const clean = excelPRICE(settle, mat, rate, yld, 100, frequency, 1);
  if (!Number.isFinite(clean)) return { cleanPrice: NaN, dirtyPrice: NaN, accruedPer100: NaN };

  const { lastCoupon, nextCoupon } = findCouponPeriodFromMaturity(settle, mat, frequency);
  const E = getDaysDifference(nextCoupon, lastCoupon);
  const A = getDaysDifference(settle, lastCoupon);
  const couponPayment = 100 * (rate / frequency);
  const accruedPer100 = E > 0 ? couponPayment * (A / E) : 0;
  const dirty = clean + accruedPer100;

  return {
    cleanPrice: Math.round(clean * 10000) / 10000,
    dirtyPrice: Math.round(dirty * 10000) / 10000,
    accruedPer100: Math.round(accruedPer100 * 10000) / 10000
  };
}

module.exports = { excelPRICE, priceTripletAtYield };
