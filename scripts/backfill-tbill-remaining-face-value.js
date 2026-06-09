#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Backfill tbill.remaining_face_value on final_approved Buy rows.
 *
 * Sets remaining_face_value = face_value - SUM(linked Sell face_value)
 * for rows where remaining_face_value IS NULL.
 *
 *   node scripts/backfill-tbill-remaining-face-value.js
 *   node scripts/backfill-tbill-remaining-face-value.js --deal=20260101/TBILL/0001
 *   node scripts/backfill-tbill-remaining-face-value.js --execute
 */

const db = require('../config/database');

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const dealArg = argv.find((a) => a.startsWith('--deal='));
const dealFilter = dealArg ? dealArg.split('=')[1] : null;

function truncate4(n) {
  return Math.max(0, Math.trunc(Number(n) * 10000) / 10000);
}

async function main() {
  let sql = `
    SELECT id, deal_number, face_value, remaining_face_value
    FROM tbill
    WHERE transaction_type = 'Buy'
      AND status = 'final_approved'
      AND remaining_face_value IS NULL
  `;
  const params = [];
  if (dealFilter) {
    sql += ' AND deal_number = ?';
    params.push(dealFilter);
  }
  sql += ' ORDER BY id';

  const [rows] = await db.query(sql, params);
  console.log(`Found ${rows.length} buy deal(s) with NULL remaining_face_value. execute=${EXECUTE}`);

  let updated = 0;
  for (const row of rows) {
    const faceValue = Number(row.face_value) || 0;
    const [sellRows] = await db.query(
      `SELECT COALESCE(SUM(face_value), 0) AS total_sold
       FROM tbill
       WHERE transaction_type = 'Sell'
         AND buy_deal_number = ?`,
      [row.deal_number]
    );
    const sold = Number(sellRows[0]?.total_sold) || 0;
    const remaining = truncate4(faceValue - sold);

    if (!EXECUTE) {
      console.log(
        `  [dry-run] id=${row.id} deal=${row.deal_number} face=${faceValue} sold=${sold} -> remaining=${remaining.toFixed(4)}`
      );
      continue;
    }

    await db.query('UPDATE tbill SET remaining_face_value = ? WHERE id = ?', [
      remaining.toFixed(4),
      row.id
    ]);
    updated += 1;
    console.log(
      `  updated id=${row.id} deal=${row.deal_number} remaining_face_value=${remaining.toFixed(4)}`
    );
  }

  console.log(`Done. updated=${updated}`);
  if (typeof db.end === 'function') {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
