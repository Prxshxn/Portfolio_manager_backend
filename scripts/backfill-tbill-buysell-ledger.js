#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Backfill final-approval Buy/Sell ledger entries for T-Bill deals that were
 * approved before their account mappings existed (so no ledger was posted at
 * approval time). Uses the SAME service the approval flow uses
 * (tbillLedgerService.postFinalApprovedBuyLedger / postFinalApprovedSellLedger).
 *
 * Also repairs legacy rows missing deal_number (Buy) or buy_deal_number (Sell)
 * before posting.
 *
 * Idempotent: a deal is skipped if any ledger_entries row already exists for its
 * deal_number (mirrors the guard in models/tbillModel.js updateStatus).
 *
 * Dry-run by default. Pass --execute to repair rows and post.
 *
 *   node scripts/backfill-tbill-buysell-ledger.js --id=1,3
 *   node scripts/backfill-tbill-buysell-ledger.js --id=1,3 --execute
 */

const db = require('../config/database');
const Tbill = require('../models/tbillModel');
const tbillLedgerService = require('../services/tbillLedgerService');

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');

function argValue(name) {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : null;
}

const isinFilter = argValue('isin');
const portfolioFilter = argValue('portfolio');
const dealFilter = argValue('deal');
const idArg = argValue('id');
const idFilter = idArg ? idArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

function valueDateToDealDateStr(valueDate) {
  if (!valueDate) return null;
  if (typeof valueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valueDate)) {
    return valueDate.slice(0, 10).replace(/-/g, '');
  }
  const d = new Date(valueDate);
  if (Number.isNaN(d.getTime())) return null;
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

function rowLabel(row) {
  return `id=${row.id} ${row.transaction_type} deal=${row.deal_number || '(none)'} isin=${row.isin_number || '?'} face=${row.face_value} settlement=${row.settlement_amount}`;
}

async function ledgerCountForDealNumber(dealNumber) {
  if (!dealNumber) return 0;
  const [rows] = await db.query(
    'SELECT COUNT(*) AS cnt FROM ledger_entries WHERE deal_number = ?',
    [dealNumber]
  );
  return Number(rows[0]?.cnt || 0);
}

function buildWhere() {
  const clauses = [`status = 'final_approved'`, `current_approval_level = 'final_approved'`];
  const params = [];
  if (idFilter && idFilter.length) {
    clauses.push(`id IN (${idFilter.map(() => '?').join(',')})`);
    params.push(...idFilter);
  }
  if (dealFilter) {
    clauses.push('deal_number = ?');
    params.push(dealFilter);
  }
  if (isinFilter) {
    clauses.push('isin_number = ?');
    params.push(isinFilter);
  }
  if (portfolioFilter) {
    clauses.push('portfolio_id = ?');
    params.push(portfolioFilter);
  }
  return { where: clauses.join(' AND '), params };
}

/** Assign deal_number on Buy rows that never received one at creation time. */
async function ensureBuyDealNumber(buy) {
  if (buy.deal_number) return buy;
  const dateStr = valueDateToDealDateStr(buy.value_date);
  if (!dateStr) {
    throw new Error(`Buy id=${buy.id} has no value_date; cannot generate deal_number`);
  }
  const dealNumber = await Tbill.generateNextDealNumber(dateStr);
  console.log(`  ${EXECUTE ? 'ASSIGN' : 'WOULD ASSIGN'}  buy id=${buy.id} deal_number=${dealNumber}`);
  if (EXECUTE) {
    await db.query('UPDATE tbill SET deal_number = ? WHERE id = ?', [dealNumber, buy.id]);
  }
  return { ...buy, deal_number: dealNumber };
}

/** Link Sell row to its Buy when buy_deal_number was not persisted. */
async function resolveSellBuyLink(sell, buysInBatch) {
  if (sell.buy_deal_number) return sell;

  const batchBuy = buysInBatch.find(
    (b) =>
      b.isin_number === sell.isin_number &&
      b.portfolio_id === sell.portfolio_id &&
      String(b.transaction_type).toLowerCase() === 'buy'
  );
  if (batchBuy) {
    const buy = await ensureBuyDealNumber(batchBuy);
    console.log(
      `  ${EXECUTE ? 'LINK' : 'WOULD LINK'}  sell id=${sell.id} -> buy id=${buy.id} deal_number=${buy.deal_number}`
    );
    if (EXECUTE) {
      await db.query('UPDATE tbill SET buy_deal_number = ? WHERE id = ?', [buy.deal_number, sell.id]);
    }
    return { ...sell, buy_deal_number: buy.deal_number, buy_deal_id: buy.id };
  }

  const [candidates] = await db.query(
    `SELECT * FROM tbill
     WHERE transaction_type = 'Buy'
       AND status = 'final_approved'
       AND isin_number = ?
       AND portfolio_id = ?
     ORDER BY id`,
    [sell.isin_number, sell.portfolio_id]
  );

  let matched = null;
  if (candidates.length === 1) {
    matched = candidates[0];
  } else {
    const sold = Number(sell.face_value || 0);
    matched =
      candidates.find((b) => {
        const remaining = Number(b.remaining_face_value || 0);
        const original = Number(b.face_value || 0);
        return sold > 0 && remaining + sold <= original + 0.01;
      }) || null;
  }

  if (!matched) {
    return sell;
  }

  const buy = await ensureBuyDealNumber(matched);
  console.log(
    `  ${EXECUTE ? 'LINK' : 'WOULD LINK'}  sell id=${sell.id} -> buy id=${buy.id} deal_number=${buy.deal_number}`
  );
  if (EXECUTE) {
    await db.query('UPDATE tbill SET buy_deal_number = ? WHERE id = ?', [buy.deal_number, sell.id]);
  }
  return { ...sell, buy_deal_number: buy.deal_number, buy_deal_id: buy.id };
}

