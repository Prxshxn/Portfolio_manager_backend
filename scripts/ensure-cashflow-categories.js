#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Ensure required cashflow_categories exist and are active.
 * Without these, CashflowCaptureService inserts 0 rows during auto-categorize.
 *
 *   node scripts/ensure-cashflow-categories.js          # show status (dry-run)
 *   node scripts/ensure-cashflow-categories.js --execute
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');

const REQUIRED = [
  { name: 'Interest Income', type: 'operating', description: 'Interest earned on investments' },
  { name: 'Trading Income', type: 'operating', description: 'Income from trading activities' },
  { name: 'Fee Income', type: 'operating', description: 'Fees and commissions earned' },
  { name: 'Operating Expenses', type: 'operating', description: 'General operating expenses' },
  { name: 'Staff Costs', type: 'operating', description: 'Salaries and employee benefits' },
  { name: 'Administrative Expenses', type: 'operating', description: 'Administrative and overhead costs' },
  { name: 'Investment Purchases', type: 'investing', description: 'Purchase of securities and investments' },
  { name: 'Investment Sales', type: 'investing', description: 'Sale proceeds from investments' },
  { name: 'Capital Expenditure', type: 'investing', description: 'Purchase of fixed assets' },
  { name: 'Asset Disposals', type: 'investing', description: 'Proceeds from asset sales' },
  { name: 'Borrowings', type: 'financing', description: 'New borrowings and loans' },
  { name: 'Loan Repayments', type: 'financing', description: 'Repayment of principal on loans' },
  { name: 'Interest Payments', type: 'financing', description: 'Interest payments on borrowings' },
  { name: 'Dividend Payments', type: 'financing', description: 'Dividend payments to shareholders' },
  { name: 'Capital Contributions', type: 'financing', description: 'Capital injections from shareholders' }
];

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);

  const [tableRows] = await db.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashflow_categories' LIMIT 1`
  );
  if (!tableRows.length) {
    console.log('cashflow_categories table does NOT exist. Run migrations/20250101-create-cashflow-tables.js first.');
    await db.end?.();
    return;
  }

  const [existing] = await db.query(
    `SELECT id, name, type, is_active FROM cashflow_categories`
  );
  const byName = {};
  existing.forEach((r) => { byName[String(r.name).trim().toLowerCase()] = r; });

  let toInsert = [];
  let toReactivate = [];

  for (const r of REQUIRED) {
    const key = r.name.toLowerCase();
    const cur = byName[key];
    if (!cur) {
      toInsert.push(r);
    } else if (!cur.is_active) {
      toReactivate.push(cur);
    }
  }

  console.log(`Existing categories: ${existing.length}`);
  console.log(`Missing required   : ${toInsert.length}`);
  console.log(`Inactive required  : ${toReactivate.length}`);

  if (toInsert.length) {
    console.log('  Missing:', toInsert.map((r) => r.name).join(', '));
  }
  if (toReactivate.length) {
    console.log('  Inactive:', toReactivate.map((r) => r.name).join(', '));
  }

  if (!EXECUTE) {
    console.log('\nDry-run only. Re-run with --execute to insert/reactivate.');
    await db.end?.();
    return;
  }

  for (const r of toInsert) {
    await db.query(
      `INSERT INTO cashflow_categories (name, type, description, is_active)
       VALUES (?, ?, ?, TRUE)`,
      [r.name, r.type, r.description]
    );
    console.log(`  inserted: ${r.name}`);
  }
  for (const r of toReactivate) {
    await db.query(
      `UPDATE cashflow_categories SET is_active = TRUE WHERE id = ?`,
      [r.id]
    );
    console.log(`  reactivated: ${r.name}`);
  }

  console.log('\nDone.');
  await db.end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
