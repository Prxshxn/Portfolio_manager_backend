/* eslint-disable no-console */
'use strict';

/**
 * Recovery for Sell/Buy buybacks whose auto-created leg2 Buy GSEC holding was
 * deleted (and whose buyback_deals row stored garbage leg2 prices: clean/dirty/
 * yield = 0, accrued = 999999.9999).
 *
 * Scope (confirmed): LEG2 BUY ONLY. The leg1 Sell deduction (source buy deals'
 * remaining_face_value) and the leg1 Sell ledger are intact and are NOT touched.
 *
 * For each target buyback this:
 *   1. Recomputes the leg2 buy prices:
 *        accruedPer100 = coupon-period accrual at the leg2 value date
 *        dirty         = leg2_settlement_amount / leg2_face * 100   (truncated 4dp)
 *        clean         = dirty - accruedPer100                       (truncated 4dp)
 *        yield         = solved (bisection) so price(yield) == clean
 *   2. Patches buyback_deals leg2_clean_price / leg2_dirty_price /
 *      leg2_accrued_interest / leg2_yield_rate with the corrected values.
 *   3. Recreates the leg2 Buy gsec row via Gsec.create (same field construction as
 *      buybackDealController final-approval), linking buyback_deal_id.
 *
 * The leg2 buy LEDGER is intentionally NOT posted here: leg2 value date
 * (2026-06-15) is after the current system day, so it is deferred. The existing
 * EOD buyback-leg2 block posts it once the book day reaches the value date.
 *
 * Idempotent: skips any buyback that already has a leg2 Buy gsec row.
 *
 * Usage:
 *   node scripts/recover-buyback-leg2-buy.js            # DRY RUN (no writes)
 *   node scripts/recover-buyback-leg2-buy.js --confirm  # apply changes
 */

const db = require('../config/database');
const Gsec = require('../models/gsec');
const { priceTripletAtYield } = require('../services/excelBondPricing');
const {
  resolveIsinCouponDates,
  getCouponPeriodLengthDaysFromIsinSchedule,
  getCouponPeriodEOverride
} = require('../services/gsecCouponPeriod');

const CONFIRM = process.argv.includes('--confirm');
const BUYBACKS = ['BB20260608002', 'BB20260608003', 'BB20260608004'];

