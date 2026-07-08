/**
 * GSec final-approval ledger posting (Buy compound + Sell multi-line).
 * Shared by gsec.updateStatus, backfillLedgerEntries, and buyback approval.
 */
const db = require('../config/database');
const { computeGsecPerDayAccrual, findCouponPeriodFromMaturity } = require('./gsecCouponPeriod');
const { priceTripletAtYield } = require('./excelBondPricing');

/** Format a Date / ISO string as 'YYYY-MM-DD' in UTC so day boundaries are stable. */
function toYmdUtc(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcDayDiffSigned(a, b) {
  const da = new Date(a);
  const dbb = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(dbb.getTime())) return 0;
  const aUtc = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const bUtc = Date.UTC(dbb.getFullYear(), dbb.getMonth(), dbb.getDate());
  return (aUtc - bUtc) / (24 * 60 * 60 * 1000);
}

function truncate8(x) {
  return Math.floor(Number(x) * 100000000) / 100000000;
}

/** Reject sentinel/garbage accrued_interest_calculation (per-100 semi-annual coupon %). */
const SENTINEL_ACCRUED_THRESHOLD = 9999;

function isSaneAccruedPer100(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 50 && n < SENTINEL_ACCRUED_THRESHOLD;
}

function isSaneCleanPer100(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 200;
}

/**
 * Annual coupon rate (percent, e.g. 10 for 10%) for effective-yield carry pricing.
 * Prefers buy.accrued_interest_calculation × 2; falls back to isin_master.coupon_rate.
 */
async function resolveAnnualCouponRatePercent(buyDeal) {
  const semi = Number(buyDeal.accrued_interest_calculation);
  if (isSaneAccruedPer100(semi)) {
    const annual = semi * 2;
    if (annual > 0 && annual <= 100) return annual;
  }
  const isin = buyDeal.isin_number || buyDeal.isin;
  if (isin) {
    const [rows] = await db.query(
      'SELECT coupon_rate FROM isin_master WHERE isin_number = ? LIMIT 1',
      [isin]
    );
    const cr = Number(rows?.[0]?.coupon_rate);
    if (Number.isFinite(cr) && cr > 0 && cr <= 100) return cr;
  }
  return null;
}

/** Same default as buy compound path when settlement_accounts / mappings are missing */
const DEFAULT_GSEC_BANK_LEDGER_CODE = '131-101-410-164-44';

function isPositiveFiniteAmount(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0;
}

function filterValidLines(lines) {
  return (lines || []).filter((l) => l && l.account_code && isPositiveFiniteAmount(l.amount));
}

/**
 * DR bank on GSec sell: settlement_accounts by leg settlement_mode, else mapping GSEC_DEFAULT_SETTLEMENT, else hard default.
 */
async function resolveSellDrBankAccount(transaction) {
  const accountMapping = require('./accountMappingService');
  if (transaction.settlement_mode) {
    try {
      const [settlementAccount] = await db.query(
        'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
        [transaction.settlement_mode]
      );
      if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
        return settlementAccount[0].ledger_account_code;
      }
    } catch (settlementError) {
      console.error('Error fetching settlement account:', settlementError);
    }
  }
  const mapped = await accountMapping.getAccountCodeOptional(
    accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT
  );
  return mapped || DEFAULT_GSEC_BANK_LEDGER_CODE;
}

