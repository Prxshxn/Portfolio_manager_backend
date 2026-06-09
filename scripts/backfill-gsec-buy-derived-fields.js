#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Backfill gsec.remaining_face_value, per_day_accrual, per_day_amortization on Buy rows.
 *
 *   node scripts/backfill-gsec-buy-derived-fields.js
 *   node scripts/backfill-gsec-buy-derived-fields.js --deal=20260310/GSEC/0003
 *   node scripts/backfill-gsec-buy-derived-fields.js --execute
 */

const db = require('../config/database');
const Gsec = require('../models/gsec');

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const dealArg = argv.find((a) => a.startsWith('--deal='));
const dealFilter = dealArg ? dealArg.split('=')[1] : null;

async function main() {
  let sql = `
    SELECT id, deal_number, remaining_face_value, per_day_accrual, per_day_amortization
    FROM gsec
    WHERE transaction_type = 'Buy' AND status = 'final_approved'
      AND (
        remaining_face_value IS NULL
        OR per_day_amortization IS NULL
        OR per_day_accrual IS NULL
      )
  `;
  const params = [];
  if (dealFilter) {
    sql += ' AND deal_number = ?';
    params.push(dealFilter);
  }
  sql += ' ORDER BY id';

  const [rows] = await db.query(sql, params);
  console.log(`Found ${rows.length} buy deal(s) with missing derived fields. execute=${EXECUTE}`);

  let updated = 0;
  for (const row of rows) {
    if (!EXECUTE) {
      console.log(`  [dry-run] would backfill id=${row.id} deal=${row.deal_number}`);
      continue;
    }
    const result = await Gsec.ensureBuyDerivedFields(row.id);
    if (result.updated) {
      updated += 1;
      const r = result.row || {};
      console.log(
        `  updated id=${row.id} deal=${row.deal_number} rfv=${r.remaining_face_value} accrual=${r.per_day_accrual} amort=${r.per_day_amortization}`
      );
    } else {
      console.log(`  skipped id=${row.id} deal=${row.deal_number} (nothing to set)`);
    }
  }

  console.log(`Done. updated=${updated}`);
  await db.end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
