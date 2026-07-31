#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Fix the GSec purchase compound entry_date for 20260625/GSEC/0006 and 0007.
 * These 6 purchase lines (Treasury 453 / Accrued 458 / Bank 464) were posted
 * one day early (2026-06-24) instead of the deal value_date (2026-06-25).
 *
 * Only the original purchase lines are touched; daily amort/accrual lines
 * (06-26 onward) are left as-is.
 *
 * Usage:
 *   node scripts/fix-entry-date-gsec-0006-0007.js            # preview
 *   node scripts/fix-entry-date-gsec-0006-0007.js --execute  # apply
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const WRONG_DATE = '2026-06-24';
const CORRECT_DATE = '2026-06-25';
const TARGET_IDS = [37715, 37716, 37717, 37718, 37719, 37720];

(async () => {
  const [rows] = await db.query(
    `SELECT id, deal_number, account_id, entry_date, debit_amount, credit_amount, description
     FROM ledger_entries
     WHERE id IN (?)
     ORDER BY id`,
    [TARGET_IDS]
  );

  console.log('=== Purchase lines to re-date', WRONG_DATE, '->', CORRECT_DATE, '===');
  for (const r of rows) {
    const ed = new Date(r.entry_date).toISOString().slice(0, 10);
    const flag = ed === WRONG_DATE ? '' : '  <-- entry_date is NOT ' + WRONG_DATE + ' (skip)';
    console.log(
      ' id', r.id,
      '|', r.deal_number,
      '| acct', r.account_id,
      '| entry_date', ed,
      '| DR', Number(r.debit_amount),
      '| CR', Number(r.credit_amount),
      flag
    );
  }

  const safeIds = rows
    .filter((r) => new Date(r.entry_date).toISOString().slice(0, 10) === WRONG_DATE)
    .map((r) => r.id);

  if (!safeIds.length) {
    console.log('\nNothing to update (no lines on', WRONG_DATE + ').');
    process.exit(0);
  }

  if (!EXECUTE) {
    console.log(`\nDRY-RUN. Would update ${safeIds.length} line(s). Re-run with --execute.`);
    process.exit(0);
  }

  const [res] = await db.query(
    'UPDATE ledger_entries SET entry_date = ?, updated_at = NOW() WHERE id IN (?)',
    [CORRECT_DATE, safeIds]
  );
  console.log(`\nUpdated ${res.affectedRows} line(s) to ${CORRECT_DATE}.`);

  const [after] = await db.query(
    'SELECT id, deal_number, entry_date FROM ledger_entries WHERE id IN (?) ORDER BY id',
    [safeIds]
  );
  console.log('\n=== After ===');
  for (const r of after) {
    console.log(' id', r.id, '|', r.deal_number, '| entry_date', new Date(r.entry_date).toISOString().slice(0, 10));
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