/**
 * @param {object} transaction - gsec row (snake_case)
 * @param {object} [options]
 * @param {string} [options.descriptionPrefix] - e.g. "Buyback BB-1 - "
 * @param {string} [options.dealIdOverride] - ledger deal_number if different from transaction.deal_number
 * @param {boolean} [options.bankAmountFromSettlement] - Buyback callers only: post the bank
 *   leg at the deal's stored settlement_amount instead of Face×Dirty/100. Treasury stays at
 *   Face×Clean/100; Accrued Interest absorbs the difference so DR still balances CR.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function postFinalApprovedBuyLedger(transaction, options = {}) {
  const ledgerController = require('../controllers/ledgerController');
  const accountMapping = require('./accountMappingService');
  const prefix = options.descriptionPrefix || '';
  const dealId = options.dealIdOverride || transaction.deal_number;

  const faceVal = Number(transaction.face_value || 0);
  const buyClean = Number(transaction.clean_price || 0);
  const buyDirty = Number(transaction.dirty_price || 0);
  let accruedInterest = Number(transaction.accrued_interest || 0);
  if (!Number.isFinite(accruedInterest) || accruedInterest < 0) accruedInterest = 0;

  let netAmount = 0;
  let bankTotal = Number(transaction.settlement_amount || transaction.face_value || 0);

  // Senior buy convention (price-derived, not stored settlement_amount):
  //   Accrued (458)  = Face × (Dirty − Clean) / 100
  //   Treasury (453) = Face × Clean / 100
  //   Bank (464) CR  = Face × Dirty / 100  (= Treasury + Accrued)
  // Stored settlement_amount can differ slightly from Face×Dirty/100 on buyback legs.
  if (faceVal > 0 && buyClean > 0 && buyDirty > 0 && buyDirty >= buyClean) {
    netAmount = truncate8((buyClean * faceVal) / 100);
    if (options.bankAmountFromSettlement) {
      // Buyback: bank leg = stored settlement_amount; Accrued Interest is the plug
      // that reconciles Treasury (price-based) up to the settlement amount.
      const settlementAmt = Number(transaction.settlement_amount || 0);
      bankTotal = settlementAmt > 0 ? settlementAmt : truncate8((buyDirty * faceVal) / 100);
      accruedInterest = truncate8(bankTotal - netAmount);
    } else {
      accruedInterest = truncate8(((buyDirty - buyClean) * faceVal) / 100);
      bankTotal = truncate8((buyDirty * faceVal) / 100);
    }
  } else {
    // Fallback when prices missing: split stored settlement.
    if (!accruedInterest && bankTotal > 0) accruedInterest = 0;
    netAmount = truncate8(bankTotal - accruedInterest);
  }

  const treasuryBondsAccount =
    options.treasuryAccountOverride ||
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT)) ||
    '131-101-350-098-44';
  const accruedInterestAccount =
    options.accruedAccountOverride ||
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUED_INTEREST_PAID)) ||
    '131-101-350-128-44';

  let bankAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT)) ||
    DEFAULT_GSEC_BANK_LEDGER_CODE;
  if (transaction.settlement_mode) {
    try {
      const [settlementAccount] = await db.query(
        'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
        [transaction.settlement_mode]
      );
      if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
        bankAccount = settlementAccount[0].ledger_account_code;
      }
    } catch (settlementError) {
      console.error('Error fetching settlement account:', settlementError);
    }
  }

  const ledgerResult = await ledgerController.postCompoundLedgerEntry({
    date: toYmdUtc(transaction.value_date) || toYmdUtc(new Date()),
    dr_accounts: [
      {
        account_code: treasuryBondsAccount,
        amount: netAmount,
        description: `${prefix}GSec Purchase - Treasury Bonds - ${transaction.deal_number}`
      },
      {
        account_code: accruedInterestAccount,
        amount: accruedInterest,
        description: `${prefix}GSec Purchase - Accrued Interest - ${transaction.deal_number}`
      }
    ],
    cr_account: bankAccount,
    deal_id: dealId,
    description: `${prefix}GSec Purchase - Final Approval - ${transaction.deal_number}`
  });

  if (!ledgerResult.success) {
    console.error('Failed to post GSec compound ledger entry:', ledgerResult.error);
    return { success: false, error: ledgerResult.error };
  }
  console.log(`Successfully created compound ledger entries for GSEC Buy transaction ${dealId}`);
  console.log(`  Treasury Bonds (net): ${netAmount}, Accrued Interest: ${accruedInterest}, Bank total: ${bankTotal}`);
  return { success: true };
}

/**
 * @param {object} transaction - gsec-shaped row; must include deal_number, transaction_type Sell fields
 * @param {object} [options]
 * @param {string} [options.descriptionPrefix]
 * @param {string} [options.dealIdOverride]
 * @returns {Promise<{ success: boolean, error?: string, legacy?: boolean }>}
 */
