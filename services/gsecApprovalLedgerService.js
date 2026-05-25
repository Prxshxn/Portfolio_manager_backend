/**
 * GSec final-approval ledger posting (Buy compound + Sell multi-line).
 * Shared by gsec.updateStatus, backfillLedgerEntries, and buyback approval.
 */
const db = require('../config/database');
const { computeGsecPerDayAccrual, findCouponPeriodFromMaturity } = require('./gsecCouponPeriod');

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
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function postFinalApprovedBuyLedger(transaction, options = {}) {
  const ledgerController = require('../controllers/ledgerController');
  const accountMapping = require('./accountMappingService');
  const prefix = options.descriptionPrefix || '';
  const dealId = options.dealIdOverride || transaction.deal_number;

  const settlementAmount = Number(transaction.settlement_amount || transaction.face_value || 0);
  const accruedInterest = Number(transaction.accrued_interest || 0);
  const netAmount = settlementAmount - accruedInterest;

  const treasuryBondsAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT)) ||
    '131-101-350-098-44';
  const accruedInterestAccount =
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
    date: transaction.value_date
      ? new Date(transaction.value_date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
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
  console.log(`  Treasury Bonds (net): ${netAmount}, Accrued Interest: ${accruedInterest}, Total: ${settlementAmount}`);
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
  // #region agent log
  fetch('http://127.0.0.1:7392/ingest/b636a3d1-1bd5-46f2-b184-ba446816f4e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea67d3'},body:JSON.stringify({sessionId:'ea67d3',location:'gsecApprovalLedgerService.js:135',message:'postFinalApprovedSellLedger ENTRY',data:{deal_number:transaction.deal_number,settlement_amount:transaction.settlement_amount,face_value:transaction.face_value,buy_deal_number:transaction.buy_deal_number},timestamp:Date.now(),hypothesisId:'A',runId:'verify'})}).catch(()=>{});
  // #endregion
  const ledgerController = require('../controllers/ledgerController');
  const accountMapping = require('./accountMappingService');
  const prefix = options.descriptionPrefix || '';
  const dealId = options.dealIdOverride || transaction.deal_number;
  const amount = Number(transaction.settlement_amount || transaction.face_value || 0);

  const sellDate = transaction.value_date
    ? new Date(transaction.value_date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const drAccount = await resolveSellDrBankAccount(transaction);

  let buyDeal = null;
  if (transaction.buy_deal_number) {
    const [buyRows] = await db.query(
      `SELECT deal_number, value_date, maturity_date, face_value, clean_price, last_coupon_date, per_day_amortization,
              coupon_interest, remaining_face_value, isin_number
       FROM gsec
       WHERE transaction_type = 'Buy' AND deal_number = ?
       LIMIT 1`,
      [transaction.buy_deal_number]
    );
    buyDeal = buyRows && buyRows[0] ? buyRows[0] : null;
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

  const sellFace = Number(transaction.face_value || 0);
  const buyFace = Number(buyDeal.face_value || 0);
  const scale = buyFace > 0 ? sellFace / buyFace : 1;
  const purchaseCleanPct = Number(buyDeal.clean_price || 0);
  const purchaseCleanAmt = truncate8((buyFace * purchaseCleanPct) / 100) * scale;

  const holdingDays = Math.max(0, utcDayDiffSigned(sellDate, buyDeal.value_date));
  const perDayAmort = Number(buyDeal.per_day_amortization || 0);
  const amortToSell = truncate8(perDayAmort * holdingDays) * scale;

  let couponAccruedToSell = truncate8(Number(transaction.accrued_interest || 0));
  if (!Number.isFinite(couponAccruedToSell) || couponAccruedToSell < 0) couponAccruedToSell = 0;
  if (couponAccruedToSell === 0) {
    try {
      const [isinRows] = await db.query(
        `SELECT coupon_rate, coupon_date_1, coupon_date_2
         FROM isin_master
         WHERE isin_number COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
         LIMIT 1`,
        [buyDeal.isin_number]
      );
      const isin = isinRows && isinRows[0] ? isinRows[0] : {};
      const perDay = computeGsecPerDayAccrual(
        {
          face_value: buyDeal.face_value,
          remaining_face_value: sellFace,
          coupon_interest: buyDeal.coupon_interest,
          coupon_rate: isin.coupon_rate,
          maturity_date: buyDeal.maturity_date,
          isin_number: buyDeal.isin_number,
          coupon_date_1: isin.coupon_date_1,
          coupon_date_2: isin.coupon_date_2
        },
        sellDate,
        2
      );
      if (perDay.ok) {
        let lastCoupon = buyDeal.last_coupon_date ? new Date(buyDeal.last_coupon_date) : null;
        if (!lastCoupon || Number.isNaN(lastCoupon.getTime())) {
          const r = findCouponPeriodFromMaturity(sellDate, buyDeal.maturity_date, 2);
          lastCoupon = r.lastCoupon;
        }
        const daysAccrued = Math.max(0, utcDayDiffSigned(sellDate, lastCoupon));
        couponAccruedToSell = truncate8(perDay.amount * daysAccrued);
      }
    } catch (e) {
      console.warn('Failed to compute coupon accrued-to-sell, defaulting to 0:', e.message);
      couponAccruedToSell = 0;
    }
  }

  const bookValueAtSell = truncate8(purchaseCleanAmt + amortToSell);
  const sellDirtyAmt = truncate8(Number(transaction.settlement_amount || 0));
  const sellCleanAmtEffective = truncate8(sellDirtyAmt - couponAccruedToSell);
  const capitalGl = truncate8(sellCleanAmtEffective - bookValueAtSell);
  // #region agent log
  fetch('http://127.0.0.1:7392/ingest/b636a3d1-1bd5-46f2-b184-ba446816f4e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea67d3'},body:JSON.stringify({sessionId:'ea67d3',location:'gsecApprovalLedgerService.js:235',message:'Capital gain calculation',data:{purchaseCleanAmt,amortToSell,bookValueAtSell,sellDirtyAmt,couponAccruedToSell,sellCleanAmtEffective,capitalGl,holdingDays},timestamp:Date.now(),hypothesisId:'C',runId:'verify'})}).catch(()=>{});
  // #endregion

  const tradingAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT)) ||
    '131-101-350-098-44';
  const amortAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_AMORTISATION_TRADING)) ||
    '358-101-130-416-44';
  const couponIncomeAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_COUPON_INCOME)) ||
    '467-101-190-476-44';
  const capitalGainLossAccount = '358-101-130-398-44';
  const accruedIncomeAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME)) ||
    '467-101-190-470-44';
  const accruedReceivableAccount =
    (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET)) ||
    '131-101-290-218-44';
  // #region agent log
  fetch('http://127.0.0.1:7392/ingest/b636a3d1-1bd5-46f2-b184-ba446816f4e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea67d3'},body:JSON.stringify({sessionId:'ea67d3',location:'gsecApprovalLedgerService.js:258',message:'Account codes resolved',data:{drAccount,tradingAccount,amortAccount,couponIncomeAccount,capitalGainLossAccount,accruedIncomeAccount,accruedReceivableAccount},timestamp:Date.now(),hypothesisId:'E',runId:'verify'})}).catch(()=>{});
  // #endregion

  const mainDescription = `${prefix}GSec Sale - Final Approval - ${transaction.deal_number}`;
  const mainDr = [
    { account_code: drAccount, amount: Number(transaction.settlement_amount || 0), description: mainDescription }
  ];
  const mainCr = [];
  if (purchaseCleanAmt > 0) {
    mainCr.push({ account_code: tradingAccount, amount: purchaseCleanAmt, description: mainDescription });
  }
  if (amortToSell > 0) {
    const isPremium = Number(buyDeal.clean_price || 0) > 100;
    if (isPremium) {
      mainDr.push({ account_code: amortAccount, amount: amortToSell, description: mainDescription });
    } else {
      mainCr.push({ account_code: amortAccount, amount: amortToSell, description: mainDescription });
    }
  }
  if (couponAccruedToSell > 0) {
    mainCr.push({ account_code: couponIncomeAccount, amount: couponAccruedToSell, description: mainDescription });
  }
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
  // #region agent log
  fetch('http://127.0.0.1:7392/ingest/b636a3d1-1bd5-46f2-b184-ba446816f4e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea67d3'},body:JSON.stringify({sessionId:'ea67d3',location:'gsecApprovalLedgerService.js:288',message:'Before balance check',data:{mainDrClean,mainCrClean,totalDr,totalCr,residual},timestamp:Date.now(),hypothesisId:'B',runId:'verify'})}).catch(()=>{});
  // #endregion
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
  const reversalDr =
    couponAccruedToSell > 0
      ? [{ account_code: accruedIncomeAccount, amount: couponAccruedToSell, description: reversalDescription }]
      : [];
  const reversalCr =
    couponAccruedToSell > 0
      ? [{ account_code: accruedReceivableAccount, amount: couponAccruedToSell, description: reversalDescription }]
      : [];
  // #region agent log
  fetch('http://127.0.0.1:7392/ingest/b636a3d1-1bd5-46f2-b184-ba446816f4e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea67d3'},body:JSON.stringify({sessionId:'ea67d3',location:'gsecApprovalLedgerService.js:312',message:'Reversal entries prepared',data:{reversalDr,reversalCr,accruedIncomeAccount,accruedReceivableAccount},timestamp:Date.now(),hypothesisId:'D',runId:'verify'})}).catch(()=>{});
  // #endregion

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
  // #region agent log
  fetch('http://127.0.0.1:7392/ingest/b636a3d1-1bd5-46f2-b184-ba446816f4e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea67d3'},body:JSON.stringify({sessionId:'ea67d3',location:'gsecApprovalLedgerService.js:329',message:'Main posting result',data:{success:mainResult.success,error:mainResult.error,dealId,drCount:mainDrClean.length,crCount:mainCrClean.length},timestamp:Date.now(),hypothesisId:'A',runId:'verify'})}).catch(()=>{});
  // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7392/ingest/b636a3d1-1bd5-46f2-b184-ba446816f4e4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea67d3'},body:JSON.stringify({sessionId:'ea67d3',location:'gsecApprovalLedgerService.js:343',message:'Reversal posting result',data:{success:revResult.success,error:revResult.error},timestamp:Date.now(),hypothesisId:'D',runId:'verify'})}).catch(()=>{});
    // #endregion
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
  truncate8
};
