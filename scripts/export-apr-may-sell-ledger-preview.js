#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Export all April + May 2026 sell transaction ledger entries to a text file.
 *   node scripts/export-apr-may-sell-ledger-preview.js
 *   node scripts/export-apr-may-sell-ledger-preview.js --out path/to/file.txt
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const {
  postFinalApprovedSellLedger,
  truncate8
} = require('../services/gsecApprovalLedgerService');

const ACCOUNT_LABELS = {
  '131-101-410-164-44': 'Bank (settlement)',
  '131-101-410-182-44': 'Bank (default)',
  '131-101-350-098-44': 'Treasury Bonds - Trading A/c',
  '131-101-350-128-44': 'Accrued Coupon Interest Paid at Purchase - TBond Trading',
  '358-101-130-416-44': 'Amortised Discount/Premium TBonds - Trading',
  '467-101-190-476-44': 'Coupon Interest Income TBond',
  '358-101-130-398-44': 'Capital Gain/Loss on Treasury Bond',
  '467-101-190-470-44': 'GSec Interest Income (Accrued)',
  '131-101-290-218-44': 'Interest Receivable GSec (Accrued)',
  '131-101-350-204-44': 'Treasury Bonds - Trading A/c (Buyback)',
  '131-101-350-208-44': 'Accrued at Purchase - TBond Trading (Buyback)',
  '467-101-190-488-44': 'Interest Accrual P&L (Buy/Sell Buyback)',
  '131-101-290-216-44': 'Interest Receivable (Buy/Sell Buyback)'
};

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function label(code) {
  return ACCOUNT_LABELS[code] ? `${code}  ${ACCOUNT_LABELS[code]}` : code || '(unknown)';
}

function monthKey(d) {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
}

function toYmd(d) {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toISOString().slice(0, 10);
}

async function fetchSellDeals(start, end) {
  const [gsec] = await db.query(
    `SELECT deal_number, value_date, trade_date, face_value, settlement_amount,
            accrued_interest, clean_price, dirty_price, settlement_mode,
            buy_deal_number, sell_deal_allocations, status, 'GSec Sell' AS kind
     FROM gsec
     WHERE transaction_type = 'Sell'
       AND status = 'final_approved'
       AND value_date >= ? AND value_date < ?
     ORDER BY value_date, deal_number`,
    [start, end]
  );

  const [bbLeg1] = await db.query(
    `SELECT deal_number AS bb_deal, leg1_value_date, leg1_trade_date,
            leg1_face_value, leg1_adjusted_face_value, leg1_settlement_amount,
            leg1_accrued_interest, leg1_clean_price, leg1_dirty_price,
            leg1_settlement_mode, source_buy_deal_number, sell_deal_allocations,
            deal_status AS status
     FROM buyback_deals
     WHERE leg1_transaction_type = 'Sell'
       AND deal_status = 'Approved'
       AND leg1_value_date >= ? AND leg1_value_date < ?
     ORDER BY leg1_value_date, deal_number`,
    [start, end]
  );

  const leg1Deals = [];
  for (const r of bbLeg1) {
    let allocations = r.sell_deal_allocations;
    if (typeof allocations === 'string') {
      try { allocations = JSON.parse(allocations); } catch { allocations = null; }
    }

    const denominator =
      Number(r.leg1_adjusted_face_value != null ? r.leg1_adjusted_face_value : r.leg1_face_value) || 0;
    const slices = [];
    if (Array.isArray(allocations) && allocations.length) {
      for (const allocation of allocations) {
        const buyDealNumber = allocation.deal_number || allocation.buy_deal_number;
        const faceValue = Number(allocation.amountToSell || allocation.faceValue) || 0;
        if (buyDealNumber && faceValue > 0) slices.push({ buyDealNumber, faceValue });
      }
    } else if (r.source_buy_deal_number && denominator > 0) {
      slices.push({ buyDealNumber: r.source_buy_deal_number, faceValue: denominator });
    }

    // Keep a visible diagnostic row if historical source-allocation data is absent.
    if (!slices.length) {
      leg1Deals.push({
        deal_number: `${r.bb_deal}/BB-L1`,
        value_date: r.leg1_value_date,
        trade_date: r.leg1_trade_date,
        face_value: denominator,
        settlement_amount: r.leg1_settlement_amount,
        accrued_interest: r.leg1_accrued_interest,
        clean_price: r.leg1_clean_price,
        dirty_price: r.leg1_dirty_price,
        settlement_mode: r.leg1_settlement_mode,
        status: r.status,
        kind: 'Buyback Leg1 Sell (Sell/Buy)',
        bb_deal: r.bb_deal,
        preview_error: 'Missing sell allocation/source buy deal; full P&L journal cannot be calculated'
      });
      continue;
    }

    for (const slice of slices) {
      const ratio = denominator > 0 ? slice.faceValue / denominator : 1;
      leg1Deals.push({
        deal_number: `${r.bb_deal}/BB-L1/${slice.buyDealNumber}`,
        value_date: r.leg1_value_date,
        trade_date: r.leg1_trade_date,
        face_value: slice.faceValue,
        settlement_amount: truncate8(Number(r.leg1_settlement_amount || 0) * ratio),
        accrued_interest: truncate8(Number(r.leg1_accrued_interest || 0) * ratio),
        clean_price: r.leg1_clean_price,
        dirty_price: r.leg1_dirty_price,
        settlement_mode: r.leg1_settlement_mode,
        buy_deal_number: slice.buyDealNumber,
        status: r.status,
        kind: 'Buyback Leg1 Sell (Sell/Buy)',
        bb_deal: r.bb_deal
      });
    }
  }

  // Intentionally excludes Buy/Sell (leg 2 Sell) transactions.
  return [...gsec, ...leg1Deals];
}

