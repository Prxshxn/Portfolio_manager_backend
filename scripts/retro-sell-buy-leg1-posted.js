#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Retro-correct ALL posted Sell/Buy buyback Leg 1 (Sell) ledger entries using
 * current same-day logic (holdingDays=0 → no amort, capital ≈ rounding only).
 *
 * Finds every ledger deal_number matching BB%/BB-L1/% where the parent buyback
 * is Sell/Buy and leg1 sell ledger exists. Re-corrects when the posted journal
 * does not match what gsecApprovalLedgerService would post today.
 *
 * Usage:
 *   node scripts/retro-sell-buy-leg1-posted.js              # preview
 *   node scripts/retro-sell-buy-leg1-posted.js --execute    # apply
 *   node scripts/retro-sell-buy-leg1-posted.js --force      # repost all same-day even if matched
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { postFinalApprovedSellLedger, utcDayDiffSigned, toYmdUtc } = require('../services/gsecApprovalLedgerService');
const {
  parseBuybackL1,
  loadBuybackSlice,
  postedSummary,
  previewCorrect,
} = require('./scan-same-day-sell-ledger-misposts');

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const FORCE = argv.includes('--force');
const OUT = path.join(__dirname, '..', 'docs', 'sell-buy-leg1-retro-preview.txt');

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fingerprint(lines) {
  const acc = {};
  for (const l of lines) {
    const code = l.account_code || l.code || '';
    if (!acc[code]) acc[code] = { dr: 0, cr: 0 };
    acc[code].dr += Number(l.debit_amount ?? l.dr ?? 0);
    acc[code].cr += Number(l.credit_amount ?? l.cr ?? 0);
  }
  return acc;
}

function journalsMatch(postedRows, correctLines, tol = 0.05) {
  const p = fingerprint(postedRows);
  const c = fingerprint(
    correctLines.map((l) => ({
      account_code: l.code,
      debit_amount: l.dr,
      credit_amount: l.cr,
    }))
  );
  const codes = new Set([...Object.keys(p), ...Object.keys(c)]);
  for (const code of codes) {
    const pNet = (p[code]?.dr || 0) - (p[code]?.cr || 0);
    const cNet = (c[code]?.dr || 0) - (c[code]?.cr || 0);
    if (Math.abs(pNet - cNet) > tol) return false;
  }
  return true;
}

async function holdingDaysFor(ctx) {
  const [buy] = await db.query(
    "SELECT value_date FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1",
    [ctx.sellLike.buy_deal_number]
  );
  if (!buy.length) return null;
  return utcDayDiffSigned(ctx.sellDate, buy[0].value_date);
}

async function findAllPostedSellBuyLeg1() {
  const [ledgerDeals] = await db.query(
    `SELECT DISTINCT deal_number FROM ledger_entries
     WHERE deal_number LIKE 'BB%/BB-L1/%'
     ORDER BY deal_number`
  );

  const items = [];
  for (const { deal_number } of ledgerDeals) {
    const parsed = parseBuybackL1(deal_number);
    if (!parsed) continue;

    const [bbRows] = await db.query(
      `SELECT deal_number, leg1_transaction_type, leg2_transaction_type
       FROM buyback_deals WHERE deal_number = ? LIMIT 1`,
      [parsed.bb]
    );
    if (!bbRows.length) continue;
    const bb = bbRows[0];
    if (bb.leg1_transaction_type !== 'Sell' || bb.leg2_transaction_type !== 'Buy') continue;

    const ctx = await loadBuybackSlice(parsed.bb, parsed.buyDeal);
    if (!ctx) continue;

    const hd = await holdingDaysFor(ctx);
    items.push({
      deal_number,
      buyback: parsed.bb,
      buyDeal: parsed.buyDeal,
      ctx,
      holdingDays: hd,
    });
  }
  return items;
}

async function loadAccountNames() {
  const names = new Map();
  const [rows] = await db.query('SELECT account_code, name FROM chart_of_accounts WHERE is_active = TRUE');
  rows.forEach((r) => names.set(r.account_code, r.name || ''));
  return names;
}

