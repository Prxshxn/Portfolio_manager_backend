#!/usr/bin/env node
'use strict';

/**
 * Apply recalculated leg1 sell ledger for BB20260623001
 * (face 1,986,697.00, settlement 2,000,000.00 unchanged).
 *
 *   node scripts/apply-bb20260623001-leg1-ledger-recalc.js [--execute]
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const SYNTHETIC = 'BB20260623001/BB-L1/20260623/GSEC/0005';
const ENTRY_DATE = '2026-06-23';
const DESC =
  'Buyback BB20260623001 - GSec Sale - Final Approval - BB20260623001/BB-L1/20260623/GSEC/0005';

const RECALC = [
  { account_code: '131-101-410-164-44', debit: '2000000.00', credit: '0.00' },
  { account_code: '131-101-350-098-44', debit: '0.00', credit: '1944664.45' },
  { account_code: '131-101-350-128-44', debit: '0.00', credit: '55335.47' },
  { account_code: '358-101-130-398-44', debit: '0.00', credit: '0.08' }
];

async function acctId(code) {
  const [r] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]);
  if (!r.length) throw new Error(`Missing account ${code}`);
  return r[0].id;
}

(async () => {
  const [posted] = await db.query(
    `SELECT coa.account_code, le.debit_amount, le.credit_amount
     FROM ledger_entries le JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ? ORDER BY le.id`,
    [SYNTHETIC]
  );

  console.log('=== CURRENT ===');
  posted.forEach((r) =>
    console.log(`  [${r.account_code}] DR=${r.debit_amount} CR=${r.credit_amount}`)
  );

  console.log('\n=== RECALCULATED (will apply) ===');
  RECALC.forEach((r) =>
    console.log(`  [${r.account_code}] DR=${r.debit} CR=${r.credit}`)
  );

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [SYNTHETIC]);
  for (const line of RECALC) {
    const accountId = await acctId(line.account_code);
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, ?, ?, ?, 'LKR')`,
      [ENTRY_DATE, accountId, line.debit, line.credit, SYNTHETIC, DESC]
    );
  }

  const [after] = await db.query(
    `SELECT coa.account_code, coa.name, le.debit_amount, le.credit_amount
     FROM ledger_entries le JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ? ORDER BY le.id`,
    [SYNTHETIC]
  );
  let dr = 0;
  let cr = 0;
  console.log('\n=== APPLIED ===');
  after.forEach((r) => {
    dr += Number(r.debit_amount);
    cr += Number(r.credit_amount);
    console.log(`  [${r.account_code}] DR=${r.debit_amount} CR=${r.credit_amount}  (${r.name})`);
  });
  console.log(`  TOTAL DR=${dr.toFixed(2)} CR=${cr.toFixed(2)} diff=${(dr - cr).toFixed(2)}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