async function calculateLedger(deal) {
  if (deal.preview_error) return { rows: [], error: deal.preview_error };

  const result = await postFinalApprovedSellLedger(
    { ...deal, transaction_type: 'Sell' },
    {
      descriptionPrefix: deal.bb_deal ? `Buyback ${deal.bb_deal} - ` : '',
      dryRun: true
    }
  );
  if (!result.success) return { rows: [], error: result.error || 'Calculation failed' };

  const rows = [];
  const addJournal = (journal) => {
    if (!journal) return;
    for (const line of journal.dr_lines || []) {
      rows.push({
        account_code: line.account_code,
        debit_amount: line.amount,
        credit_amount: 0,
        description: line.description || journal.description
      });
    }
    for (const line of journal.cr_lines || []) {
      rows.push({
        account_code: line.account_code,
        debit_amount: 0,
        credit_amount: line.amount,
        description: line.description || journal.description
      });
    }
  };
  addJournal(result.main);
  addJournal(result.reversal);
  return { rows, legacy: Boolean(result.legacy) };
}

function renderDeal(deal, ledger, error, legacy) {
  const lines = [];
  lines.push(`--- ${deal.deal_number} ---`);
  lines.push(
    `  Type: ${deal.kind}  |  Value date: ${toYmd(deal.value_date)}  |  Face: ${fmt(deal.face_value)}  |  Settlement: ${fmt(deal.settlement_amount)}`
  );
  if (deal.buy_deal_number) lines.push(`  Buy deal: ${deal.buy_deal_number}`);
  if (deal.bb_deal) lines.push(`  Buyback: ${deal.bb_deal}`);

  if (!ledger.length) {
    lines.push(`  ERROR: ${error || 'No calculated ledger lines'}`);
    lines.push('');
    return lines;
  }
  lines.push('  Journal source: calculated full preview (no database posting)');
  if (legacy) lines.push('  WARNING: simplified journal because the source Buy deal was not found');

  const main = ledger.filter((r) => r.description.includes('GSec Sale - Final Approval'));
  const reversal = ledger.filter((r) => r.description.includes('Accrued Interest Reversal'));
  const other = ledger.filter((r) => !main.includes(r) && !reversal.includes(r));

  const renderGroup = (title, rows) => {
    if (!rows.length) return;
    lines.push('');
    lines.push(`  ${title}`);
    lines.push('  ACCOUNT                                   DR                  CR');
    let tDr = 0;
    let tCr = 0;
    for (const r of rows) {
      const dr = Number(r.debit_amount) || 0;
      const cr = Number(r.credit_amount) || 0;
      tDr += dr;
      tCr += cr;
      const side = dr > 0 ? 'DR' : 'CR';
      const amt = dr > 0 ? dr : cr;
      const acct = label(r.account_code).padEnd(42);
      lines.push(
        `  ${side}  ${acct} ${side === 'DR' ? fmt(amt).padStart(18) : ''.padStart(18)}${side === 'CR' ? fmt(amt).padStart(18) : ''}`
      );
    }
    lines.push(`  ${''.padEnd(44)} ${fmt(tDr).padStart(18)} ${fmt(tCr).padStart(18)}  [diff ${fmt(tDr - tCr)}]`);
  };

  renderGroup('Main journal (GSec Sale - Final Approval):', main);
  renderGroup('Reversal journal (Accrued Interest Reversal):', reversal);
  if (other.length) renderGroup('Other entries on same deal_number:', other);

  const hasAmort = ledger.some((r) => r.account_code === '358-101-130-416-44');
  const hasCoupon = ledger.some((r) => r.account_code === '467-101-190-476-44');
  const hasCapGl = ledger.some((r) => r.account_code === '358-101-130-398-44');
  lines.push(
    `  Components posted (zero-value components are correctly omitted): Treasury reversal ${ledger.some((r) => ['131-101-350-098-44', '131-101-350-204-44'].includes(r.account_code)) ? '✓' : 'N/A'} | Accrued at purchase ${ledger.some((r) => ['131-101-350-128-44', '131-101-350-208-44'].includes(r.account_code)) ? '✓' : 'N/A'} | Amort ${hasAmort ? '✓' : 'N/A'} | Coupon income ${hasCoupon ? '✓' : 'N/A'} | Capital G/L ${hasCapGl ? '✓' : 'N/A'} | Accrual reversal ${reversal.length ? '✓' : 'N/A'}`
  );
  lines.push('');
  return lines;
}