function trunc4(x) {
  return Math.floor(Number(x) * 10000) / 10000;
}
function fmt(n) {
  if (n === null || n === undefined) return '(null)';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function ymd(d) {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

/** Solve the (annual) yield whose clean price equals targetClean, via bisection. */
function solveYieldForClean({ couponRate, valueDate, maturityDate, targetClean }) {
  let lo = 0.0001;
  let hi = 60;
  const priceAt = (y) =>
    priceTripletAtYield({ couponRate, yieldRate: y, valueDate, maturityDate }).cleanPrice;
  // price decreases as yield increases
  if (!Number.isFinite(priceAt(lo)) || !Number.isFinite(priceAt(hi))) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const p = priceAt(mid);
    if (!Number.isFinite(p)) return null;
    if (Math.abs(p - targetClean) < 1e-7) return mid;
    if (p > targetClean) lo = mid; // need higher yield to lower price
    else hi = mid;
  }
  return (lo + hi) / 2;
}

async function processBuyback(bbNum) {
  console.log('\n================================================================');
  console.log('  BUYBACK:', bbNum, CONFIRM ? '(WRITE)' : '(dry-run)');
  console.log('================================================================');

  const [bbRows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ?', [bbNum]);
  if (!bbRows.length) {
    console.log('  NOT FOUND in buyback_deals -> skip');
    return;
  }
  const bb = bbRows[0];

  if (bb.deal_status !== 'Approved') {
    console.log(`  deal_status = ${bb.deal_status} (expected Approved) -> skip`);
    return;
  }
  if (bb.leg2_transaction_type !== 'Buy') {
    console.log(`  leg2_transaction_type = ${bb.leg2_transaction_type} (expected Buy) -> skip`);
    return;
  }

  // Idempotency: skip if a leg2 Buy gsec row already exists.
  const face = Number(
    bb.leg2_adjusted_face_value != null ? bb.leg2_adjusted_face_value : bb.leg2_face_value
  );
  const [existingLink] = await db.query('SELECT id, deal_number FROM gsec WHERE buyback_deal_id = ?', [bb.id]);
  if (existingLink.length) {
    console.log(`  leg2 Buy gsec already exists (id=${existingLink[0].id}, ${existingLink[0].deal_number}) -> skip`);
    return;
  }
  const [existingMatch] = await db.query(
    `SELECT id, deal_number FROM gsec
     WHERE transaction_type='Buy' AND isin_number=? AND value_date=? AND ROUND(face_value,2)=ROUND(?,2)`,
    [bb.leg2_isin, bb.leg2_value_date, face]
  );
  if (existingMatch.length) {
    console.log(`  leg2 Buy gsec match already exists (id=${existingMatch[0].id}, ${existingMatch[0].deal_number}) -> skip`);
    return;
  }

  // ISIN static data
  const [isinRows] = await db.query('SELECT * FROM isin_master WHERE isin_number = ?', [bb.leg2_isin]);
  if (!isinRows.length) {
    console.log(`  isin_master not found for ${bb.leg2_isin} -> skip`);
    return;
  }
  const isin = isinRows[0];
  const couponRate = Number(bb.coupon_rate || isin.coupon_rate || 0);
  const issueDate = bb.issue_date || isin.issue_date;
  const maturityDate = bb.maturity_date || isin.maturity_date;
  const valueDate = ymd(bb.leg2_value_date);

  // Coupon-period boundaries (same helpers as the controller)
  let lastCouponDate = null;
  let nextCouponDate = null;
  let numberOfDaysForCouponPeriod = null;
  let numberOfDaysInterestAccrued = null;
  try {
    const resolved = resolveIsinCouponDates({
      isin_number: bb.leg2_isin,
      coupon_date_1: isin.coupon_date_1,
      coupon_date_2: isin.coupon_date_2
    });
    const sched = getCouponPeriodLengthDaysFromIsinSchedule(
      valueDate, maturityDate, resolved.coupon_date_1, resolved.coupon_date_2
    );
    if (sched && sched.E > 0) {
      lastCouponDate = sched.lastCoupon.toISOString().slice(0, 10);
      nextCouponDate = sched.nextCoupon.toISOString().slice(0, 10);
      numberOfDaysForCouponPeriod = sched.E;
      numberOfDaysInterestAccrued = Math.floor(
        (new Date(valueDate) - sched.lastCoupon) / (1000 * 60 * 60 * 24)
      );
    }
  } catch (e) {
    console.warn('  coupon-period calc failed:', e.message);
  }
  const eOverride = getCouponPeriodEOverride(bb.leg2_isin);
  if (eOverride) numberOfDaysForCouponPeriod = eOverride;

  // Accrued per 100 at leg2 value date = couponPayment * A / E
  const couponPayment = (couponRate / 100) * (100 / 2); // semi-annual coupon per 100
  const E = numberOfDaysForCouponPeriod || 184;
  const A = numberOfDaysInterestAccrued != null ? numberOfDaysInterestAccrued : 0;
  const accruedPer100 = trunc4(E > 0 ? couponPayment * (A / E) : 0);

  // Prices from the stored settlement (authoritative cash), truncated to 4dp.
  const settlement = Number(bb.leg2_settlement_amount || 0);
  const dirty = trunc4((settlement / face) * 100);
  const clean = trunc4(dirty - accruedPer100);

  // Solve yield to match the derived clean price (informational; used if later sold)
  let solvedYield = solveYieldForClean({ couponRate, valueDate, maturityDate, targetClean: clean });
  solvedYield = solvedYield != null ? Math.round(solvedYield * 1000000) / 1000000 : null;

  // Coupon interest stored semi-annual (current convention for auto-created buyback legs)
  const couponInterest = (face * couponRate) / 100 / 2;

  console.log('  Inputs:  face=' + fmt(face) + '  VD=' + valueDate + '  settle=' + fmt(settlement));
  console.log('  ISIN:    coupon_rate=' + couponRate + '  maturity=' + ymd(maturityDate) +
    '  lastCpn=' + lastCouponDate + '  nextCpn=' + nextCouponDate + '  E=' + E + '  A=' + A);
  console.log('  Derived: accruedPer100=' + accruedPer100 + '  dirty=' + dirty + '  clean=' + clean +
    '  yield=' + solvedYield);
  console.log('  couponInterest (semi-annual) = ' + fmt(couponInterest));
  console.log('  buyback_deals leg2 BEFORE: clean=' + bb.leg2_clean_price + ' dirty=' + bb.leg2_dirty_price +
    ' accrued=' + bb.leg2_accrued_interest + ' yield=' + bb.leg2_yield_rate);

  if (!CONFIRM) {
    console.log('  [dry-run] would PATCH buyback_deals leg2 prices and CREATE leg2 Buy gsec row + link buyback_deal_id.');
    console.log('  [dry-run] leg2 buy ledger stays deferred (value date after system day); EOD will post it.');
    return;
  }

  // 1) Patch buyback_deals leg2 prices
  await db.query(
    `UPDATE buyback_deals
     SET leg2_clean_price = ?, leg2_dirty_price = ?, leg2_accrued_interest = ?, leg2_yield_rate = ?
     WHERE id = ?`,
    [clean, dirty, accruedPer100, solvedYield, bb.id]
  );
  console.log('  PATCHED buyback_deals leg2 prices.');

  // 2) Recreate leg2 Buy gsec row (mirrors buybackDealController final-approval)
  const couponDate1 = bb.coupon_date1 || isin.coupon_date_1;
  const couponDate2 = bb.coupon_date2 || isin.coupon_date_2;
  const gsecDealData = {
    tradeType: bb.leg2_trade_type || 'BuyBack',
    transactionType: 'Buy',
    counterparty: bb.leg2_counterparty,
    broker: bb.leg1_broker || null,
    dealNumber: null,
    isin: bb.leg2_isin,
    faceValue: face,
    valueDate: bb.leg2_value_date,
    nextCouponDate,
    lastCouponDate,
    numberOfDaysInterestAccrued,
    numberOfDaysForCouponPeriod,
    accruedInterest: accruedPer100,
    couponInterest,
    cleanPrice: clean,
    dirtyPrice: dirty,
    accruedInterestCalculation: couponRate > 0 ? couponRate / 2 : null,
    accruedInterestSixDecimals: null,
    accruedInterestFor100: null,
    accruedInterestBase: null,
    settlementAmount: settlement,
    settlementMode: bb.leg2_settlement_mode,
    issueDate,
    maturityDate,
    couponDates: couponDate1 && couponDate2 ? `${couponDate1},${couponDate2}` : `${couponDate1 || ''},${couponDate2 || ''}`,
    yield: solvedYield,
    brokerage: bb.leg1_brokerage || 0,
    currency: bb.leg2_currency || 'LKR',
    portfolio: bb.leg2_portfolio,
    strategy: bb.leg2_strategy,
    accruedInterestAdjustment: null,
    cleanPriceAdjustment: null,
    custodian: bb.leg2_custodian,
    tradeDate: bb.leg2_trade_date || bb.leg2_value_date,
    userId: 1,
    current_approval_level: null,
    status: 'final_approved'
  };

  const result = await Gsec.create(gsecDealData);
  if (!result || !result.insertId) {
    console.error('  FAILED to create leg2 Buy gsec row.');
    return;
  }
  await db.query('UPDATE gsec SET buyback_deal_id = ? WHERE id = ?', [bb.id, result.insertId]);

  const [created] = await db.query(
    `SELECT deal_number, face_value, remaining_face_value, clean_price, dirty_price, accrued_interest,
            coupon_interest, per_day_accrual, per_day_amortization, value_date, maturity_date, status
     FROM gsec WHERE id = ?`,
    [result.insertId]
  );
  const c = created[0];
  console.log(`  CREATED leg2 Buy gsec id=${result.insertId} deal=${c.deal_number} (buyback_deal_id=${bb.id})`);
  console.log(`    face=${fmt(c.face_value)} remaining=${fmt(c.remaining_face_value)} clean=${c.clean_price} ` +
    `dirty=${c.dirty_price} couponInt=${fmt(c.coupon_interest)} pda=${c.per_day_accrual} amort=${c.per_day_amortization}`);
  console.log('    leg2 buy ledger DEFERRED until EOD reaches value date ' + ymd(c.value_date) + '.');
}

(async () => {
  console.log('================================================================');
  console.log('  Sell/Buy buyback leg2 recovery', CONFIRM ? '(WRITE MODE)' : '(DRY RUN - no writes)');
  console.log('================================================================');

  for (const bbNum of BUYBACKS) {
    try {
      await processBuyback(bbNum);
    } catch (e) {
      console.error('  ERROR processing', bbNum, ':', e.message);
    }
  }

  console.log('\n================================================================');
  console.log(CONFIRM ? '  DONE. Re-run the inspection to verify.' : '  DRY RUN complete. Re-run with --confirm to apply.');
  console.log('================================================================');
  await db.pool.end();
  process.exit(0);
})().catch((e) => { console.error('Error:', e); process.exit(1); });
