'use strict';

/**
 * Ledger posting for "Buy/Sell" buybacks (leg1 = Buy, leg2 = Sell).
 *
 * This mirrors the existing "Sell/Buy" buyback accounting (leg1 Sell + leg2 Buy)
 * that already lives in buybackDealController, but for the opposite direction.
 *
 * Scope (per product decision): LEDGER ENTRIES ONLY.
 *   - leg1 Buy  -> posts the GSec purchase ledger (DR Treasury Bonds + DR Accrued, CR Bank)
 *   - leg2 Sell -> posts the GSec sale ledger (DR Bank, CR Treasury Bonds ...)
 *   - Does NOT create or deduct any GSec holding rows.
 *
 * Posting respects the same deferral rule as GSec EOD: a leg only posts once the
 * book system day is on/after that leg's value date. Each leg is guarded against
 * duplicate posting by its synthetic ledger deal number.
 */

const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const {
  postFinalApprovedBuyLedger,
  postFinalApprovedSellLedger
} = require('./gsecApprovalLedgerService');

// Buyback-specific asset accounts (distinct from the standard GSec trading accounts)
// so Buy/Sell buyback holdings post to dedicated buyback ledgers. Used on the buy
// leg (DR) and on the sell-leg reversal (CR) so the accounts net to zero.
const BUYBACK_TREASURY_ACCOUNT = '131-101-350-204-44'; // Treasury Bonds - Trading A/C (Buyback)
const BUYBACK_ACCRUED_ACCOUNT = '131-101-350-208-44'; // Accrued Coupon Interest Paid at Purchase - TBond Trading (Buyback)

function toYmd(d) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
}

/** Same rule used by GSec EOD: only settle once system day >= value date (UTC day compare). */
function valueDateOnOrBeforeSystemDay(valueDate, systemDay) {
  if (valueDate == null || systemDay == null) return false;
  const v = new Date(valueDate);
  const s = new Date(systemDay);
  if (Number.isNaN(v.getTime()) || Number.isNaN(s.getTime())) return false;
  const vUtc = Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
  const sUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  return vUtc <= sUtc;
}

async function ledgerCount(dealNumber) {
  const [rows] = await db.query(
    'SELECT COUNT(*) AS cnt FROM ledger_entries WHERE deal_number = ?',
    [dealNumber]
  );
  return Number(rows[0]?.cnt || 0);
}

function legFace(adjusted, base) {
  const v = adjusted !== null && adjusted !== undefined ? adjusted : base;
  return parseFloat(v) || 0;
}

/**
 * Build a gsec-Buy-shaped context object from the buyback's leg1 (the Buy leg),
 * filling maturity/coupon from ISIN master when not stored on the buyback row.
 * Used as the buyDealOverride so the leg2 Sell ledger computes full P&L.
 */
async function buildLeg1BuyDealContext(bb) {
  let isin = {};
  try {
    const [rows] = await db.query(
      'SELECT issue_date, maturity_date, coupon_rate FROM isin_master WHERE isin_number = ? LIMIT 1',
      [bb.leg1_isin]
    );
    if (rows && rows[0]) isin = rows[0];
  } catch (e) {
    // Non-fatal: fall back to whatever the buyback row carries.
    console.warn(`buildLeg1BuyDealContext: ISIN lookup failed for ${bb.leg1_isin}: ${e.message}`);
  }

  const couponRate = parseFloat(bb.coupon_rate ?? isin.coupon_rate ?? 0) || 0;

  return {
    deal_number: `${bb.deal_number}/BB-L1/BUY`,
    value_date: bb.leg1_value_date,
    trade_date: bb.leg1_trade_date || bb.leg1_value_date,
    maturity_date: bb.maturity_date || isin.maturity_date || null,
    issue_date: bb.issue_date || isin.issue_date || null,
    face_value: legFace(bb.leg1_adjusted_face_value, bb.leg1_face_value),
    clean_price: bb.leg1_clean_price,
    dirty_price: bb.leg1_dirty_price,
    yield: bb.leg1_yield_rate,
    // gsec stores the per-period (semi-annual) coupon; the sell service doubles it
    // back to an annual rate for the effective-yield carry price.
    accrued_interest_calculation: couponRate ? couponRate / 2 : null,
    last_coupon_date: null,
    next_coupon_date: null,
    per_day_amortization: 0,
    coupon_interest: null,
    remaining_face_value: null,
    isin_number: bb.leg1_isin
  };
}

/**
 * Post (or plan) the ledger entries for a Buy/Sell buyback.
 *
 * @param {object} bb - a row from buyback_deals
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - when true, computes the plan but posts nothing
 * @param {string|Date} [opts.systemDate] - override system date (defaults to system_day)
 * @returns {Promise<{ deal_number: string, actions: Array<object> }>}
 */