async function processRow(row, buysInBatch) {
  const label = rowLabel(row);

  let rowForPost = row;
  if (String(row.transaction_type).toLowerCase() === 'sell') {
    rowForPost = await resolveSellBuyLink(row, buysInBatch);
  }

  const existing = await ledgerCountForDealNumber(rowForPost.deal_number);
  if (existing > 0) {
    console.log(`  SKIP (already has ${existing} ledger rows)  ${label}`);
    return { skipped: true };
  }
  if (!rowForPost.deal_number) {
    console.log(`  WARN  ${label} -> still has no deal_number after repair; skipping.`);
    return { skipped: true, warned: true };
  }

  const ledgerOpts = { dryRun: !EXECUTE };
  if (String(rowForPost.transaction_type).toLowerCase() === 'sell' && rowForPost.buy_deal_id) {
    ledgerOpts.buyDealId = rowForPost.buy_deal_id;
  }

  let result;
  if (String(rowForPost.transaction_type).toLowerCase() === 'buy') {
    result = await tbillLedgerService.postFinalApprovedBuyLedger(rowForPost, ledgerOpts);
  } else if (String(rowForPost.transaction_type).toLowerCase() === 'sell') {
    if (!rowForPost.buy_deal_number && !ledgerOpts.buyDealId) {
      console.error(`  ${EXECUTE ? 'FAILED' : 'WOULD FAIL'}  ${label} -> cannot resolve buy_deal_number`);
      return { failed: true };
    }
    result = await tbillLedgerService.postFinalApprovedSellLedger(rowForPost, ledgerOpts);
  } else {
    console.log(`  SKIP (unknown transaction_type)  ${label}`);
    return { skipped: true };
  }

  if (!result.success) {
    console.error(`  ${EXECUTE ? 'FAILED' : 'WOULD FAIL'}  ${label} -> ${result.error}`);
    return { failed: true, error: result.error };
  }

  if (!EXECUTE) {
    console.log(`  WOULD POST  ${rowLabel(rowForPost)}  (date ${result.date})`);
    (result.dr_lines || []).forEach((l) =>
      console.log(`      DR  ${l.account_code}  ${Number(l.amount).toFixed(2)}`)
    );
    (result.cr_lines || []).forEach((l) =>
      console.log(`      CR  ${l.account_code}  ${Number(l.amount).toFixed(2)}`)
    );
    if (result.computed) {
      const c = result.computed;
      console.log(
        `      [cost basis ${Number(c.costBasis).toFixed(2)}, accrual reversal ${Number(c.accrualReversal).toFixed(2)}, gain/loss ${Number(c.gainLoss).toFixed(2)}]`
      );
    }
    return { wouldPost: true };
  }

  console.log(`  POSTED  ${rowLabel(rowForPost)}`);
  return { posted: true };
}

async function main() {
  const { where, params } = buildWhere();
  const sql = `
    SELECT *
    FROM tbill
    WHERE ${where}
      AND transaction_type IN ('Buy', 'Sell')
    ORDER BY (transaction_type = 'Sell'), id
  `;
  const [rows] = await db.query(sql, params);

  // Pre-repair buy deal_numbers so sells in the same batch can link correctly.
  const repairedBuysById = new Map();
  for (const row of rows) {
    if (String(row.transaction_type).toLowerCase() !== 'buy') continue;
    const repaired = await ensureBuyDealNumber(row);
    repairedBuysById.set(row.id, repaired);
  }
  const buysInBatch = [...repairedBuysById.values()];

  console.log(
    `T-Bill buy/sell ledger backfill  execute=${EXECUTE}  ` +
      `filters{ isin=${isinFilter || '*'} portfolio=${portfolioFilter || '*'} deal=${dealFilter || '*'} id=${idFilter ? idFilter.join(',') : '*'} }`
  );
  console.log(`Matched ${rows.length} final_approved Buy/Sell row(s) (Buys processed first).`);

  const summary = { posted: 0, wouldPost: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    let working = row;
    if (String(row.transaction_type).toLowerCase() === 'buy' && repairedBuysById.has(row.id)) {
      working = repairedBuysById.get(row.id);
    }
    const r = await processRow(working, buysInBatch);
    if (r.posted) summary.posted += 1;
    else if (r.wouldPost) summary.wouldPost += 1;
    else if (r.failed) summary.failed += 1;
    else if (r.skipped) summary.skipped += 1;
  }

  console.log('Done.', JSON.stringify(summary));
  if (!EXECUTE) {
    console.log('Dry-run only. Re-run with --execute to repair rows and post the entries.');
  }
  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
