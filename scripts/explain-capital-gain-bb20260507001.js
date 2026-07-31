#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const db = require('../config/database');
const { postFinalApprovedSellLedger, truncate8 } = require('../services/gsecApprovalLedgerService');

const BB = 'BB20260507001';
const SYN = `${BB}/BB-L1/20260507/GSEC/0003`;
const BUY = '20260507/GSEC/0003';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

(async () => {
  const [bbRows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ?', [BB]);
  const [buyRows] = await db.query(
    "SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy'",
    [BUY]
  );
  const [leRows] = await db.query(
    `SELECT le.debit_amount, le.credit_amount, coa.account_code, coa.name, le.description
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ?
     ORDER BY le.id`,
    [SYN]
  );

  const bb = bbRows[0];
  const buy = buyRows[0];
  if (!bb || !buy) {
    console.log('Deal not found', { bb: !!bb, buy: !!buy });
    process.exit(1);
  }

  const leg1Den = Number(bb.leg1_adjusted_face_value ?? bb.leg1_face_value) || 0;
  let faceSlice = leg1Den;
  let allocs = bb.sell_deal_allocations;
  if (typeof allocs === 'string') {
    try {
      allocs = JSON.parse(allocs);
    } catch {
      allocs = null;
    }
  }
  if (Array.isArray(allocs)) {
    const a = allocs.find((x) => (x.deal_number || x.buy_deal_number) === BUY);
    if (a) faceSlice = Number(a.amountToSell) || faceSlice;
  }
  const ratio = leg1Den > 0 ? faceSlice / leg1Den : 1;

  const sellLike = {
    deal_number: SYN,
    buy_deal_number: BUY,
    face_value: faceSlice,
    settlement_amount: truncate8(Number(bb.leg1_settlement_amount) * ratio),
    accrued_interest: truncate8(Number(bb.leg1_accrued_interest || 0) * ratio),
    clean_price: bb.leg1_clean_price,
    dirty_price: bb.leg1_dirty_price,
    settlement_mode: bb.leg1_settlement_mode,
    value_date: bb.leg1_value_date,
    trade_date: bb.leg1_trade_date || bb.leg1_value_date,
    transaction_type: 'Sell',
  };

  const r = await postFinalApprovedSellLedger(sellLike, {
    descriptionPrefix: `Buyback ${BB} - `,
    dryRun: true,
  });

  console.log('================================================================');
  console.log('Capital Gain Explanation —', SYN);
  console.log('================================================================\n');

  console.log('Buyback:', BB, '| Structure:', bb.leg1_transaction_type, '/', bb.leg2_transaction_type);
  console.log('Leg1 value date:', new Date(bb.leg1_value_date).toISOString().slice(0, 10));
  console.log('Source buy deal:', BUY);
  console.log('Face slice sold:', fmt(faceSlice), '(ratio', ratio.toFixed(8), 'of leg1 face', fmt(leg1Den), ')');
  console.log();

  console.log('--- Inputs used in journal builder ---');
  console.log('sellFace              =', fmt(sellLike.face_value));
  console.log('sellSettlement (Bank DR)=', fmt(sellLike.settlement_amount));
  console.log('sellClean (/100)        =', sellLike.clean_price);
  console.log('sellDirty (/100)        =', sellLike.dirty_price);
  console.log('buyClean (/100)         =', buy.clean_price);
  console.log('buyDirty (/100)         =', buy.dirty_price);
  console.log('buy yield (%)           =', buy.yield);
  console.log('buy value date          =', new Date(buy.value_date).toISOString().slice(0, 10));
  console.log('buy maturity            =', buy.maturity_date ? new Date(buy.maturity_date).toISOString().slice(0, 10) : 'n/a');
  console.log();

  const c = r.computed || {};
  console.log('--- Step-by-step (effective-yield sell journal) ---');
  console.log('holdingDays             =', c.holdingDays);
  console.log();
  console.log('1) Treasury Bonds CR    = sellFace × buyClean/100');
  console.log('                        =', fmt(c.sellFace), '×', c.buyClean, '/ 100 =', fmt(c.treasuryBondsAmt));
  console.log();
  console.log('2) Accrued at Purchase CR = sellFace × (buyDirty - buyClean)/100');
  console.log('                        =', fmt(c.sellFace), '×', (c.buyDirty - c.buyClean).toFixed(6), '/ 100 =', fmt(c.accruedAtPurchaseAmt));
  console.log();
  if (c.holdingDays === 0) {
    console.log('3) Amortisation         = 0 (same-day sell; holdingDays = 0)');
  } else {
    console.log('3) Amortisation         = sellFace × (carryClean - buyClean)/100');
    console.log('   carryClean @ buy yield on sell date =', c.carryClean);
    console.log('                        =', fmt(c.amortToSell), c.amortToSell >= 0 ? '(CR)' : '(DR)');
  }
  console.log();
  console.log('4) Coupon Income CR     = sellFace × (sellAccrPer100 - buyAccrPer100)/100');
  console.log('                        =', fmt(c.holdingCouponIncome));
  console.log();
  console.log('5) Capital Gain/Loss    = BALANCING PLUG (makes DR = CR)');
  console.log('   Formula in code:');
  console.log('     capitalGl = sellSettlement - treasuryBonds - accruedAtPurchase - couponIncome - max(0, amort)');
  console.log('               + max(0, -amort)   [if amort is a DR]');
  console.log();
  const sumKnownCr =
    Number(c.treasuryBondsAmt || 0) +
    Number(c.accruedAtPurchaseAmt || 0) +
    Number(c.holdingCouponIncome || 0) +
    Math.max(0, Number(c.amortToSell || 0));
  const sumKnownDr = Math.max(0, -Number(c.amortToSell || 0));
  console.log('   sellSettlement        =', fmt(c.sellSettlement));
  console.log(' - treasuryBonds         =', fmt(c.treasuryBondsAmt));
  console.log(' - accruedAtPurchase     =', fmt(c.accruedAtPurchaseAmt));
  console.log(' - holdingCouponIncome   =', fmt(c.holdingCouponIncome));
  console.log(' - amort (if CR)         =', fmt(Math.max(0, c.amortToSell || 0)));
  console.log(' + amort (if DR)         =', fmt(sumKnownDr));
  console.log(' ----------------------------------------');
  console.log(' = capitalGl             =', fmt(c.capitalGl), c.capitalGl >= 0 ? '→ CR Capital Gain' : '→ DR Capital Loss');
  console.log();
  console.log('Equivalent clean-to-clean view (when carryClean available):');
  console.log('   sellFace × (sellClean - carryClean) / 100 =', fmt((c.sellFace * (c.sellClean - (c.carryClean ?? c.buyClean))) / 100));
  console.log();

  console.log('--- Posted ledger lines for this synthetic deal ---');
  leRows.forEach((row) => {
    console.log(
      `  ${row.account_code} ${row.name} | DR ${fmt(row.debit_amount)} | CR ${fmt(row.credit_amount)} | ${row.description}`
    );
  });

  const capLine = leRows.find((r) => /398|502|Capital/i.test(`${r.account_code} ${r.name}`));
  if (capLine) {
    console.log();
    console.log('Posted capital gain line CR =', fmt(capLine.credit_amount), '| Recomputed =', fmt(c.capitalGl));
  }

  if (typeof db.end === 'function') await db.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
