'use strict';

/**
 * Bond pricing utilities to mirror the manual GSec form calculations.
 * All prices are returned per 100 face value.
 */

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculate clean price, dirty price and accrued interest (per 100)
 * using a semi-annual coupon with Actual/Actual conventions,
 * mirroring the logic used in the frontend `FixedIncomeGsecPage`.
 *
 * @param {Object} params
 * @param {number|string} params.couponRate - Percentage (e.g., 9 for 9%)
 * @param {number|string} params.yieldRate - Percentage (e.g., 9.5 for 9.5%)
 * @param {string|Date} params.valueDate
 * @param {string|Date} params.maturityDate
 * @param {string|Date} params.issueDate
 * @param {string|Date} params.couponDate1 - MM-DD or YYYY-MM-DD
 * @param {string|Date} params.couponDate2 - MM-DD or YYYY-MM-DD
 * @returns {{dirtyPrice: number, cleanPrice: number, accruedInterestPer100: number}}
 */
function calculatePrices({ couponRate, yieldRate, valueDate, maturityDate, issueDate, couponDate1, couponDate2 }) {
  const settle = toDate(valueDate);
  const maturity = toDate(maturityDate);
  const issue = toDate(issueDate);
  if (!settle || !maturity || !issue || couponRate == null || yieldRate == null || !couponDate1 || !couponDate2) {
    return { dirtyPrice: 0, cleanPrice: 0, accruedInterestPer100: 0 };
  }

  // Normalize coupon date month/day (supports 'MM-DD' or 'YYYY-MM-DD')
  function mmdd(input) {
    const d = toDate(input);
    if (d) return { m: d.getMonth() + 1, day: d.getDate() };
    // MM-DD string
    const [mm, dd] = String(input).split('-');
    return { m: parseInt(mm, 10), day: parseInt(dd, 10) };
  }

  const cd1 = mmdd(couponDate1);
  const cd2 = mmdd(couponDate2);

  // Ensure cd1 is the earlier in the year
  const first = (cd1.m < cd2.m || (cd1.m === cd2.m && cd1.day <= cd2.day)) ? cd1 : cd2;
  const second = (first === cd1) ? cd2 : cd1;

  // Build last/next coupon dates around the settlement year
  const year = settle.getFullYear();
  const lastCoupon = new Date(year, first.m - 1, first.day);
  const nextCoupon = new Date(year, second.m - 1, second.day);
  let lc = lastCoupon;
  let nc = nextCoupon;
  if (settle > nextCoupon) {
    lc = new Date(year, second.m - 1, second.day);
    nc = new Date(year + 1, first.m - 1, first.day);
  } else if (settle <= lastCoupon) {
    lc = new Date(year - 1, second.m - 1, second.day);
    nc = new Date(year, first.m - 1, first.day);
  }

  const frequency = 2; // semi-annual
  const fv = 100; // prices per 100
  const cr = parseFloat(couponRate) / 100;
  const ytm = parseFloat(yieldRate) / 100;
  const coupon = fv * (cr / frequency);

  // Time fractions for remaining cashflows
  function t(exCouponDate) {
    // t in years using Actual/Actual basis
    const daysTo = daysBetween(settle, exCouponDate);
    const daysIn = daysBetween(lc, nc);
    const halfYears = daysTo / daysIn; // fraction of period remaining
    const elapsedHalfYears = daysBetween(nc, maturity) / daysBetween(lc, nc);
    // We only need relative times; construct a linear schedule of half-years to maturity
    return (daysTo / daysIn) / frequency + Math.max(0, Math.floor(elapsedHalfYears)) / frequency;
  }

  // Build schedule of future coupon dates up to maturity
  const schedule = [];
  let d = new Date(nc);
  while (d <= maturity) {
    schedule.push(new Date(d));
    d = new Date(d);
    d.setMonth(d.getMonth() + 6);
  }

  // Present value of coupons and principal
  let dirtyPrice = 0;
  for (const cDate of schedule) {
    const ti = t(cDate);
    const discount = Math.pow(1 + ytm / frequency, frequency * ti);
    dirtyPrice += coupon / discount;
  }
  // Add principal redemption
  const tM = t(maturity);
  dirtyPrice += fv / Math.pow(1 + ytm / frequency, frequency * tM);

  // Accrued interest per 100
  const daysAccrued = daysBetween(lc, settle);
  const daysInPeriod = daysBetween(lc, nc) || 1;
  const accruedInterest = coupon * (daysAccrued / daysInPeriod);

  // Clean = dirty - accrued
  const cleanPrice = dirtyPrice - accruedInterest;

  // Truncate to 4 decimals to match frontend formatting
  const trunc4 = (x) => Math.floor(x * 10000) / 10000;
  return {
    dirtyPrice: trunc4(dirtyPrice),
    cleanPrice: trunc4(cleanPrice),
    accruedInterestPer100: trunc4(accruedInterest)
  };
}

module.exports = { calculatePrices };