async function postFinalApprovedSellLedger(transaction, options = {}) {
  const ledgerController = require('../controllers/ledgerController');
  const accountMapping = require('./accountMappingService');
  const prefix = options.descriptionPrefix || '';
  const dealId = options.dealIdOverride || transaction.deal_number;
  const amount = Number(transaction.settlement_amount || transaction.face_value || 0);

  const sellDate = toYmdUtc(transaction.value_date) || toYmdUtc(new Date());

  const drAccount = await resolveSellDrBankAccount(transaction);

  let buyDeal = null;
  if (transaction.buy_deal_number) {
    const [buyRows] = await db.query(
      `SELECT deal_number, value_date, trade_date, maturity_date, issue_date,
              face_value, clean_price, dirty_price, yield,
              accrued_interest_calculation, last_coupon_date, next_coupon_date,
              per_day_amortization, coupon_interest, remaining_face_value, isin_number
       FROM gsec
       WHERE transaction_type = 'Buy' AND deal_number = ?
       LIMIT 1`,
      [transaction.buy_deal_number]
    );
    buyDeal = buyRows && buyRows[0] ? buyRows[0] : null;
  }

  if (buyDeal && options.buyDealPatch) {
    buyDeal = { ...buyDeal, ...options.buyDealPatch };
  }

  // Allow callers (e.g. Buy/Sell buybacks that don't persist a GSec holding) to
  // supply the buy-side context so the full P&L sell journal is produced instead
  // of the simplified legacy entry.
  if (!buyDeal && options.buyDealOverride) {
    buyDeal = options.buyDealOverride;
  }

  if (!buyDeal) {
    const crAccount =
      (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS)) ||
      '131-101-350-098-44';
    const description = `${prefix}GSec Sale - Final Approval - ${transaction.deal_number}`;
    const ledgerResult = await ledgerController.postLedgerEntry({
      date: sellDate,
      dr_account: drAccount,
      cr_account: crAccount,
      amount,
      deal_id: dealId,
      description
    });
    if (!ledgerResult.success) {
      console.error('Failed to post legacy GSec sell ledger entry:', ledgerResult.error);
      return { success: false, error: ledgerResult.error, legacy: true };
    }
    return { success: true, legacy: true };
  }

  // ---------------------------------------------------------------------------
  // Senior-accountant convention for a GSec Sell journal (effective-yield method):
  //
  //   Treasury Bonds OUT (CR 453)              = sellFace x buyClean / 100
  //   Accrued Coupon Paid at Purchase (CR 458) = sellFace x (buyDirty - buyClean) / 100
  //                                              = unwind of accrued you paid at buy
  //   Amort (CR or DR 505)                     = sellFace x (carryClean - buyClean) / 100
  //                                              carryClean = bond re-priced at the
  //                                              BUY yield on the SELL date (pull-to-par
  //                                              under the original yield curve).
  //   Coupon Interest Income (CR 574)          = sellFace x (sellAccruedPer100 - buyAccruedPer100) / 100
  //                                              i.e. the coupon income EARNED during the
  //                                              holding period only (not the full sell accrued).
  //   Capital Gain (CR or DR 502)              = sellFace x (sellClean - carryClean) / 100
  //                                              clean-to-clean P&L vs carrying value.
  //   Bank IN (DR settlement_account)          = sellFace x sellDirty / 100  (= settlement_amount)
  //
  //   Reversal pair:
  //     DR Interest Income Accrued (570) and CR Accrued Receivable (568) =
  //         holding-period Coupon Income (not the full sell accrued).
  //
  // If the buy row is missing yield / coupon dates required for carryClean,
  // fall back to the legacy per_day_amortization x holdingDays x scale formula
  // so older deals can still be posted.
  // ---------------------------------------------------------------------------

  const sellFace = Number(transaction.face_value || 0);
  const buyFace = Number(buyDeal.face_value || 0);
  const scale = buyFace > 0 ? sellFace / buyFace : 1;
  const buyClean = Number(buyDeal.clean_price || 0);
  const buyDirty = Number(buyDeal.dirty_price || 0);
  const sellClean = Number(transaction.clean_price || 0);
  const sellDirty = Number(transaction.dirty_price || 0);
  const sellSettlement = Number(transaction.settlement_amount || 0);
  const holdingDays = Math.max(0, utcDayDiffSigned(sellDate, buyDeal.value_date));
  const sellAccruedPer100 = Math.max(0, sellDirty - sellClean);

  // 1) Treasury Bonds reversal at buy clean price.
  const treasuryBondsAmt = truncate8((sellFace * buyClean) / 100);

  // 2) Buy-side accrued reversal (unwinds the accrued asset created when buy posted).
  // Prefer linked buy dirty/clean. On same-day exit (e.g. buyback leg1) when buy prices
  // are missing on the row, the sell-side accrued spread equals what was paid at purchase.
  let buyAccruedPer100 = Math.max(0, buyDirty - buyClean);
  if (buyAccruedPer100 <= 0 && sellAccruedPer100 > 0 && holdingDays === 0) {
    buyAccruedPer100 = sellAccruedPer100;
  }
  let accruedAtPurchaseAmt = truncate8((sellFace * buyAccruedPer100) / 100);

  // 4) Holding-period coupon income — only what accrued WHILE we held the bond.
  // Same-day buy/sell (buyback): nothing earned; full spread unwinds via 458, not 574.
  let holdingPeriodAccruedPer100 = holdingDays === 0
    ? 0
    : Math.max(0, sellAccruedPer100 - buyAccruedPer100);
  let holdingCouponIncome = truncate8((sellFace * holdingPeriodAccruedPer100) / 100);

  // 3) Amort via effective-yield — only when the bond was actually held (holdingDays > 0).
  // Same-day buyback has no premium/discount amortisation to recognise.
  let amortToSell = 0;
  let carryClean = null;
  if (holdingDays > 0) {
    const buyYield = Number(buyDeal.yield || 0);
    const annualCouponRate = await resolveAnnualCouponRatePercent(buyDeal);
    if (
      buyYield > 0 &&
      annualCouponRate != null &&
      annualCouponRate > 0 &&
      buyDeal.maturity_date &&
      sellFace > 0
    ) {
      try {
        const carry = priceTripletAtYield({
          couponRate: annualCouponRate,
          yieldRate: buyYield,
          valueDate: sellDate,
          maturityDate: toYmdUtc(buyDeal.maturity_date)
        });
        if (carry && isSaneCleanPer100(carry.cleanPrice)) {
          carryClean = Number(carry.cleanPrice);
          amortToSell = truncate8((sellFace * (carryClean - buyClean)) / 100);
        } else if (carry && !isSaneCleanPer100(carry.cleanPrice)) {
          console.warn(
            `[gsecSellLedger] carry clean out of range for ${transaction.deal_number}:`,
            carry.cleanPrice,
            '(annualCouponRate=',
            annualCouponRate,
            ') — using per_day_amort fallback'
          );
        }
      } catch (e) {
        console.warn(
          `[gsecSellLedger] effective-yield carry calc failed for ${transaction.deal_number}:`,
          e.message
        );
      }
    }
    if (amortToSell === 0 && carryClean == null) {
      // Legacy fallback: straight-line per-day premium/discount amortisation.
      const perDayAmort = Number(buyDeal.per_day_amortization || 0);
      amortToSell = truncate8(perDayAmort * holdingDays) * scale;
    }
  }

  // Same-day buy/sell (e.g. Sell/Buy buyback leg1): no amortisation or carryClean.
  if (holdingDays === 0) {
    amortToSell = 0;
    carryClean = null;
  }

  // 5) Capital gain as the plug, which equals sellFace * (sellClean - carryClean) / 100
  //    (and sellFace * (sellClean - buyClean) / 100 - amortToSell on the legacy path).
  const sumKnownCr = truncate8(
    treasuryBondsAmt + accruedAtPurchaseAmt + holdingCouponIncome + Math.max(0, amortToSell)
  );
  const sumKnownDr = Math.max(0, -amortToSell);
  // residual on the credit side; if negative, capital LOSS (post DR side)
  const capitalGl = truncate8(sellSettlement - sumKnownCr + sumKnownDr);

  const tradingAccount =
    options.treasuryAccountOverride ||
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT)) ||
    '131-101-350-098-44';
  const accruedAtPurchaseAccount =
    options.accruedAtPurchaseAccountOverride ||
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUED_INTEREST_PAID)) ||
    '131-101-350-128-44';
  const amortAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_AMORTISATION_TRADING)) ||
    '358-101-130-416-44';
  const couponIncomeAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_COUPON_INCOME)) ||
    '467-101-190-476-44';
  const capitalGainLossAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_CAPITAL_GAIN_LOSS)) ||
    '358-101-130-398-44';
  const accruedIncomeAccount =
    options.accruedIncomeAccountOverride ||
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME)) ||
    '467-101-190-470-44';
  const accruedReceivableAccount =
    options.accruedReceivableAccountOverride ||
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET)) ||
    '131-101-290-218-44';

  const mainDescription = `${prefix}GSec Sale - Final Approval - ${transaction.deal_number}`;
  const mainDr = [
    { account_code: drAccount, amount: sellSettlement, description: mainDescription }
  ];
  const mainCr = [];

  // CR Treasury Bonds at buy clean price.
  if (treasuryBondsAmt > 0) {
    mainCr.push({ account_code: tradingAccount, amount: treasuryBondsAmt, description: mainDescription });
  }
  // CR Accrued Coupon Interest Paid at Purchase (unwinds the buy-side accrued asset).
  if (accruedAtPurchaseAmt > 0) {
    mainCr.push({
      account_code: accruedAtPurchaseAccount,
      amount: accruedAtPurchaseAmt,
      description: mainDescription
    });
  }
  // Effective-yield AMTZ: sign tells us CR (discount accretion -> income)
  // vs DR (premium decay -> expense).
  if (Number.isFinite(amortToSell) && Math.abs(amortToSell) > 0.00000001) {
    if (amortToSell > 0) {
      mainCr.push({ account_code: amortAccount, amount: amortToSell, description: mainDescription });
    } else {
      mainDr.push({ account_code: amortAccount, amount: Math.abs(amortToSell), description: mainDescription });
    }
  }
  // CR holding-period Coupon Interest Income (only the part EARNED while we held the bond).
  if (holdingCouponIncome > 0) {
    mainCr.push({ account_code: couponIncomeAccount, amount: holdingCouponIncome, description: mainDescription });
  }
  // Capital Gain (CR) or Loss (DR) - clean-to-clean P&L vs carrying value.
  if (Number.isFinite(capitalGl) && Math.abs(capitalGl) > 0.00000001) {
    if (capitalGl >= 0) {
      mainCr.push({ account_code: capitalGainLossAccount, amount: Math.abs(capitalGl), description: mainDescription });
    } else {
      mainDr.push({ account_code: capitalGainLossAccount, amount: Math.abs(capitalGl), description: mainDescription });
    }
  }

  // Remove any empty/0/NaN lines before balancing and posting.
  const mainDrClean = filterValidLines(mainDr);
  const mainCrClean = filterValidLines(mainCr);

  const sumLines = (arr) => arr.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const totalDr = sumLines(mainDrClean);
  const totalCr = sumLines(mainCrClean);
  const residual = truncate8(totalDr - totalCr);
  if (Number.isFinite(residual) && Math.abs(residual) > 0.00000001) {
    const roundingLine = {
      account_code: capitalGainLossAccount,
      amount: Math.abs(residual),
      description: `${mainDescription} (Rounding)`
    };
    if (isPositiveFiniteAmount(roundingLine.amount)) {
      if (residual > 0) {
        mainCrClean.push(roundingLine);
      } else {
        mainDrClean.push(roundingLine);
      }
    }
  }

  const reversalDescription = `${prefix}GSec Sale - Accrued Interest Reversal - ${transaction.deal_number}`;
  // Reversal pair carries HOLDING-PERIOD coupon income only - what we accrued daily into
  // 568/570 while holding the bond. Buy-side accrued (paid at purchase) is reversed
  // separately via account 458 in the main entry above.
  const reversalDr =
    holdingCouponIncome > 0
      ? [{ account_code: accruedIncomeAccount, amount: holdingCouponIncome, description: reversalDescription }]
      : [];
  const reversalCr =
    holdingCouponIncome > 0
      ? [{ account_code: accruedReceivableAccount, amount: holdingCouponIncome, description: reversalDescription }]
      : [];

  // Preview mode: return the fully-computed journal without posting anything.
  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      date: sellDate,
      deal_id: dealId,
      main: { dr_lines: mainDrClean, cr_lines: mainCrClean, description: mainDescription },
      reversal:
        reversalDr.length && reversalCr.length
          ? { dr_lines: reversalDr, cr_lines: reversalCr, description: reversalDescription }
          : null,
      computed: {
        sellFace,
        buyFace,
        scale,
        buyClean,
        buyDirty,
        sellClean,
        sellDirty,
        carryClean,
        sellSettlement,
        sellAccruedPer100,
        buyAccruedPer100,
        holdingPeriodAccruedPer100,
        treasuryBondsAmt,
        accruedAtPurchaseAmt,
        amortToSell,
        holdingCouponIncome,
        capitalGl,
        holdingDays
      }
    };
  }

  const postMulti = ledgerController.postMultiLineLedgerEntry;
  if (typeof postMulti !== 'function') {
    return { success: false, error: 'postMultiLineLedgerEntry is not available in ledgerController' };
  }

  const mainResult = await postMulti({
    date: sellDate,
    dr_accounts: mainDrClean,
    cr_accounts: mainCrClean,
    deal_id: dealId,
    description: mainDescription
  });
  if (!mainResult.success) {
    console.error('Failed to post GSec sell multi-line entry:', mainResult.error);
    return { success: false, error: mainResult.error };
  }

  if (reversalDr.length && reversalCr.length) {
    const revResult = await postMulti({
      date: sellDate,
      dr_accounts: reversalDr,
      cr_accounts: reversalCr,
      deal_id: dealId,
      description: reversalDescription
    });
    if (!revResult.success) {
      // Match gsec.updateStatus: log but do not fail the overall approval path after main leg posted.
      console.error('Failed to post GSec sell accrued reversal entry:', revResult.error);
    }
  }

  console.log(`Successfully created sell multi-line ledger entries for ${dealId}`);
  return { success: true };
}

module.exports = {
  postFinalApprovedBuyLedger,
  postFinalApprovedSellLedger,
  utcDayDiffSigned,
  toYmdUtc,
  truncate8
};
