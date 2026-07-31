#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Fix sentinel accrued_interest_calculation on buy 20260619/GSEC/0002 and
 * repost sell ledger for 20260625/GSEC/0003.
 *
 * Usage:
 *   node scripts/fix-repost-20260625-gsec-0003.js              # preview
 *   node scripts/fix-repost-20260625-gsec-0003.js --execute  # apply
 */

const db = require('../config/database');
const ledgerController = require('../controllers/ledgerController');
const { postFinalApprovedSellLedger } = require('../services/gsecApprovalLedgerService');
const { loadGsecSell, postedSummary } = require('./scan-same-day-sell-ledger-misposts');

const BUY = '20260619/GSEC/0002';
const SELL = '20260625/GSEC/0003';
const CORRECT_ACCRUED = '5.000000';
const EXECUTE = process.argv.includes('--execute');

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mergeDryRunResults(results, sellDate) {
  const acc = {};
  const add = (code, dr, cr, desc) => {
    const k = `${code}|${desc}`;
    if (!acc[k]) acc[k] = { code, dr: 0, cr: 0, desc };
    acc[k].dr += dr;
    acc[k].cr += cr;
  };
  for (const r of results) {
    (r.main?.dr_lines || []).forEach((l) => add(l.account_code, l.amount, 0, l.description));
    (r.main?.cr_lines || []).forEach((l) => add(l.account_code, 0, l.amount, l.description));
    if (r.reversal) {
      (r.reversal.dr_lines || []).forEach((l) => add(l.account_code, l.amount, 0, l.description));
      (r.reversal.cr_lines || []).forEach((l) => add(l.account_code, 0, l.amount, l.description));
    }
  }
  return Object.values(acc);
}

async function previewCorrect(ctx, buyDealPatch) {
  const results = [];
  for (const slice of ctx.slices) {
    const r = await postFinalApprovedSellLedger(slice, {
      dryRun: true,
      buyDealPatch,
    });
    if (!r.success) return { error: r.error };
    results.push(r);
  }
  const merged = mergeDryRunResults(results, ctx.sellDate);
  let amort = 0;
  let capital = 0;
  for (const l of merged) {
    if (l.code === '358-101-130-416-44') amort += l.cr - l.dr;
    if (l.code === '358-101-130-398-44') capital += l.cr - l.dr;
  }
  return { lines: merged, amort, capital, results };
}

async function repost(ctx) {
  const results = [];
  for (const slice of ctx.slices) {
    const r = await postFinalApprovedSellLedger(slice, {
      dryRun: true,
      buyDealPatch: { accrued_interest_calculation: CORRECT_ACCRUED },
    });
    if (!r.success) return r;
    results.push(r);
  }
  const merged = mergeDryRunResults(results, ctx.sellDate);
  const drLines = merged.filter((l) => l.dr > 0).map((l) => ({
    account_code: l.code,
    amount: l.dr,
    description: l.desc,
  }));
  const crLines = merged.filter((l) => l.cr > 0).map((l) => ({
    account_code: l.code,
    amount: l.cr,
    description: l.desc,
  }));
  return ledgerController.postMultiLineLedgerEntry({
    date: ctx.sellDate,
    dr_accounts: drLines,
    cr_accounts: crLines,
    deal_id: ctx.deal_number,
    description: `GSec Sale - Final Approval - ${ctx.deal_number}`,
  });
}

(async () => {
  const [buyRows] = await db.query(
    "SELECT id, accrued_interest_calculation, isin_number FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy'",
    [BUY]
  );
  const buy = buyRows[0];
  if (!buy) throw new Error(`Buy ${BUY} not found`);

  console.log('=== Fix buy accrued_interest_calculation ===');
  console.log('Current:', buy.accrued_interest_calculation, '->', CORRECT_ACCRUED, `(ISIN ${buy.isin_number})`);

  const posted = await postedSummary(SELL);
  console.log('\n=== Posted sell (before) ===');
  console.log('Lines:', posted.lines, '| amort net:', fmt(posted.amort), '| capital CR:', fmt(posted.capital));

  if (EXECUTE) {
    await db.query(
      "UPDATE gsec SET accrued_interest_calculation = ?, updated_at = NOW() WHERE deal_number = ? AND transaction_type = 'Buy'",
      [CORRECT_ACCRUED, BUY]
    );
    console.log('\nBuy row updated.');
  }

  const ctx = await loadGsecSell(SELL);
  if (!ctx) throw new Error(`Sell ${SELL} not found`);

  const correct = await previewCorrect(ctx, { accrued_interest_calculation: CORRECT_ACCRUED });
  if (correct.error) throw new Error(correct.error);

  console.log('\n=== Corrected preview ===');
  console.log('Amort net:', fmt(correct.amort), '| capital CR:', fmt(correct.capital));
  for (const l of correct.lines) {
    if (l.dr || l.cr) {
      console.log(
        ' ',
        l.code,
        l.dr ? `DR ${fmt(l.dr)}` : '',
        l.cr ? `CR ${fmt(l.cr)}` : '',
        l.desc?.slice(0, 50)
      );
    }
  }
  if (correct.results[0]?.computed) {
    const c = correct.results[0].computed;
    console.log('\nComputed: carryClean=', c.carryClean, 'holdingDays=', c.holdingDays, 'capitalGl=', fmt(c.capitalGl));
  }

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply buy fix + repost sell ledger.');
    process.exit(0);
  }

  const [del] = await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [SELL]);
  console.log(`\nDeleted ${del.affectedRows ?? 0} ledger line(s) for ${SELL}`);

  const repostResult = await repost(ctx);
  if (!repostResult.success) throw new Error(repostResult.error);

  const after = await postedSummary(SELL);
  console.log('\n=== Posted sell (after) ===');
  console.log('Lines:', after.lines, '| amort net:', fmt(after.amort), '| capital CR:', fmt(after.capital));
  console.log('Done.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
