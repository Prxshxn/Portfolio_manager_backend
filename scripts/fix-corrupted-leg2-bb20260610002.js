#!/usr/bin/env node
'use strict';

/**
 * Fix corrupted leg2 clean price/accrued for prematured buyback BB20260610002 (id 129)
 * and its linked GSEC leg2 buy (20260619/GSEC/0002, id 512).
 *
 * Corruption: premature maturity used the stored leg2_accrued_interest sentinel
 * (999999.9999) so clean = dirty - accrued became -999902.2622.
 *
 * Correct accrued is recomputed from the ISIN master coupon calendar.
 *
 * Usage: node scripts/fix-corrupted-leg2-bb20260610002.js [--execute]
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const BB_ID = 129;
const GSEC_ID = 512;

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function calcDaysBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.ceil(Math.abs(b - a) / (1000 * 60 * 60 * 24));
}

function calcAccruedPer100(couponRate, valueDate, issueDate) {
  const cr = parseFloat(couponRate) / 100;
  const settle = new Date(valueDate);
  const issue = new Date(issueDate);
  const frequency = 2;
  const couponPer100 = (100 * cr) / frequency;
  const monthsPerPeriod = 12 / frequency;
  let lastCoupon = new Date(issue);
  while (lastCoupon <= settle) lastCoupon.setMonth(lastCoupon.getMonth() + monthsPerPeriod);
  lastCoupon.setMonth(lastCoupon.getMonth() - monthsPerPeriod);
  const nextCoupon = new Date(lastCoupon);
  nextCoupon.setMonth(nextCoupon.getMonth() + monthsPerPeriod);
  const daysInPeriod = calcDaysBetween(nextCoupon, lastCoupon);
  const daysAccrued = calcDaysBetween(settle, lastCoupon);
  return round4(couponPer100 * (daysAccrued / daysInPeriod));
}

(async () => {
  const [bbRows] = await db.query(
    'SELECT id, deal_number, leg2_isin, leg2_value_date, leg2_settlement_amount, leg2_face_value, leg2_clean_price, leg2_dirty_price, leg2_accrued_interest FROM buyback_deals WHERE id = ?',
    [BB_ID]
  );
  if (!bbRows.length) throw new Error('Buyback not found');
  const bb = bbRows[0];

  const [imRows] = await db.query(
    'SELECT coupon_rate, issue_date FROM isin_master WHERE isin_number = ? LIMIT 1',
    [bb.leg2_isin]
  );
  if (!imRows.length) throw new Error('ISIN master not found');
  const im = imRows[0];

  const dirty = round4((parseFloat(bb.leg2_settlement_amount) / parseFloat(bb.leg2_face_value)) * 100);
  const accrued = calcAccruedPer100(im.coupon_rate, bb.leg2_value_date, im.issue_date);
  const clean = round4(dirty - accrued);

  console.log('=== Recalculated leg2 (ISIN-based) ===');
  console.log({ isin: bb.leg2_isin, value_date: String(bb.leg2_value_date).slice(0, 10), dirty, accrued, clean });
  console.log('\nBuyback current:', {
    clean: bb.leg2_clean_price, dirty: bb.leg2_dirty_price, accrued: bb.leg2_accrued_interest
  });

  const [gRows] = await db.query(
    'SELECT id, deal_number, clean_price, dirty_price, accrued_interest FROM gsec WHERE id = ?',
    [GSEC_ID]
  );
  console.log('GSEC current:', gRows[0]);

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  await db.query(
    'UPDATE buyback_deals SET leg2_clean_price = ?, leg2_dirty_price = ?, leg2_accrued_interest = ?, updated_at = NOW() WHERE id = ?',
    [clean, dirty, accrued, BB_ID]
  );
  await db.query(
    'UPDATE gsec SET clean_price = ?, dirty_price = ?, accrued_interest = ?, updated_at = NOW() WHERE id = ?',
    [clean, dirty, accrued, GSEC_ID]
  );

  const [bbAfter] = await db.query(
    'SELECT leg2_clean_price, leg2_dirty_price, leg2_accrued_interest FROM buyback_deals WHERE id = ?',
    [BB_ID]
  );
  const [gAfter] = await db.query(
    'SELECT clean_price, dirty_price, accrued_interest FROM gsec WHERE id = ?',
    [GSEC_ID]
  );
  console.log('\nBuyback after:', bbAfter[0]);
  console.log('GSEC after:', gAfter[0]);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
