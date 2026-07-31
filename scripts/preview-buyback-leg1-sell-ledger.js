#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * READ-ONLY preview of the Leg 1 (Sell) ledger entries that would be posted for
 * one or more Sell/Buy buyback deals, using the SAME slicing the approval flow
 * uses (controllers/buybackDealController.js -> postSellSlice) and the SAME
 * journal builder (gsecApprovalLedgerService.postFinalApprovedSellLedger) in
 * dryRun mode. Nothing is written.
 *
 * For each buyback, leg1 face is split per sell_deal_allocations (fallback:
 * source_buy_deal_number), and each slice is previewed against a synthetic
 * deal number `${bb}/BB-L1/${buyDealNumber}`. Existing ledger rows for that
 * synthetic deal number are reported so you can see what is already posted.
 *
 *   node scripts/preview-buyback-leg1-sell-ledger.js BB20260610001 BB20260610002
 */

const db = require('../config/database');
const { postFinalApprovedSellLedger, truncate8 } = require('../services/gsecApprovalLedgerService');

const BBS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!BBS.length) {
  console.error('Usage: node scripts/preview-buyback-leg1-sell-ledger.js <BB...>');
  process.exit(1);
}

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function ledgerLinesFor(dealNumber) {
  const [rows] = await db.query(
    `SELECT le.debit_amount, le.credit_amount, coa.account_code, le.description
     FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ? ORDER BY le.id`,
    [dealNumber]
  );
  return rows;
}

async function previewLines(dr, cr) {
  (dr || []).forEach((l) => console.log(`      DR  ${l.account_code}  ${fmt(l.amount)}`));
  (cr || []).forEach((l) => console.log(`      CR  ${l.account_code}  ${fmt(l.amount)}`));
}