async function postBuySellBuybackLedger(bb, opts = {}) {
  const dryRun = !!opts.dryRun;
  const actions = [];

  let systemDate = opts.systemDate || null;
  if (!systemDate) {
    const sysRow = await getSystemDay();
    systemDate = sysRow && sysRow.system_date;
  }

  const prefix = `Buyback ${bb.deal_number} - `;

  // ---- leg1 = Buy ----------------------------------------------------------
  if (bb.leg1_transaction_type === 'Buy') {
    const synthetic = `${bb.deal_number}/BB-L1/BUY`;
    const action = { leg: 'leg1', type: 'Buy', deal_number: synthetic, status: 'pending' };

    if ((await ledgerCount(synthetic)) > 0) {
      action.status = 'skipped_exists';
    } else if (!systemDate) {
      action.status = 'skipped_no_system_day';
    } else if (!valueDateOnOrBeforeSystemDay(bb.leg1_value_date, systemDate)) {
      action.status = 'deferred_future_value_date';
      action.value_date = toYmd(bb.leg1_value_date);
      action.system_date = toYmd(systemDate);
    } else {
      const face = legFace(bb.leg1_adjusted_face_value, bb.leg1_face_value);
      action.face_value = face;
      const buyLike = {
        deal_number: synthetic,
        face_value: face,
        settlement_amount: parseFloat(bb.leg1_settlement_amount) || 0,
        accrued_interest: parseFloat(bb.leg1_accrued_interest) || 0,
        clean_price: bb.leg1_clean_price,
        dirty_price: bb.leg1_dirty_price,
        settlement_mode: bb.leg1_settlement_mode,
        value_date: bb.leg1_value_date,
        trade_date: bb.leg1_trade_date || bb.leg1_value_date,
        transaction_type: 'Buy'
      };
      if (dryRun) {
        action.status = 'would_post';
      } else {
        const r = await postFinalApprovedBuyLedger(buyLike, {
          descriptionPrefix: prefix,
          treasuryAccountOverride: BUYBACK_TREASURY_ACCOUNT,
          accruedAccountOverride: BUYBACK_ACCRUED_ACCOUNT
        });
        action.status = r.success ? 'posted' : 'failed';
        if (!r.success) action.error = r.error;
      }
    }
    actions.push(action);
  }

  // ---- leg2 = Sell ---------------------------------------------------------
  // A Buy/Sell buyback sells back exactly what leg1 bought, so the sell leg is a
  // single ledger entry with NO sell allocations and NO portfolio/holding deduction.
  // It is linked to leg1's buy context purely to derive full P&L.
  if (bb.leg2_transaction_type === 'Sell') {
    const synthetic = `${bb.deal_number}/BB-L2/SELL`;
    const action = { leg: 'leg2', type: 'Sell', deal_number: synthetic, status: 'pending' };

    if ((await ledgerCount(synthetic)) > 0) {
      action.status = 'skipped_exists';
    } else if (!systemDate) {
      action.status = 'skipped_no_system_day';
    } else if (!valueDateOnOrBeforeSystemDay(bb.leg2_value_date, systemDate)) {
      action.status = 'deferred_future_value_date';
      action.value_date = toYmd(bb.leg2_value_date);
      action.system_date = toYmd(systemDate);
    } else {
      const face = legFace(bb.leg2_adjusted_face_value, bb.leg2_face_value);
      action.face_value = face;
      const sellLike = {
        deal_number: synthetic,
        buy_deal_number: bb.source_buy_deal_number || null,
        face_value: face,
        settlement_amount: parseFloat(bb.leg2_settlement_amount) || 0,
        accrued_interest: parseFloat(bb.leg2_accrued_interest) || 0,
        clean_price: bb.leg2_clean_price,
        dirty_price: bb.leg2_dirty_price,
        settlement_mode: bb.leg2_settlement_mode,
        value_date: bb.leg2_value_date,
        trade_date: bb.leg2_trade_date || bb.leg2_value_date,
        transaction_type: 'Sell'
      };

      // The leg2 Sell disposes of what leg1 bought. Supply leg1's buy-side context
      // so the sell ledger produces the full P&L journal (Treasury reversal,
      // accrued-at-purchase, amortisation, coupon income, capital gain/loss)
      // instead of the simplified 2-line legacy entry.
      const buyDealOverride = await buildLeg1BuyDealContext(bb);

      if (dryRun) {
        action.status = 'would_post';
      } else {
        const r = await postFinalApprovedSellLedger(sellLike, {
          descriptionPrefix: prefix,
          buyDealOverride,
          treasuryAccountOverride: BUYBACK_TREASURY_ACCOUNT,
          accruedAtPurchaseAccountOverride: BUYBACK_ACCRUED_ACCOUNT
        });
        action.status = r.success ? (r.legacy ? 'posted_legacy' : 'posted') : 'failed';
        if (!r.success) action.error = r.error;
      }
    }
    actions.push(action);
  }

  return { deal_number: bb.deal_number, actions };
}

module.exports = { postBuySellBuybackLedger };
