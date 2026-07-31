#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const db = require('../config/database');
const { computeGsecPerDayAccrual, computeGsecDailyAmortization } = require('../services/gsecCouponPeriod');
const {
  buildBuyLegDealContext,
  BUYSELL_ACCRUAL_ASSET,
  BUYSELL_ACCRUAL_INCOME,
  BUYSELL_AMORT_FA,
  BUYSELL_AMORT_REVENUE,
} = require('../services/buybackBuySellEodService');
const {
  syntheticLeg1BuyDealNumber,
  syntheticLeg2SellDealNumber,
} = require('../services/buybackBuySellLedgerService');

const BB = process.argv[2] || 'BB20260615005';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

function ymd(d) {
  if (!d) return 'n/a';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toISOString().slice(0, 10);
}

async function enrichIsin(bb) {
  if (!bb.leg1_isin) return {};
  const [rows] = await db.query(
    'SELECT issue_date, maturity_date, coupon_rate, coupon_date_1, coupon_date_2 FROM isin_master WHERE isin_number = ? LIMIT 1',
    [bb.leg1_isin]
  );
  return rows?.[0] || {};
}

(async () => {
  const [bbRows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ?', [BB]);
  const bb = bbRows[0];
  if (!bb) {
    console.log('Buyback not found:', BB);
    process.exit(1);
  }

  const [sysRows] = await db.query('SELECT system_date FROM system_day ORDER BY id DESC LIMIT 1');
  const systemDay = sysRows[0]?.system_date;
  const synthetic = syntheticLeg1BuyDealNumber(BB);
  const sellSynthetic = syntheticLeg2SellDealNumber(BB);
  const isin = await enrichIsin(bb);
  const ctx = buildBuyLegDealContext(bb, isin);

  const acc = computeGsecPerDayAccrual(ctx, systemDay, 2);
  const amort = computeGsecDailyAmortization(ctx, systemDay);

  const [leg1Rows] = await db.query(
    `SELECT COUNT(*) AS c FROM ledger_entries
     WHERE deal_number = ? AND description LIKE '%GSec Purchase%'`,
    [synthetic]
  );
  const [leg2Rows] = await db.query(
    'SELECT COUNT(*) AS c FROM ledger_entries WHERE deal_number = ?',
    [sellSynthetic]
  );

  console.log('================================================================');
  console.log('Buy/Sell EOD Preview —', BB);
  console.log('================================================================\n');
  console.log('Structure:     ', bb.leg1_transaction_type, '/', bb.leg2_transaction_type);
  console.log('Status:        ', bb.deal_status);
  console.log('Synthetic buy: ', synthetic);
  console.log('System day:    ', ymd(systemDay));
  console.log('Leg1 value:    ', ymd(bb.leg1_value_date));
  console.log('Leg2 value:    ', ymd(bb.leg2_value_date), '(maturity)');
  console.log('Face (adj):    ', fmt(bb.leg1_adjusted_face_value ?? bb.leg1_face_value));
  console.log('Clean / Dirty: ', bb.leg1_clean_price, '/', bb.leg1_dirty_price);
  console.log('ISIN:          ', bb.leg1_isin);
  console.log('Coupon rate:   ', bb.coupon_rate ?? isin.coupon_rate ?? 'n/a');
  console.log('Leg1 buy posted:', Number(leg1Rows[0].c) > 0);
  console.log('Leg2 sell posted:', Number(leg2Rows[0].c) > 0);
  console.log('Stored per_day:  accrual =', bb.leg1_per_day_accrual ?? 'n/a', '| amort =', bb.leg1_per_day_amortization ?? 'n/a');

  const eligible =
    bb.deal_status === 'Approved' &&
    bb.leg1_transaction_type === 'Buy' &&
    bb.leg2_transaction_type === 'Sell' &&
    Number(leg1Rows[0].c) > 0 &&
    Number(leg2Rows[0].c) === 0;
  console.log('\nEOD eligible today:', eligible ? 'YES (if system day < leg2 value date)' : 'check dates/posting status');

  console.log('\n----------------------------------------------------------------');
  console.log('DAILY ACCRUAL (one EOD day, e.g.', ymd(systemDay) + ')');
  console.log('----------------------------------------------------------------');
  if (acc.ok) {
    console.log('Amount:        ', fmt(acc.amount));
    console.log('Coupon period E:', acc.E);
    console.log('Entry date:    ', ymd(systemDay));
    console.log('Deal number:   ', synthetic);
    console.log('');
    console.log('  DR', BUYSELL_ACCRUAL_ASSET);
    console.log('     Buy Sell GSec Accrued Interest Receivable');
    console.log('     ', fmt(acc.amount));
    console.log('');
    console.log('  CR', BUYSELL_ACCRUAL_INCOME);
    console.log('     Buy Sell GSec Interest Income (Accrued)');
    console.log('     ', fmt(acc.amount));
    console.log('');
    console.log('  Description: Buy/Sell Buyback Daily Accrual for Deal', synthetic);
  } else {
    console.log('Cannot compute accrual:', acc.reason);
  }

  console.log('\n----------------------------------------------------------------');
  console.log('DAILY AMORTIZATION (one EOD day, e.g.', ymd(systemDay) + ')');
  console.log('----------------------------------------------------------------');
  if (amort.ok) {
    const premium = amort.scenario === 'premium';
    const drCode = premium ? BUYSELL_AMORT_REVENUE : BUYSELL_AMORT_FA;
    const crCode = premium ? BUYSELL_AMORT_FA : BUYSELL_AMORT_REVENUE;
    const drName = premium
      ? 'Buy Sell Amortised Discount Received/Premium Paid (Revenue)'
      : 'Buy Sell Financial Assets at amortised cost';
    const crName = premium
      ? 'Buy Sell Financial Assets at amortised cost'
      : 'Buy Sell Amortised Discount Received/Premium Paid (Revenue)';

    console.log('Amount:        ', fmt(amort.dailyAmount));
    console.log('Scenario:      ', amort.scenario, '(clean', bb.leg1_clean_price, 'vs par 100)');
    console.log('Amort days:    ', amort.days);
    console.log('Entry date:    ', ymd(systemDay));
    console.log('Deal number:   ', synthetic);
    console.log('');
    console.log('  DR', drCode);
    console.log('    ', drName);
    console.log('     ', fmt(amort.dailyAmount));
    console.log('');
    console.log('  CR', crCode);
    console.log('    ', crName);
    console.log('     ', fmt(amort.dailyAmount));
    console.log('');
    console.log('  Description: Buy/Sell Buyback Daily Amortization for Deal', synthetic);
  } else {
    console.log('Cannot compute amortization:', amort.reason);
  }

  console.log('\n================================================================');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