async function previewOne(bb) {
  console.log(`\n==============================================================`);
  console.log(`Buyback ${bb}`);
  console.log(`==============================================================`);

  const [rows] = await db.query(
    `SELECT deal_number, deal_status, leg1_transaction_type, leg1_value_date, leg1_trade_date,
            leg1_face_value, leg1_adjusted_face_value, leg1_settlement_amount, leg1_accrued_interest,
            leg1_clean_price, leg1_dirty_price, leg1_settlement_mode, source_buy_deal_number,
            sell_deal_allocations
     FROM buyback_deals WHERE deal_number = ? LIMIT 1`,
    [bb]
  );
  if (!rows.length) {
    console.log('  (no buyback_deals row) - skipped');
    return;
  }
  const d = rows[0];
  console.log(`  status=${d.deal_status} leg1=${d.leg1_transaction_type} leg1Face=${fmt(d.leg1_face_value)} (adj ${d.leg1_adjusted_face_value})`);

  if (String(d.leg1_transaction_type || '').toLowerCase() !== 'sell') {
    console.log('  Leg 1 is not a Sell - no leg1 sell ledger applies.');
    return;
  }

  let allocs = d.sell_deal_allocations;
  if (typeof allocs === 'string') {
    try { allocs = JSON.parse(allocs); } catch { allocs = null; }
  }

  const leg1Den = Number(
    d.leg1_adjusted_face_value != null ? d.leg1_adjusted_face_value : d.leg1_face_value
  ) || 0;
  const leg1Settlement = Number(d.leg1_settlement_amount) || 0;
  const leg1Accrued = Number(d.leg1_accrued_interest) || 0;

  const slices = [];
  if (Array.isArray(allocs) && allocs.length) {
    for (const a of allocs) {
      const dn = a.deal_number || a.buy_deal_number;
      const amt = Number(a.amountToSell) || 0;
      if (dn && amt > 0) slices.push({ buyDealNumber: dn, faceSlice: amt, synthetic: `${bb}/BB-L1/${dn}` });
    }
  } else if (d.source_buy_deal_number && leg1Den > 0) {
    slices.push({
      buyDealNumber: d.source_buy_deal_number,
      faceSlice: leg1Den,
      synthetic: `${bb}/BB-L1/${d.source_buy_deal_number}`
    });
  }

  if (!slices.length) {
    console.log('  No allocations and no source_buy_deal_number - nothing to preview.');
    return;
  }

  // Accumulators for the consolidated "whole entry" per buyback.
  const mainAcc = {}; // account_code -> { dr, cr }
  const revAcc = {};
  const addTo = (acc, code, dr, cr) => {
    if (!acc[code]) acc[code] = { dr: 0, cr: 0 };
    acc[code].dr += Number(dr) || 0;
    acc[code].cr += Number(cr) || 0;
  };

  for (const s of slices) {
    console.log(`\n  Slice -> buy deal ${s.buyDealNumber}, face ${fmt(s.faceSlice)}  (synthetic ${s.synthetic})`);

    const existing = await ledgerLinesFor(s.synthetic);
    if (existing.length) {
      console.log(`    ALREADY POSTED (${existing.length} line(s)):`);
      existing.forEach((e) => {
        console.log(`      [${e.account_code}] DR=${fmt(e.debit_amount)} CR=${fmt(e.credit_amount)}  ${e.description}`);
        const isReversal = /Accrued Interest Reversal/i.test(e.description || '');
        addTo(isReversal ? revAcc : mainAcc, e.account_code, e.debit_amount, e.credit_amount);
      });
      continue;
    }

    const ratio = leg1Den > 0 ? s.faceSlice / leg1Den : 1;
    const sliceSettlement = truncate8(leg1Settlement * ratio);
    const sliceAccrued = truncate8(leg1Accrued * ratio);

    const sellLike = {
      deal_number: s.synthetic,
      buy_deal_number: s.buyDealNumber,
      face_value: s.faceSlice,
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
      descriptionPrefix: `Buyback ${bb} - `,
      dryRun: true
    });

    if (!r.success) {
      console.log(`    WOULD FAIL: ${r.error}`);
      continue;
    }
    if (r.legacy) {
      console.log('    (legacy simplified entry - buy deal context missing)');
    }
    console.log(`    WOULD POST (date ${r.date}):`);
    if (r.main) {
      console.log('    Main journal:');
      await previewLines(r.main.dr_lines, r.main.cr_lines);
      (r.main.dr_lines || []).forEach((l) => addTo(mainAcc, l.account_code, l.amount, 0));
      (r.main.cr_lines || []).forEach((l) => addTo(mainAcc, l.account_code, 0, l.amount));
    }
    if (r.reversal) {
      console.log('    Accrued interest reversal:');
      await previewLines(r.reversal.dr_lines, r.reversal.cr_lines);
      (r.reversal.dr_lines || []).forEach((l) => addTo(revAcc, l.account_code, l.amount, 0));
      (r.reversal.cr_lines || []).forEach((l) => addTo(revAcc, l.account_code, 0, l.amount));
    }
    if (r.computed) {
      const c = r.computed;
      const p6 = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
      console.log('    Calculations:');
      console.log(`      Inputs: sellFace=${fmt(c.sellFace)}  holdingDays=${c.holdingDays}`);
      console.log(`              buyClean=${p6(c.buyClean)}/100  buyDirty=${p6(c.buyDirty)}/100  sellClean=${p6(c.sellClean)}/100  sellDirty=${p6(c.sellDirty)}/100`);
      if (c.carryClean != null) {
        console.log(`              carryClean (buy yield re-priced @ sell date)=${p6(c.carryClean)}/100`);
      }
      console.log(`      Bank DR (proceeds)        = sellFace x sellDirty/100        = ${fmt(c.sellFace)} x ${p6(c.sellDirty)}/100 = ${fmt(c.sellSettlement)}`);
      console.log(`      CR Treasury Bonds         = sellFace x buyClean/100         = ${fmt(c.sellFace)} x ${p6(c.buyClean)}/100 = ${fmt(c.treasuryBondsAmt)}`);
      console.log(`      CR Accrued at Purchase    = sellFace x (buyDirty-buyClean)/100 = sellFace x ${p6(c.buyAccruedPer100)}/100 = ${fmt(c.accruedAtPurchaseAmt)}`);
      if (c.holdingDays === 0) {
        console.log(`      Amortisation              = 0 (same-day exit, holdingDays=0)`);
        console.log(`      Coupon Income             = 0 (same-day exit; full accrued unwinds via Accrued-at-Purchase)`);
      } else {
        const carryTxt = c.carryClean != null ? `(carryClean-buyClean)/100 = (${p6(c.carryClean)}-${p6(c.buyClean)})/100` : 'per-day amort x holdingDays (legacy)';
        console.log(`      Amortisation ${c.amortToSell >= 0 ? '(CR)' : '(DR)'}        = sellFace x ${carryTxt} = ${fmt(c.amortToSell)}`);
        console.log(`      Coupon Income (CR)        = sellFace x (sellAccr-buyAccr)/100 = sellFace x ${p6(c.holdingPeriodAccruedPer100)}/100 = ${fmt(c.holdingCouponIncome)}`);
      }
      const glSign = c.capitalGl >= 0 ? 'CR (gain)' : 'DR (loss)';
      console.log(`      Capital G/L ${glSign}    = proceeds - (treasury+accrued+amort+coupon) [balancing plug] = ${fmt(c.capitalGl)}`);
    }
  }

  // Consolidated "whole entry" for the leg1 sell (slices netted by account).
  const printConsolidated = (label, acc) => {
    const codes = Object.keys(acc);
    if (!codes.length) return;
    console.log(`\n  ${label}`);
    console.log('    Account                 Debit                 Credit');
    let totDr = 0;
    let totCr = 0;
    for (const code of codes) {
      const net = truncate8(acc[code].dr - acc[code].cr);
      const dr = net > 0 ? net : 0;
      const cr = net < 0 ? -net : 0;
      if (dr === 0 && cr === 0) continue;
      totDr += dr;
      totCr += cr;
      console.log(`    ${code}   ${dr ? fmt(dr).padStart(18) : ''.padStart(18)}   ${cr ? fmt(cr).padStart(18) : ''.padStart(18)}`);
    }
    console.log(`    ${'TOTAL'.padEnd(20)}${fmt(totDr).padStart(18)}   ${fmt(totCr).padStart(18)}`);
  };

  console.log(`\n  ===== CONSOLIDATED LEG 1 SELL ENTRY (${bb}) =====`);
  printConsolidated('Main journal (GSec Sale - Final Approval):', mainAcc);
  printConsolidated('Accrued interest reversal:', revAcc);
}

async function main() {
  for (const bb of BBS) {
    try {
      await previewOne(bb);
    } catch (e) {
      console.error(`  ERROR for ${bb}:`, e.message);
    }
  }
  console.log('\nPreview only. No ledger entries were written.');
  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