(async () => {
  const outArg = process.argv.indexOf('--out');
  const outPath =
    outArg >= 0 && process.argv[outArg + 1]
      ? path.resolve(process.argv[outArg + 1])
      : path.join(__dirname, '..', 'docs', 'apr-may-2026-sell-ledger-preview.txt');

  const deals = await fetchSellDeals('2026-04-01', '2026-06-01');
  const byMonth = { '2026-04': [], '2026-05': [] };
  for (const d of deals) {
    const mk = monthKey(d.value_date);
    if (byMonth[mk]) byMonth[mk].push(d);
  }

  const out = [];
  out.push('GSEC SELL / BUYBACK SELL-BUY FULL LEDGER PREVIEW');
  out.push('Generated: ' + new Date().toISOString());
  out.push('');
  out.push('Standard mapping (regular GSec Sell):');
  out.push('  Main:  DR Bank | CR Treasury Bonds (098) | CR Accrued at Purchase (128) | CR Amort (416)? | CR Coupon Income (476)? | CR/DR Capital G/L (398)');
  out.push('  Reversal (if holding-period accrual): DR Accrual Income (470) | CR Accrual Receivable (218)');
  out.push('Buyback leg1 (Sell/Buy) synthetic deal_number: BB…/BB-L1/{buy deal number}');
  out.push('Scope: regular GSec Sell + Sell/Buy buyback leg 1 only. Buy/Sell transactions are excluded.');
  out.push('Every journal below is recalculated from deal and source-Buy data; it is not limited to already-posted ledger rows.');
  out.push('Zero-value accounting components are omitted and shown as N/A; the journal is still complete when totals balance.');
  out.push('');

  let totalDeals = 0;
  let calculated = 0;
  let failed = 0;

  for (const month of ['2026-04', '2026-05']) {
    const list = byMonth[month];
    totalDeals += list.length;
    out.push('='.repeat(70));
    out.push(`${month.toUpperCase()} — ${list.length} sell transaction(s)`);
    out.push('='.repeat(70));

    if (!list.length) {
      out.push('  (none)');
      continue;
    }

    for (const deal of list) {
      const preview = await calculateLedger(deal);
      if (preview.rows.length) calculated++;
      else failed++;
      out.push(...renderDeal(deal, preview.rows, preview.error, preview.legacy));
    }
  }

  out.push('');
  out.push('='.repeat(70));
  out.push(`SUMMARY: ${totalDeals} Sell / Sell-Buy transaction slice(s) | ${calculated} fully calculated | ${failed} failed`);
  out.push('='.repeat(70));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out.join('\n'), 'utf8');
  console.log(`Wrote ${totalDeals} transaction slices (${calculated} calculated, ${failed} failed) to:\n  ${outPath}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
