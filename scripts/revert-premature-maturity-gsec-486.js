#!/usr/bin/env node
'use strict';
/**
 * One-shot revert script: undo the premature maturity action on GSEC deal
 * 20260710/GSEC/0001 (database id = 486, ISIN LKB00530H016).
 *
 * What happened:
 *   processPrematureMaturity set gsec.maturity_date = '2026-06-18' for id=486
 *   and inserted a maturity_processing_log row (maturity_action='premature_maturity').
 *   Original maturity date was 2026-07-31.
 *
 * What this script does:
 *   1. SELECT current state and print it so you can verify before applying.
 *   2. (dry-run by default) Show the SQL that WOULD run.
 *   3. With --apply flag: restore maturity_date = '2026-07-31' and delete the log entry.
 *
 * Usage:
 *   node scripts/revert-premature-maturity-gsec-486.js          <- dry run (safe)
 *   node scripts/revert-premature-maturity-gsec-486.js --apply  <- execute changes
 */

const db = require('../config/database');

const GSEC_ID         = 486;
const DEAL_NUMBER     = '20260710/GSEC/0001';
const ORIGINAL_DATE   = '2030-08-01'; // ISIN LKB00530H016 actual maturity (issued 2025-08-01, 5yr semi-annual)
const PREMATURE_DATE  = '2026-06-18';

const apply = process.argv.includes('--apply');

function ymd(d) {
  if (!d) return 'NULL';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d).slice(0, 10) : x.toISOString().slice(0, 10);
}

(async () => {
  try {
    // ── 1. Read current deal state ──────────────────────────────────────────
    const [[gsec]] = await db.query(
      `SELECT id, deal_number, isin_number, face_value, maturity_date, status, matured
       FROM gsec WHERE id = ?`,
      [GSEC_ID]
    );

    if (!gsec) {
      console.error(`\n✗ No GSEC row found with id = ${GSEC_ID}.`);
      process.exit(1);
    }

    console.log('\n── Current GSEC row ──────────────────────────────────────────────');
    console.log(`  id            : ${gsec.id}`);
    console.log(`  deal_number   : ${gsec.deal_number}`);
    console.log(`  isin          : ${gsec.isin_number}`);
    console.log(`  face_value    : ${Number(gsec.face_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  maturity_date : ${ymd(gsec.maturity_date)}`);
    console.log(`  status        : ${gsec.status}`);
    console.log(`  matured       : ${gsec.matured}`);

    // Sanity checks
    if (gsec.deal_number !== DEAL_NUMBER) {
      console.error(`\n✗ Deal number mismatch! DB has "${gsec.deal_number}", expected "${DEAL_NUMBER}". Aborting.`);
      process.exit(1);
    }
    if (ymd(gsec.maturity_date) !== PREMATURE_DATE) {
      console.warn(`\n⚠ maturity_date is "${ymd(gsec.maturity_date)}", not the expected premature date "${PREMATURE_DATE}".`);
      console.warn('  The revert may already have been applied, or something else changed the date.');
      if (!apply) {
        console.warn('  Run with --apply if you still want to force the date back to ' + ORIGINAL_DATE);
      }
    }

    // ── 2. Read the log entry ───────────────────────────────────────────────
    const [logRows] = await db.query(
      `SELECT id, deal_id, deal_number, maturity_action, processed_date, notes
       FROM maturity_processing_log
       WHERE deal_id = ? AND maturity_action = 'premature_maturity'
       ORDER BY id DESC`,
      [GSEC_ID]
    );

    console.log(`\n── maturity_processing_log rows (premature_maturity, deal_id=${GSEC_ID}) ──`);
    if (logRows.length === 0) {
      console.log('  (none found)');
    } else {
      logRows.forEach(r => {
        console.log(`  log id=${r.id}  processed=${ymd(r.processed_date)}  notes="${r.notes}"`);
      });
    }

    // ── 3. Show or execute the revert ──────────────────────────────────────
    console.log('\n── Planned changes ───────────────────────────────────────────────');
    console.log(`  UPDATE gsec SET maturity_date = '${ORIGINAL_DATE}' WHERE id = ${GSEC_ID}`);
    if (logRows.length > 0) {
      const ids = logRows.map(r => r.id).join(', ');
      console.log(`  DELETE FROM maturity_processing_log WHERE id IN (${ids})`);
    } else {
      console.log('  (no log rows to delete)');
    }

    if (!apply) {
      console.log('\n  DRY RUN — no changes made. Re-run with --apply to execute.\n');
      process.exit(0);
    }

    // ── 4. Apply ────────────────────────────────────────────────────────────
    const [upd] = await db.query(
      `UPDATE gsec SET maturity_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ORIGINAL_DATE, GSEC_ID]
    );
    console.log(`\n  ✓ gsec updated (affectedRows=${upd.affectedRows})`);

    if (logRows.length > 0) {
      const ids = logRows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(', ');
      const [del] = await db.query(
        `DELETE FROM maturity_processing_log WHERE id IN (${placeholders})`,
        ids
      );
      console.log(`  ✓ maturity_processing_log rows deleted (affectedRows=${del.affectedRows})`);
    }

    // ── 5. Verify ───────────────────────────────────────────────────────────
    const [[after]] = await db.query(
      `SELECT maturity_date FROM gsec WHERE id = ?`,
      [GSEC_ID]
    );
    console.log(`\n  Verified: gsec.maturity_date is now ${ymd(after.maturity_date)}`);
    if (ymd(after.maturity_date) !== ORIGINAL_DATE) {
      console.error('  ✗ maturity_date does not match the expected original date!');
      process.exit(1);
    }
    console.log('  ✓ Revert complete.\n');
    process.exit(0);

  } catch (err) {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  }
})();
