#!/usr/bin/env node
'use strict';

/**
 * Correct leg-2 Buy deal 20260723/GSEC/0001 (gsec id 521, from BB20260623001):
 * remove the erroneous .08 that the buyback fix (fix-bb20260623001-face-only.js)
 * corrected on the buyback + source buy deal but not on this leg-2 row.
 *
 *   face_value           1,986,697.08 -> 1,986,697.00
 *   remaining_face_value 0.0800       -> 0.0000
 *     (BB20260723002 already sold the real 1,986,697.00 out of this holding;
 *      the 0.08 remainder is phantom face that never existed.)
 *
 * Settlement amounts and ledger entries are NOT changed (same policy as the
 * original fix - the .08 never affected cash).
 *
 * Usage: node scripts/fix-20260723-gsec-0001-leg2-face.js [--execute]
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const GSEC_ID = 521;
const DEAL_NUMBER = '20260723/GSEC/0001';
const EXPECTED_FACE = 1986697.08;
const EXPECTED_RFV = 0.08;
const CORRECT_FACE = 1986697.0;
const CORRECT_RFV = 0.0;

(async () => {
  const [rows] = await db.query(
    'SELECT id, deal_number, face_value, remaining_face_value FROM gsec WHERE id = ?',
    [GSEC_ID]
  );
  if (!rows.length) throw new Error(`gsec id ${GSEC_ID} not found`);
  const row = rows[0];

  if (row.deal_number !== DEAL_NUMBER) {
    throw new Error(`gsec id ${GSEC_ID} is ${row.deal_number}, expected ${DEAL_NUMBER} - aborting`);
  }

  const face = parseFloat(row.face_value);
  const rfv = parseFloat(row.remaining_face_value);
  console.log('=== Current ===');
  console.log(`face_value           = ${face.toFixed(4)}`);
  console.log(`remaining_face_value = ${rfv.toFixed(4)}`);

  if (Math.abs(face - EXPECTED_FACE) > 0.001 || Math.abs(rfv - EXPECTED_RFV) > 0.001) {
    throw new Error('Current values do not match expected pre-fix state - aborting (maybe already fixed?)');
  }

  console.log('\n=== Planned ===');
  console.log(`face_value           -> ${CORRECT_FACE.toFixed(4)}`);
  console.log(`remaining_face_value -> ${CORRECT_RFV.toFixed(4)}`);
  console.log('Settlement / ledger  -> unchanged');

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  await db.query(
    'UPDATE gsec SET face_value = ?, remaining_face_value = ?, updated_at = NOW() WHERE id = ?',
    [CORRECT_FACE.toFixed(4), CORRECT_RFV.toFixed(4), GSEC_ID]
  );

  const [after] = await db.query(
    'SELECT face_value, remaining_face_value FROM gsec WHERE id = ?',
    [GSEC_ID]
  );
  console.log('\n=== After ===');
  console.log(`face_value           = ${parseFloat(after[0].face_value).toFixed(4)}`);
  console.log(`remaining_face_value = ${parseFloat(after[0].remaining_face_value).toFixed(4)}`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
