/* eslint-disable no-console */
'use strict';

/**
 * Backfill (POST) the GSEC maturity (redemption) journal for an already-matured
 * outright-purchase deal that pre-dates the EOD auto-post wiring.
 *
 * Uses the shared gsecMaturityLedgerService, so the posted entry is identical to
 * the dry-run preview and to what EOD posts for future maturities. The service is
 * idempotent: if a redemption entry already exists for the deal it is skipped.
 *
 * REQUIRES an explicit --confirm flag to actually write. Without it, it only
 * reports what it would do.
 *
 * Usage:
 *   node scripts/backfill-gsec-maturity.js "20231124/GSEC/0003"            # report only
 *   node scripts/backfill-gsec-maturity.js "20231124/GSEC/0003" --confirm  # post it
 */

const db = require('../config/database');
const {
  getBuyRowsForDeal,
  buildGsecMaturityJournal,
  hasMaturityLedger,
  postGsecMaturityLedger
} = require('../services/gsecMaturityLedgerService');

const args = process.argv.slice(2).filter((a) => a !== '--confirm');
const CONFIRM = process.argv.includes('--confirm');
const DEAL = args[0];

function fmt(n) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

(async () => {
  if (!DEAL) {
    console.log('Usage: node scripts/backfill-gsec-maturity.js "<DEAL_NUMBER>" [--confirm]');
    await db.pool.end();
    process.exit(1);
  }

  console.log('================================================================');
  console.log('  GSEC Maturity Backfill', CONFIRM ? '(WRITE MODE)' : '(REPORT ONLY - pass --confirm to write)');
  console.log('  Deal:', DEAL);
  console.log('================================================================\n');

  const rows = await getBuyRowsForDeal(DEAL);
  if (!rows.length) {
    console.log('No Buy record found for deal', DEAL);
    await db.pool.end();
    process.exit(1);
  }

  if (await hasMaturityLedger(DEAL)) {
    console.log('A maturity redemption entry already exists for this deal. Nothing to do (idempotent).');
    await db.pool.end();
    process.exit(0);
  }

  const journal = await buildGsecMaturityJournal(rows);
  console.log('Entry to post (dated', journal.maturityDate + '):');
  console.log('  Description:', journal.description);
  for (const l of journal.drLines) {
    console.log('  DR', String(l.account_code).padEnd(22), fmt(l.amount).padStart(16));
  }
  for (const l of journal.crLines) {
    console.log('  CR', String(l.account_code).padEnd(22), fmt(l.amount).padStart(16));
  }
  console.log();

  if (!CONFIRM) {
    console.log('REPORT ONLY: no data written. Re-run with --confirm to post the entry.');
    await db.pool.end();
    process.exit(0);
  }

  const result = await postGsecMaturityLedger(rows);
  if (result.success && result.posted) {
    console.log('POSTED maturity redemption entry for', DEAL, 'and flagged gsec.matured = 1.');
  } else if (result.success && result.skipped) {
    console.log('Skipped (already posted):', result.skipped);
  } else {
    console.error('FAILED to post maturity entry:', result.error);
    await db.pool.end();
    process.exit(1);
  }

  await db.pool.end();
  process.exit(0);
})().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