function printJournal(buf, label, rows, names) {
  buf.push(`\n  ${label}`);
  if (!rows.length) {
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
  for (const r of rows) {
    const d = Number(r.debit_amount ?? r.dr ?? 0);
    const c = Number(r.credit_amount ?? r.cr ?? 0);
    dr += d;
    cr += c;
    const code = r.account_code || r.code || '';
    buf.push(
      '    ' +
        String(r.entry_date ? toYmdUtc(r.entry_date) : r.date || '').padEnd(12) +
        code.padEnd(22) +
        String(names.get(code) || r.name || '').padEnd(52) +
        (d ? fmt(d) : '').padStart(16) +
        (c ? fmt(c) : '').padStart(16) +
        '  ' +
        (r.description || r.desc || '')
    );
  }
  buf.push('    ' + ''.padEnd(86) + fmt(dr).padStart(16) + fmt(cr).padStart(16));
}

async function main() {
  const names = await loadAccountNames();
  const items = await findAllPostedSellBuyLeg1();
  const buf = [];
  buf.push(`SELL/BUY LEG1 LEDGER RETRO — ${EXECUTE ? 'EXECUTE' : 'PREVIEW'}`);
  buf.push(`Generated: ${new Date().toISOString()}`);
  buf.push(`Posted Sell/Buy leg1 slices found: ${items.length}`);

  const summary = { ok: 0, corrected: 0, skipped_multiday: 0, failed: 0, preview_fix: 0 };

  for (const item of items) {
    const { deal_number, buyback, holdingDays, ctx } = item;
    const posted = await postedSummary(deal_number);

    buf.push('\n' + '='.repeat(90));
    buf.push(`${deal_number}`);
    buf.push(`Buyback: ${buyback} | holdingDays: ${holdingDays}`);

    if (holdingDays !== 0) {
      buf.push('  >> SKIP (not same-day; holdingDays > 0 — different amort rules apply)');
      summary.skipped_multiday += 1;
      continue;
    }

    const correct = await previewCorrect(ctx);
    if (correct.error) {
      buf.push(`  >> FAILED preview: ${correct.error}`);
      summary.failed += 1;
      continue;
    }

    const match = journalsMatch(posted.rows, correct.lines);
    buf.push(
      `  Posted: ${posted.lines} lines | amort ${fmt(posted.amort)} | capital ${fmt(posted.capital)}`
    );
    buf.push(
      `  Correct: amort ${fmt(correct.amort)} | capital ${fmt(correct.capital)} | match=${match}`
    );

    if (match && !FORCE) {
      buf.push('  >> OK (already matches current logic)');
      summary.ok += 1;
      continue;
    }

    printJournal(buf, 'CURRENT POSTED', posted.rows, names);
    printJournal(
      buf,
      'CORRECTED (would post)',
      correct.lines.map((l) => ({
        code: l.code,
        dr: l.dr,
        cr: l.cr,
        desc: l.desc,
        date: ctx.sellDate,
      })),
      names
    );

    if (!EXECUTE) {
      buf.push('  >> DRY-RUN');
      summary.preview_fix += 1;
      continue;
    }

    await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [deal_number]);
    const repost = await postFinalApprovedSellLedger(ctx.sellLike, {
      descriptionPrefix: ctx.descriptionPrefix,
    });
    if (!repost.success) {
      buf.push(`  >> REPOST FAILED: ${repost.error}`);
      summary.failed += 1;
      continue;
    }

    const after = await postedSummary(deal_number);
    buf.push(`  >> REPOSTED OK (${after.lines} lines)`);
    printJournal(buf, 'AFTER REPOST', after.rows, names);
    summary.corrected += 1;
  }

  buf.push('\n' + '='.repeat(90));
  buf.push(`SUMMARY: ${JSON.stringify(summary)}`);
  if (!EXECUTE && summary.preview_fix > 0) {
    buf.push('Run with --execute to apply. Add --force to repost even when journals already match.');
  }

  const text = buf.join('\n');
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(text);
  console.log(`\nWritten: ${OUT}`);
  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
