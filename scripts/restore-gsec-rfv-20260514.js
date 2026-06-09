#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * One-time restore: reset remaining_face_value on 5 specific GSEC buy deals to the
 * values they had on 14.05.2026, then recompute per_day_accrual and per_day_amortization
 * so EOD and the report stay consistent.
 *
 * Usage:
 *   node scripts/restore-gsec-rfv-20260514.js          # dry-run preview
 *   node scripts/restore-gsec-rfv-20260514.js --execute
 */

const db = require('../config/database');
const Gsec = require('../models/gsec');

const EXECUTE = process.argv.includes('--execute');

const TARGETS = [
  { deal: '20250825/GSEC/0001', rfv: 8557008.00 },
  { deal: '20251205/GSEC/0001', rfv: 8911558.00 },
  { deal: '20250602/GSEC/0002', rfv: 1461811.00 },
  { deal: '20260423/GSEC/0003', rfv: 7975462.00 },
  { deal: '20260116/GSEC/0007', rfv: 240125.00 },
];

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);
  for (const t of TARGETS) {
    const [rows] = await db.query(
      `SELECT id, deal_number, transaction_type, face_value, remaining_face_value,
              per_day_accrual, per_day_amortization, status
         FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1`,
      [t.deal]
    );
    if (!rows.length) {
      console.log(`  ${t.deal}: NOT FOUND, skipping`);
      continue;
    }
    const row = rows[0];
    const oldRfv = row.remaining_face_value;
    const face = Number(row.face_value);
    if (t.rfv > face + 0.0001) {
      console.log(`  ${t.deal}: target RFV ${t.rfv} > face ${face}, skipping (would exceed face)`);
      continue;
    }

    console.log(`  ${t.deal} (id=${row.id})`);
    console.log(`    face_value         : ${face}`);
    console.log(`    remaining (before) : ${oldRfv}`);
    console.log(`    remaining (target) : ${t.rfv}`);

    if (!EXECUTE) {
      console.log(`    [dry-run] would set remaining_face_value = ${t.rfv.toFixed(4)} and recompute derived fields\n`);
      continue;
    }

    await db.query(
      `UPDATE gsec SET remaining_face_value = ?, updated_at = NOW() WHERE id = ?`,
      [t.rfv.toFixed(4), row.id]
    );

    // Re-fetch and force recompute of per_day_accrual and per_day_amortization for the new RFV.
    const [refreshed] = await db.query(`SELECT * FROM gsec WHERE id = ?`, [row.id]);
    const r = refreshed[0];
    // Null these so ensureBuyDerivedFields recomputes them with the new RFV.
    await db.query(
      `UPDATE gsec SET per_day_accrual = NULL, per_day_amortization = NULL WHERE id = ?`,
      [row.id]
    );
    r.per_day_accrual = null;
    r.per_day_amortization = null;
    const result = await Gsec.ensureBuyDerivedFields(r);
    const after = result.row || {};
    console.log(
      `    updated  -> RFV=${after.remaining_face_value} accrual=${after.per_day_accrual} amort=${after.per_day_amortization}\n`
    );

    // Re-sync future coupon cashflows to match the restored remaining face.
    try {
      const synced = await Gsec.syncFutureCouponCashflowsForBuyDeal(row.deal_number);
      console.log(`    cashflow rows resynced: ${synced}`);
    } catch (e) {
      console.warn(`    cashflow resync failed: ${e.message || e}`);
    }
  }
  console.log('\nDone.');
  await db.end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
