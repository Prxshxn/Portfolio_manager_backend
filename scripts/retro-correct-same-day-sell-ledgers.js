#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Retro-correct same-day GSec sell / Sell-Buy buyback leg1 ledgers that were
 * posted with spurious amortisation + inflated capital gain.
 *
 * For each candidate (holdingDays=0 between sell and linked buy):
 *   1. DELETE existing ledger_entries for the deal_number
 *   2. REPOST using current gsecApprovalLedgerService (amort=0, capital ≈ rounding)
 *
 * Usage:
 *   node scripts/retro-correct-same-day-sell-ledgers.js              # preview only
 *   node scripts/retro-correct-same-day-sell-ledgers.js --execute    # apply
 *   node scripts/retro-correct-same-day-sell-ledgers.js --deal=BB20260507001/BB-L1/20260507/GSEC/0003
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const ledgerController = require('../controllers/ledgerController');
const { postFinalApprovedSellLedger } = require('../services/gsecApprovalLedgerService');
const {
  main: scan,
  loadBuybackSlice,
  loadGsecSell,
  postedSummary,
  previewCorrect,
  parseBuybackL1,
} = require('./scan-same-day-sell-ledger-misposts');

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const dealArg = argv.find((a) => a.startsWith('--deal='));
const DEAL_FILTER = dealArg ? dealArg.split('=')[1] : null;
const OUT = path.join(__dirname, '..', 'docs', 'same-day-sell-ledger-correction-preview.txt');

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadAccountNames() {
  const names = new Map();
  const [rows] = await db.query('SELECT account_code, name FROM chart_of_accounts WHERE is_active = TRUE');
  rows.forEach((r) => names.set(r.account_code, r.name || ''));
  return names;
}

function printLines(buf, label, lines, names) {
  buf.push(`\n  ${label}`);
  if (!lines.length) {
    buf.push('    (no lines)');
    return;
  }
  buf.push(
    '    ' +
      'Date'.padEnd(12) +
      'Account'.padEnd(22) +
      'Account Name'.padEnd(52) +
      'Debit'.padStart(16) +
      'Credit'.padStart(16) +
      '  Description'
  );
  buf.push('    ' + '-'.repeat(160));
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    dr += Number(l.dr || l.debit_amount || 0);
    cr += Number(l.cr || l.credit_amount || 0);
    const code = l.code || l.account_code || '';
    const desc = l.desc || l.description || '';
    const date = l.date || (l.entry_date ? String(l.entry_date).slice(0, 10) : '');
    buf.push(
      '    ' +
        date.padEnd(12) +
        code.padEnd(22) +
        String(names.get(code) || l.name || '').padEnd(52) +
        (l.dr || l.debit_amount ? fmt(l.dr || l.debit_amount) : '').padStart(16) +
        (l.cr || l.credit_amount ? fmt(l.cr || l.credit_amount) : '').padStart(16) +
        '  ' +
        desc
    );
  }
  buf.push('    ' + ''.padEnd(86) + fmt(dr).padStart(16) + fmt(cr).padStart(16));
}

function mergeDryRunResults(results, sellDate) {
  const acc = {};
  const add = (code, dr, cr, desc) => {
    const k = `${code}|${desc}`;
    if (!acc[k]) acc[k] = { code, dr: 0, cr: 0, desc, date: sellDate };
    acc[k].dr += dr;
    acc[k].cr += cr;
  };
  for (const r of results) {
    const date = r.date || sellDate;
    (r.main?.dr_lines || []).forEach((l) => add(l.account_code, l.amount, 0, l.description));
    (r.main?.cr_lines || []).forEach((l) => add(l.account_code, 0, l.amount, l.description));
    if (r.reversal) {
      (r.reversal.dr_lines || []).forEach((l) => add(l.account_code, l.amount, 0, l.description));
      (r.reversal.cr_lines || []).forEach((l) => add(l.account_code, 0, l.amount, l.description));
    }
  }
  return Object.values(acc);
}

async function repostBuybackL1(ctx) {
  return postFinalApprovedSellLedger(ctx.sellLike, { descriptionPrefix: ctx.descriptionPrefix });
}

