#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Retro-post ledger entries for "Buy/Sell" buybacks (leg1 = Buy, leg2 = Sell)
 * that never got accounting entries.
 *
 * Ledger-only: posts the GSec purchase ledger for leg1 Buy and the GSec sale
 * ledger for leg2 Sell. Does NOT create or deduct GSec holdings. Each leg is
 * duplicate-guarded by its synthetic ledger deal number and respects the same
 * value-date deferral rule as live approval.
 *
 * Selection: Approved buybacks with a Buy leg1 and/or Sell leg2 whose
 *            leg1_value_date >= cutoff (default 2026-06-01).
 *
 * Usage:
 *   node scripts/retro-buyback-buysell-ledger.js                      # DRY-RUN (default)
 *   node scripts/retro-buyback-buysell-ledger.js --execute            # actually post
 *   node scripts/retro-buyback-buysell-ledger.js --from=2026-06-01    # change cutoff
 *   node scripts/retro-buyback-buysell-ledger.js --deal=BB20260605001 # single deal
 */

const db = require('../config/database');
const { postBuySellBuybackLedger } = require('../services/buybackBuySellLedgerService');

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const fromArg = argv.find((a) => a.startsWith('--from='));
const FROM = fromArg ? fromArg.split('=')[1] : '2026-06-01';
const dealArg = argv.find((a) => a.startsWith('--deal='));
const DEAL = dealArg ? dealArg.split('=')[1] : null;

async function main() {
  let sql = `
    SELECT *
    FROM buyback_deals
    WHERE deal_status = 'Approved'
      AND (leg1_transaction_type = 'Buy' OR leg2_transaction_type = 'Sell')
      AND leg1_value_date >= ?
  `;
  const params = [FROM];
  if (DEAL) {
    sql += ' AND deal_number = ?';
    params.push(DEAL);
  }
  sql += ' ORDER BY leg1_value_date ASC, id ASC';

  const [rows] = await db.query(sql, params);

  console.log(
    `Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} | cutoff leg1_value_date >= ${FROM}` +
      (DEAL ? ` | deal=${DEAL}` : '') +
      ` | candidate buyback(s): ${rows.length}`
  );

  const totals = { posted: 0, would_post: 0, deferred: 0, skipped: 0, failed: 0 };

  for (const bb of rows) {
    const result = await postBuySellBuybackLedger(bb, { dryRun: !EXECUTE });
    for (const a of result.actions) {
      const parts = [`  ${bb.deal_number}`, `${a.leg}/${a.type}`, `[${a.deal_number}]`, `-> ${a.status}`];
      if (a.face_value != null) parts.push(`face=${a.face_value}`);
      if (a.value_date) parts.push(`vd=${a.value_date} sys=${a.system_date}`);
      if (a.error) parts.push(`error=${a.error}`);
      console.log(parts.join(' '));

      if (a.status === 'posted' || a.status === 'posted_legacy') totals.posted += 1;
      else if (a.status === 'would_post') totals.would_post += 1;
      else if (a.status === 'deferred_future_value_date') totals.deferred += 1;
      else if (a.status === 'failed') totals.failed += 1;
      else totals.skipped += 1;
    }
  }

  console.log(
    `\nSummary: posted=${totals.posted} would_post=${totals.would_post} ` +
      `deferred=${totals.deferred} skipped=${totals.skipped} failed=${totals.failed}`
  );
  if (!EXECUTE && totals.would_post > 0) {
    console.log('Dry-run only. Re-run with --execute to post the entries above.');
  }

  if (typeof db.end === 'function') {
    await db.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
