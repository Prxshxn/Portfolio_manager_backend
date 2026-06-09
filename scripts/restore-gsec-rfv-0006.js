#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * One-time correction for 20260421/GSEC/0006:
 *   Only the buyback BB20260515002 (12,483,747) should be deducted from this deal.
 *   Restore remaining_face_value = 30,213,915 - 12,483,747 = 17,730,168.
 *
 * Usage:
 *   node scripts/restore-gsec-rfv-0006.js          # dry-run preview
 *   node scripts/restore-gsec-rfv-0006.js --execute
 */

const db = require('../config/database');
const Gsec = require('../models/gsec');

const EXECUTE = process.argv.includes('--execute');
const DEAL = '20260421/GSEC/0006';
const TARGET_RFV = 17730168.00;

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);
  const [rows] = await db.query(
    `SELECT id, deal_number, face_value, remaining_face_value,
            per_day_accrual, per_day_amortization, status
       FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1`,
    [DEAL]
  );
  if (!rows.length) {
    console.log(`  ${DEAL}: NOT FOUND`);
    await db.end?.();
    return;
  }
  const row = rows[0];
  const face = Number(row.face_value);
  console.log(`  ${DEAL} (id=${row.id})`);
  console.log(`    face_value         : ${face}`);
  console.log(`    remaining (before) : ${row.remaining_face_value}`);
  console.log(`    remaining (target) : ${TARGET_RFV}`);

  if (TARGET_RFV > face + 0.0001) {
    console.log(`    target exceeds face; aborting`);
    await db.end?.();
    return;
  }

  if (!EXECUTE) {
    console.log(`    [dry-run] would set remaining_face_value = ${TARGET_RFV.toFixed(4)} and recompute derived fields\n`);
    await db.end?.();
    return;
  }

  await db.query(
    `UPDATE gsec SET remaining_face_value = ?, per_day_accrual = NULL, per_day_amortization = NULL, updated_at = NOW() WHERE id = ?`,
    [TARGET_RFV.toFixed(4), row.id]
  );

  const [refreshed] = await db.query(`SELECT * FROM gsec WHERE id = ?`, [row.id]);
  const r = refreshed[0];
  r.per_day_accrual = null;
  r.per_day_amortization = null;
  const result = await Gsec.ensureBuyDerivedFields(r);
  const after = result.row || {};
  console.log(
    `    updated  -> RFV=${after.remaining_face_value} accrual=${after.per_day_accrual} amort=${after.per_day_amortization}\n`
  );

  try {
    const synced = await Gsec.syncFutureCouponCashflowsForBuyDeal(DEAL);
    console.log(`    cashflow rows resynced: ${synced}`);
  } catch (e) {
    console.warn(`    cashflow resync failed: ${e.message || e}`);
  }

  console.log('\nDone.');
  await db.end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
