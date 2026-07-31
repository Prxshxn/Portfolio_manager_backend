#!/usr/bin/env node
'use strict';

/**
 * Preview recalculated leg1 sell ledger for BB20260623001 after face value fix.
 * Compares CURRENT posted lines vs RECALCULATED (dry-run, no writes).
 *
 *   node scripts/preview-bb20260623001-leg1-ledger-recalc.js
 */

const db = require('../config/database');
const { postFinalApprovedSellLedger, truncate8 } = require('../services/gsecApprovalLedgerService');

const BB = 'BB20260623001';
const SYNTHETIC = 'BB20260623001/BB-L1/20260623/GSEC/0005';
const SOURCE_BUY = '20260623/GSEC/0005';

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function printJournal(label, drLines, crLines) {
  console.log(`\n${label}`);
  console.log('  Account Code              Debit              Credit');
  let totDr = 0;
  let totCr = 0;
  const rows = [];
  (drLines || []).forEach((l) => rows.push({ code: l.account_code, dr: l.amount, cr: 0 }));
  (crLines || []).forEach((l) => rows.push({ code: l.account_code, dr: 0, cr: l.amount }));
  rows.forEach((r) => {
    totDr += Number(r.dr) || 0;
    totCr += Number(r.cr) || 0;
    console.log(
      `  ${r.code}   ${r.dr ? fmt(r.dr).padStart(18) : ''.padStart(18)}   ${r.cr ? fmt(r.cr).padStart(18) : ''.padStart(18)}`
    );
  });
  console.log(`  ${'TOTAL'.padEnd(24)}${fmt(totDr).padStart(18)}   ${fmt(totCr).padStart(18)}   diff=${fmt(totDr - totCr)}`);
}

(async () => {
  const [rows] = await db.query(
    `SELECT deal_number, leg1_value_date, leg1_trade_date, leg1_face_value, leg1_adjusted_face_value,
            leg1_settlement_amount, leg1_accrued_interest, leg1_clean_price, leg1_dirty_price,
            leg1_settlement_mode, source_buy_deal_number, sell_deal_allocations
     FROM buyback_deals WHERE deal_number = ? LIMIT 1`,
    [BB]
  );
  if (!rows.length) throw new Error(`${BB} not found`);
  const d = rows[0];

  let allocs = d.sell_deal_allocations;
  if (typeof allocs === 'string') {
    try {
      allocs = JSON.parse(allocs);
    } catch {
      allocs = null;
    }
  }
  const faceSlice = Number(allocs?.[0]?.amountToSell || d.leg1_face_value);
  const leg1Den = Number(d.leg1_adjusted_face_value ?? d.leg1_face_value) || 0;
  const ratio = leg1Den > 0 ? faceSlice / leg1Den : 1;
  const sliceSettlement = truncate8(Number(d.leg1_settlement_amount) * ratio);
  const sliceAccrued = truncate8(Number(d.leg1_accrued_interest) * ratio);

  console.log('==============================================================');
  console.log(`Buyback ${BB} — Leg1 sell ledger recalc preview`);
  console.log('==============================================================');
  console.log(`  Face value (corrected):     ${fmt(faceSlice)}`);
  console.log(`  Settlement (unchanged):     ${fmt(sliceSettlement)}`);
  console.log(`  Accrued interest:           ${fmt(sliceAccrued)}`);
  console.log(`  Clean / Dirty:              ${d.leg1_clean_price} / ${d.leg1_dirty_price}`);
  console.log(`  Source buy deal:              ${SOURCE_BUY}`);
  console.log(`  Synthetic ledger deal:        ${SYNTHETIC}`);

  const [posted] = await db.query(
    `SELECT coa.account_code, coa.name, le.debit_amount, le.credit_amount
     FROM ledger_entries le
     JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ? ORDER BY le.id`,
    [SYNTHETIC]
  );
  console.log('\n--- CURRENT POSTED ---');
  if (!posted.length) {
    console.log('  (none)');
  } else {
    let dr = 0;
    let cr = 0;
    posted.forEach((r) => {
      dr += Number(r.debit_amount);
      cr += Number(r.credit_amount);
      console.log(
        `  [${r.account_code}] DR=${fmt(r.debit_amount)} CR=${fmt(r.credit_amount)}  (${r.name})`
      );
    });
    console.log(`  TOTAL DR=${fmt(dr)} CR=${fmt(cr)} diff=${fmt(dr - cr)}`);
  }

  const sellLike = {
    deal_number: SYNTHETIC,
    buy_deal_number: SOURCE_BUY,
    face_value: faceSlice,
    settlement_amount: sliceSettlement,
    accrued_interest: sliceAccrued,
    clean_price: d.leg1_clean_price,
    dirty_price: d.leg1_dirty_price,
    settlement_mode: d.leg1_settlement_mode,
    value_date: d.leg1_value_date,
    trade_date: d.leg1_trade_date || d.leg1_value_date,
    transaction_type: 'Sell'
  };

  const r = await postFinalApprovedSellLedger(sellLike, {
    descriptionPrefix: `Buyback ${BB} - `,
    dryRun: true
  });

  if (!r.success) throw new Error(r.error || 'dry-run failed');

  printJournal('--- RECALCULATED (face 1,986,697.00, settlement 2,000,000.00) ---', r.main.dr_lines, r.main.cr_lines);
  if (r.reversal) {
    printJournal('--- RECALCULATED reversal ---', r.reversal.dr_lines, r.reversal.cr_lines);
  }

  if (r.computed) {
    const c = r.computed;
    const p6 = (n) => Number(n || 0).toFixed(4);
    console.log('\n--- CALCULATION DETAIL ---');
    console.log(`  sellFace:              ${fmt(c.sellFace)}`);
    console.log(`  holdingDays:           ${c.holdingDays} (same-day buyback → no amort/coupon income)`);
    console.log(`  buyClean / buyDirty:   ${p6(c.buyClean)} / ${p6(c.buyDirty)}`);
    console.log(`  sellClean / sellDirty: ${p6(c.sellClean)} / ${p6(c.sellDirty)}`);
    console.log(`  Bank DR (settlement):  ${fmt(c.sellSettlement)}`);
    console.log(`  CR Treasury Bonds:     sellFace × buyClean/100  = ${fmt(c.treasuryBondsAmt)}`);
    console.log(`  CR Accrued at Purchase: sellFace × (buyDirty−buyClean)/100 = ${fmt(c.accruedAtPurchaseAmt)}`);
    console.log(`  Amortisation:          ${fmt(c.amortToSell)}`);
    console.log(`  Coupon Income:         ${fmt(c.holdingCouponIncome)}`);
    console.log(`  Capital G/L (plug):    ${fmt(c.capitalGl)}`);
    console.log(
      `  Check: treasury + accrued + amort + coupon + capGL ≈ settlement`
    );
  }

  console.log('\nPreview only — no ledger entries were written.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
