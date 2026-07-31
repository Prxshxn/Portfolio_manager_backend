#!/usr/bin/env node
'use strict';

/**
 * Cancel duplicate leg2 GSEC from buyback BB20260521003.
 * Keeps 20260622/GSEC/0003; cancels 20260622/GSEC/0004.
 *
 * Usage: node scripts/cancel-duplicate-gsec-20260622-0004.js [--execute]
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const KEEP = '20260622/GSEC/0003';
const CANCEL = '20260622/GSEC/0004';

async function main() {
  const [rows] = await db.query(
    `SELECT id, deal_number, status, buyback_deal_id, face_value, remaining_face_value
     FROM gsec WHERE deal_number IN (?, ?) ORDER BY id`,
    [KEEP, CANCEL]
  );
  console.log('Before:', rows);

  const cancelRow = rows.find((r) => r.deal_number === CANCEL);
  if (!cancelRow) throw new Error(`${CANCEL} not found`);
  if (cancelRow.status === 'cancelled') {
    if (cancelRow.buyback_deal_id != null) {
      if (!EXECUTE) {
        console.log(`DRY-RUN: would clear buyback_deal_id on cancelled ${CANCEL}`);
        process.exit(0);
      }
      await db.query(
        'UPDATE gsec SET buyback_deal_id = NULL, updated_at = NOW() WHERE id = ?',
        [cancelRow.id]
      );
      console.log(`Cleared buyback_deal_id on cancelled ${CANCEL}`);
    } else {
      console.log(`${CANCEL} already cancelled with no buyback link`);
    }
    process.exit(0);
  }

  const [le] = await db.query('SELECT COUNT(*) AS c FROM ledger_entries WHERE deal_number = ?', [CANCEL]);
  if (Number(le[0].c) > 0) {
    throw new Error(`${CANCEL} has ledger entries — manual review required`);
  }

  if (!EXECUTE) {
    console.log(`\nDRY-RUN: would cancel ${CANCEL} and clear buyback_deal_id (keep ${KEEP})`);
    process.exit(0);
  }

  await db.query(
    `UPDATE gsec
     SET status = 'cancelled',
         per_day_accrual = 0,
         buyback_deal_id = NULL,
         updated_at = NOW()
     WHERE id = ?`,
    [cancelRow.id]
  );

  const [after] = await db.query(
    `SELECT id, deal_number, status, buyback_deal_id FROM gsec WHERE deal_number IN (?, ?)`,
    [KEEP, CANCEL]
  );
  console.log('\nAfter:', after);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