async function repostGsecConsolidated(ctx) {
  const results = [];
  for (const slice of ctx.slices) {
    const r = await postFinalApprovedSellLedger(slice, { dryRun: true });
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
  const description = `GSec Sale - Final Approval - ${ctx.deal_number}`;
  return ledgerController.postMultiLineLedgerEntry({
    date: ctx.sellDate,
    dr_accounts: drLines,
    cr_accounts: crLines,
    deal_id: ctx.deal_number,
    description,
  });
}

async function correctOne(candidate, names, buf) {
  const { deal_number, kind } = candidate;
  let ctx = null;
  const bb = parseBuybackL1(deal_number);
  if (bb) ctx = await loadBuybackSlice(bb.bb, bb.buyDeal);
  else ctx = await loadGsecSell(deal_number);
  if (!ctx) {
    buf.push(`\nSKIP ${deal_number}: cannot load context`);
    return { status: 'skipped' };
  }

  const posted = await postedSummary(deal_number);
  const correct = await previewCorrect(ctx);

  buf.push('\n' + '='.repeat(80));
  buf.push(`${deal_number}  (${kind})  holdingDays=0`);
  buf.push('='.repeat(80));
  buf.push(
    `POSTED: amort net ${fmt(posted.amort)} | capital CR ${fmt(posted.capital)} | ${posted.lines} lines`
  );
  buf.push(
    `CORRECT: amort net ${fmt(correct.amort)} | capital CR ${fmt(correct.capital)}`
  );

  printLines(
    buf,
    `CURRENT POSTED [${posted.lines} lines]`,
    posted.rows.map((r) => ({
      account_code: r.account_code,
      name: r.name,
      debit_amount: r.debit_amount,
      credit_amount: r.credit_amount,
      description: r.description,
      entry_date: r.entry_date,
    })),
    names
  );

  printLines(buf, 'CORRECTED PREVIEW (would post)', correct.lines, names);

  if (!EXECUTE) {
    buf.push('\n  >> DRY-RUN: no changes made');
    return { status: 'preview' };
  }

  const [del] = await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [deal_number]);
  const deleted = del.affectedRows ?? 0;
  buf.push(`\n  >> DELETED ${deleted} ledger line(s)`);

  let repost;
  if (ctx.kind === 'buyback_l1') {
    repost = await repostBuybackL1(ctx);
  } else {
    repost = await repostGsecConsolidated(ctx);
  }

  if (!repost.success) {
    buf.push(`  >> REPOST FAILED: ${repost.error}`);
    return { status: 'failed', error: repost.error };
  }

  const after = await postedSummary(deal_number);
  buf.push(`  >> REPOSTED OK: ${after.lines} lines`);
  printLines(buf, 'AFTER REPOST', after.rows, names);
  return { status: 'corrected' };
}

async function run() {
  const names = await loadAccountNames();
  const buf = [];
  buf.push(`SAME-DAY SELL LEDGER CORRECTION — ${EXECUTE ? 'EXECUTE' : 'PREVIEW ONLY'}`);
  buf.push(`Generated: ${new Date().toISOString()}`);

  let candidates = await scan();
  if (DEAL_FILTER) {
    candidates = candidates.filter((c) => c.deal_number === DEAL_FILTER);
    if (!candidates.length) {
      // allow running even if scan filters differently — try direct
      const posted = await postedSummary(DEAL_FILTER);
      if (posted.lines) {
        candidates = [{ deal_number: DEAL_FILTER, kind: parseBuybackL1(DEAL_FILTER) ? 'buyback_l1' : 'gsec' }];
      }
    }
  }

  buf.push(`\nCandidates: ${candidates.length}`);

  const summary = { preview: 0, corrected: 0, failed: 0, skipped: 0 };
  for (const c of candidates) {
    const r = await correctOne(c, names, buf);
    summary[r.status] = (summary[r.status] || 0) + 1;
  }

  buf.push('\n' + '='.repeat(80));
  buf.push(`SUMMARY: ${JSON.stringify(summary)}`);
  if (!EXECUTE) {
    buf.push('Re-run with --execute to delete incorrect lines and repost corrected journals.');
  }

  const text = buf.join('\n');
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(text);
  console.log(`\nWritten: ${OUT}`);

  if (typeof db.end === 'function') await db.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
