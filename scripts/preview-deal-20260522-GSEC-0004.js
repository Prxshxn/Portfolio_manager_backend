/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const db = require('../config/database');

const DEAL = '20260522/GSEC/0004';
const LOG_PATH = 'debug-ea67d3.log';

function log(location, message, data, hypothesisId) {
  // #region agent log
  const entry = JSON.stringify({
    sessionId: 'ea67d3',
    location,
    message,
    data,
    timestamp: Date.now(),
    runId: 'preview',
    hypothesisId,
  }) + '\n';
  fs.appendFileSync(LOG_PATH, entry);
  // #endregion
}

function truncate8(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.trunc(x * 1e8) / 1e8;
}

function r2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function utcDayDiff(a, b) {
  const da = new Date(a);
  const db_ = new Date(b);
  const ms = Math.abs(da.getTime() - db_.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

(async () => {
  console.log('================================================================');
  console.log('  DRY-RUN PREVIEW - Correct Ledger Entries for', DEAL);
  console.log('  Treating as ONE consolidated sell deal');
  console.log('================================================================\n');

  // ---- Step 1: Load all sell allocations ----
  const [sellRows] = await db.query(
    `SELECT id, deal_number, transaction_type, face_value, settlement_amount,
            value_date, buy_deal_number, accrued_interest, isin_number, clean_price
     FROM gsec
     WHERE deal_number = ?
     ORDER BY id`,
    [DEAL]
  );

  if (sellRows.length === 0) {
    console.log('No sell records found for deal', DEAL);
    process.exit(1);
  }

  const totalFace = sellRows.reduce((s, r) => s + Number(r.face_value), 0);
  // All 15 records show the same settlement_amount, so we take the first as the deal total
  const dealSettlement = Number(sellRows[0].settlement_amount);
  const dealAccruedTotalRaw = sellRows.reduce(
    (s, r) => s + Number(r.accrued_interest || 0),
    0
  );

  console.log('--- Deal Summary ---');
  console.log('Allocations:', sellRows.length);
  console.log('Total Face Value:', fmt(totalFace));
  console.log('Deal Settlement Amount:', fmt(dealSettlement));
  console.log('Value Date:', new Date(sellRows[0].value_date).toISOString().slice(0, 10));
  console.log();

  log('preview-deal:69', 'Deal summary loaded', {
    allocations: sellRows.length,
    totalFace,
    dealSettlement,
    dealAccruedTotalRaw,
  }, 'H1');

  // ---- Step 2: Pro-rate settlement & accrued per allocation ----
  const sellDate = new Date(sellRows[0].value_date).toISOString().slice(0, 10);

  // Step 2a: Determine accrued interest base.
  // The accrued_interest stored on each record may already be per-allocation,
  // OR may be a duplicated total. Check distinct values.
  const distinctAccrued = [...new Set(sellRows.map(r => Number(r.accrued_interest || 0)))];
  let perAllocAccruedMode = 'pro-rate-from-total';
  let dealAccruedTotal = dealAccruedTotalRaw;
  if (distinctAccrued.length === sellRows.length) {
    // Each record has its own value - use as-is
    perAllocAccruedMode = 'as-stored';
  } else if (distinctAccrued.length === 1) {
    // All same value - treat first as total, pro-rate it
    dealAccruedTotal = distinctAccrued[0];
    perAllocAccruedMode = 'pro-rate-from-total';
  }

  console.log('--- Pro-Rating Strategy ---');
  console.log('Settlement: pro-rated by face_value / total_face');
  console.log('Accrued Interest Mode:', perAllocAccruedMode);
  console.log('Deal-Level Accrued Total:', fmt(dealAccruedTotal));
  console.log();

  log('preview-deal:96', 'Pro-rating strategy', {
    perAllocAccruedMode,
    distinctAccruedCount: distinctAccrued.length,
    dealAccruedTotal,
  }, 'H4');

  // ---- Step 3: For each allocation, fetch buy deal & compute components ----
  const allocations = [];
  for (const sr of sellRows) {
    const [buyRows] = await db.query(
      `SELECT id, deal_number, value_date, maturity_date, face_value,
              clean_price, last_coupon_date, per_day_amortization,
              coupon_interest, remaining_face_value, isin_number
       FROM gsec
       WHERE transaction_type = 'Buy' AND deal_number = ?
       LIMIT 1`,
      [sr.buy_deal_number]
    );
    const buy = buyRows[0] || null;

    const sellFace = Number(sr.face_value);
    const proRataShare = sellFace / totalFace;
    const allocSettlement = truncate8(dealSettlement * proRataShare);

    let allocAccrued;
    if (perAllocAccruedMode === 'as-stored') {
      allocAccrued = truncate8(Number(sr.accrued_interest || 0));
    } else {
      allocAccrued = truncate8(dealAccruedTotal * proRataShare);
    }

    let purchaseCleanAmt = 0;
    let amortToSell = 0;
    let holdingDays = 0;
    let buyCleanPrice = 0;

    if (buy) {
      const buyFace = Number(buy.face_value || 0);
      buyCleanPrice = Number(buy.clean_price || 0);
      const scale = buyFace > 0 ? sellFace / buyFace : 1;
      purchaseCleanAmt = truncate8((buyFace * buyCleanPrice) / 100) * scale;
      holdingDays = utcDayDiff(sellDate, buy.value_date);
      const perDayAmort = Number(buy.per_day_amortization || 0);
      amortToSell = truncate8(perDayAmort * holdingDays) * scale;
    }

    const bookValueAtSell = truncate8(purchaseCleanAmt + amortToSell);
    const sellCleanAmtEffective = truncate8(allocSettlement - allocAccrued);
    const capitalGl = truncate8(sellCleanAmtEffective - bookValueAtSell);

    allocations.push({
      sellId: sr.id,
      buyDealNumber: sr.buy_deal_number,
      sellFace,
      proRataShare,
      allocSettlement,
      allocAccrued,
      buyCleanPrice,
      purchaseCleanAmt,
      amortToSell,
      holdingDays,
      bookValueAtSell,
      sellCleanAmtEffective,
      capitalGl,
      isPremium: buyCleanPrice > 100,
    });
  }

  log('preview-deal:155', 'Allocations computed', {
    count: allocations.length,
    totalSettlementCheck: allocations.reduce((s, a) => s + a.allocSettlement, 0),
    totalAccruedCheck: allocations.reduce((s, a) => s + a.allocAccrued, 0),
  }, 'H2');

  // ---- Step 4: Print allocation breakdown ----
  console.log('--- Per-Allocation Breakdown ---');
  console.log(
    'BuyDeal'.padEnd(22),
    'SellFace'.padStart(15),
    'Settle'.padStart(15),
    'Accrued'.padStart(13),
    'BookVal'.padStart(15),
    'CapGain'.padStart(15)
  );
  console.log('-'.repeat(100));
  for (const a of allocations) {
    console.log(
      (a.buyDealNumber || '(no buy)').padEnd(22),
      fmt(a.sellFace).padStart(15),
      fmt(a.allocSettlement).padStart(15),
      fmt(a.allocAccrued).padStart(13),
      fmt(a.bookValueAtSell).padStart(15),
      fmt(a.capitalGl).padStart(15)
    );
  }
  console.log();

  // ---- Step 5: Build consolidated ledger entries ----
  const drAccount = '131-101-410-164-44'; // Seylan Bank
  const tradingAccount = '131-101-350-098-44';
  const amortAccount = '358-101-130-416-44';
  const couponIncomeAccount = '467-101-190-476-44';
  const capitalGainAccount = '358-101-130-398-44';
  const accruedIncomeAccount = '467-101-190-470-44';
  const accruedReceivableAccount = '131-101-290-218-44';

  const totals = {
    bank: 0,
    trading: 0,
    amortDr: 0,
    amortCr: 0,
    coupon: 0,
    capitalGainCr: 0,
    capitalGainDr: 0,
    accruedDr: 0,
    accruedCr: 0,
  };

  for (const a of allocations) {
    totals.bank += a.allocSettlement;
    totals.trading += a.purchaseCleanAmt;
    if (a.isPremium) {
      totals.amortDr += a.amortToSell;
    } else {
      totals.amortCr += a.amortToSell;
    }
    totals.coupon += a.allocAccrued;
    if (a.capitalGl >= 0) {
      totals.capitalGainCr += a.capitalGl;
    } else {
      totals.capitalGainDr += Math.abs(a.capitalGl);
    }
    totals.accruedDr += a.allocAccrued; // reversal
    totals.accruedCr += a.allocAccrued; // reversal
  }

  // Round all
  Object.keys(totals).forEach(k => (totals[k] = r2(totals[k])));

  console.log('--- CONSOLIDATED LEDGER ENTRIES (Preview) ---\n');
  console.log('Entry Set 1: GSec Sale - Final Approval');
  console.log('Description: GSec Sale - Final Approval -', DEAL);
  console.log('Date:', sellDate);
  console.log();
  console.log('Account Code         Account Name                                Dr (LKR)         Cr (LKR)');
  console.log('-'.repeat(110));

  const lines = [];

  // Bank Dr
  lines.push({ code: drAccount, name: 'Seylan Bank A/C - 0860-13374197-001', dr: totals.bank, cr: 0 });
  // Trading Cr
  if (totals.trading > 0) lines.push({ code: tradingAccount, name: 'Treasury Bonds - Trading A/c', dr: 0, cr: r2(totals.trading) });
  // Amort
  if (totals.amortDr > 0) lines.push({ code: amortAccount, name: 'Amortised Discount/Premium TBonds - Trading', dr: totals.amortDr, cr: 0 });
  if (totals.amortCr > 0) lines.push({ code: amortAccount, name: 'Amortised Discount/Premium TBonds - Trading', dr: 0, cr: totals.amortCr });
  // Coupon Cr
  if (totals.coupon > 0) lines.push({ code: couponIncomeAccount, name: 'Coupon Interest Income TBond', dr: 0, cr: totals.coupon });
  // Capital Gain
  if (totals.capitalGainCr > 0) lines.push({ code: capitalGainAccount, name: 'Capital Gain on Treasury Bond', dr: 0, cr: totals.capitalGainCr });
  if (totals.capitalGainDr > 0) lines.push({ code: capitalGainAccount, name: 'Capital Gain on Treasury Bond', dr: totals.capitalGainDr, cr: 0 });

  let drSum = 0;
  let crSum = 0;
  for (const l of lines) {
    console.log(
      l.code.padEnd(22),
      l.name.padEnd(48),
      fmt(l.dr).padStart(15),
      fmt(l.cr).padStart(15)
    );
    drSum += l.dr;
    crSum += l.cr;
  }
  console.log('-'.repeat(110));
  console.log(
    'TOTAL'.padEnd(22),
    ''.padEnd(48),
    fmt(drSum).padStart(15),
    fmt(crSum).padStart(15)
  );
  const residual = r2(drSum - crSum);
  console.log('Net Difference (Dr - Cr):', fmt(residual));
  if (Math.abs(residual) > 0) {
    console.log('(Rounding line will be added to Capital Gain account to balance)');
  }
  console.log();

  // ---- Reversal entry ----
  console.log('Entry Set 2: GSec Sale - Accrued Interest Reversal');
  console.log('Description: GSec Sale - Accrued Interest Reversal -', DEAL);
  console.log('Date:', sellDate);
  console.log();
  console.log('Account Code         Account Name                                Dr (LKR)         Cr (LKR)');
  console.log('-'.repeat(110));
  console.log(
    accruedIncomeAccount.padEnd(22),
    'GSec Interest Income (Accrued)'.padEnd(48),
    fmt(totals.accruedDr).padStart(15),
    fmt(0).padStart(15)
  );
  console.log(
    accruedReceivableAccount.padEnd(22),
    'GSec Accrued Interest Receivable'.padEnd(48),
    fmt(0).padStart(15),
    fmt(totals.accruedCr).padStart(15)
  );
  console.log('-'.repeat(110));
  console.log(
    'TOTAL'.padEnd(22),
    ''.padEnd(48),
    fmt(totals.accruedDr).padStart(15),
    fmt(totals.accruedCr).padStart(15)
  );
  console.log('Net Difference:', fmt(r2(totals.accruedDr - totals.accruedCr)));
  console.log();

  // ---- Grand totals ----
  console.log('========================================================');
  console.log('  GRAND TOTAL (Both Entry Sets)');
  console.log('========================================================');
  const grandDr = r2(drSum + totals.accruedDr);
  const grandCr = r2(crSum + totals.accruedCr);
  console.log('Grand Total Debits :', fmt(grandDr));
  console.log('Grand Total Credits:', fmt(grandCr));
  console.log('Net Difference     :', fmt(r2(grandDr - grandCr)));
  console.log('Balanced:', Math.abs(grandDr - grandCr) <= 0.01 ? 'YES (within 0.01 tolerance)' : 'NEEDS ROUNDING LINE');
  console.log();

  // ---- Compare with current incorrect posted state ----
  console.log('--- Comparison: Currently Posted (INCORRECT) vs Correct Preview ---');
  const [posted] = await db.query(
    `SELECT coa.account_code, ROUND(SUM(COALESCE(le.debit_amount,0)),2) AS dr,
            ROUND(SUM(COALESCE(le.credit_amount,0)),2) AS cr
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE TRIM(le.deal_number) = ?
     GROUP BY coa.account_code`,
    [DEAL]
  );
  console.log(
    'Account'.padEnd(22),
    'PostedDr'.padStart(16),
    'PostedCr'.padStart(16),
    'CorrectDr'.padStart(16),
    'CorrectCr'.padStart(16)
  );
  console.log('-'.repeat(90));

  const correctByAccount = {};
  for (const l of lines) {
    if (!correctByAccount[l.code]) correctByAccount[l.code] = { dr: 0, cr: 0 };
    correctByAccount[l.code].dr += l.dr;
    correctByAccount[l.code].cr += l.cr;
  }
  if (!correctByAccount[accruedIncomeAccount]) correctByAccount[accruedIncomeAccount] = { dr: 0, cr: 0 };
  correctByAccount[accruedIncomeAccount].dr += totals.accruedDr;
  if (!correctByAccount[accruedReceivableAccount]) correctByAccount[accruedReceivableAccount] = { dr: 0, cr: 0 };
  correctByAccount[accruedReceivableAccount].cr += totals.accruedCr;

  const allCodes = new Set([
    ...posted.map(p => p.account_code),
    ...Object.keys(correctByAccount),
  ]);
  for (const code of allCodes) {
    const p = posted.find(x => x.account_code === code) || { dr: 0, cr: 0 };
    const c = correctByAccount[code] || { dr: 0, cr: 0 };
    console.log(
      (code || 'NULL').padEnd(22),
      fmt(p.dr).padStart(16),
      fmt(p.cr).padStart(16),
      fmt(c.dr).padStart(16),
      fmt(c.cr).padStart(16)
    );
  }
  console.log();

  log('preview-deal:309', 'Preview totals', {
    grandDr,
    grandCr,
    netDiff: r2(grandDr - grandCr),
    lineCount: lines.length + 2,
  }, 'H5');

  console.log('================================================================');
  console.log('  END OF PREVIEW - No data has been written.');
  console.log('  Review above and confirm before requesting backfill.');
  console.log('================================================================');

  await db.pool.end();
  process.exit(0);
})().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
