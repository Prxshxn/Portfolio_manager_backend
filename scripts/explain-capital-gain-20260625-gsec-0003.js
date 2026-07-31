#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const db = require('../config/database');
const { postFinalApprovedSellLedger, utcDayDiffSigned } = require('../services/gsecApprovalLedgerService');

const SELL = '20260625/GSEC/0003';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

(async () => {
  const [sellRows] = await db.query(
    "SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = 'Sell'",
    [SELL]
  );
  const sell = sellRows[0];
  if (!sell) {
    console.log('Sell not found');
    process.exit(1);
  }
  const buyDeal = sell.buy_deal_number;
  const [buyRows] = await db.query(
    "SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy'",
    [buyDeal]
  );
  const [isinRows] = buyRows[0]?.isin
    ? await db.query('SELECT * FROM isin_master WHERE isin = ? LIMIT 1', [buyRows[0].isin])
    : [[]];
  const buy = buyRows[0];
  const hd = buy ? utcDayDiffSigned(sell.value_date, buy.value_date) : null;

  console.log('================================================================');
  console.log('Capital Gain Explanation —', SELL);
  console.log('================================================================\n');
  console.log('Buy deal:', buyDeal, '| holdingDays:', hd);
  console.log('Sell face:', fmt(sell.face_value), '| settlement:', fmt(sell.settlement_amount));
  console.log('Sell clean/dirty:', sell.clean_price, '/', sell.dirty_price);
  if (buy) {
    console.log('Buy clean/dirty:', buy.clean_price, '/', buy.dirty_price);
    console.log('Buy yield:', buy.yield, '| accrued_interest_calculation:', buy.accrued_interest_calculation);
    console.log('annualCouponRate used (accrued*2):', Number(buy.accrued_interest_calculation || 0) * 2);
    console.log('Buy per_day_amort:', buy.per_day_amortization);
    console.log('Buy value_date:', buy.value_date, '| Sell value_date:', sell.value_date);
    console.log('Maturity:', buy.maturity_date);
    console.log('ISIN:', buy.isin, '| coupon_interest on deal:', buy.coupon_interest);
    if (isinRows[0]) {
      console.log('ISIN master coupon:', isinRows[0].coupon_rate ?? isinRows[0].coupon_interest);
    }
    const legitCleanPnl = (Number(sell.face_value) * (Number(sell.clean_price) - Number(buy.clean_price))) / 100;
    console.log('\nRough clean P&L (sellClean - buyClean) x face/100:', fmt(legitCleanPnl));
  }

  const r = await postFinalApprovedSellLedger(sell, { dryRun: true });
  if (r.debug) {
    console.log('\n--- Service debug ---');
    console.log('carryClean:', r.debug.carryClean);
    console.log('amortToSell:', fmt(r.debug.amortToSell));
    console.log('capitalGl:', fmt(r.debug.capitalGl));
    console.log('treasuryBondsAmt:', fmt(r.debug.treasuryBondsAmt));
    console.log('accruedAtPurchaseAmt:', fmt(r.debug.accruedAtPurchaseAmt));
    console.log('holdingCouponIncome:', fmt(r.debug.holdingCouponIncome));
    console.log('sellSettlement:', fmt(r.debug.sellSettlement));
  }

  const [le] = await db.query(
    `SELECT le.id, le.debit_amount, le.credit_amount, coa.account_code, coa.name, le.description
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ?
     ORDER BY le.id`,
    [SELL]
  );
  console.log('\n--- Posted ledger ---');
  for (const row of le) {
    const dr = Number(row.debit_amount || 0);
    const cr = Number(row.credit_amount || 0);
    if (dr || cr) {
      console.log(
        row.id,
        row.account_code,
        row.name,
        dr ? `DR ${fmt(dr)}` : '',
        cr ? `CR ${fmt(cr)}` : ''
      );
    }
  }

  const drTotal = le.reduce((s, r) => s + Number(r.debit_amount || 0), 0);
  const crTotal = le.reduce((s, r) => s + Number(r.credit_amount || 0), 0);
  console.log('\nTotals DR:', fmt(drTotal), 'CR:', fmt(crTotal), 'diff:', fmt(drTotal - crTotal));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
