#!/usr/bin/env node
'use strict';

/**
 * BB20260623001: face value only (1,986,697.08 -> 1,986,697.00).
 * Settlement amounts and ledger entries are left unchanged.
 *
 * Usage: node scripts/fix-bb20260623001-face-only.js [--execute]
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const BB_ID = 152;
const SOURCE_BUY = '20260623/GSEC/0005';
const SYNTHETIC = 'BB20260623001/BB-L1/20260623/GSEC/0005';
const CORRECT_FACE = 1986697.0;
const FACE_DELTA = 0.08;

const ORIG_SETTLEMENTS = {
  leg1_settlement_amount: '2000000.00',
  leg2_settlement_amount: '2015659.34',
  leg1_accrued_interest: '55335.4738',
  leg2_accrued_interest: '71936.3146'
};

const ORIG_LEDGER = [
  { account_code: '131-101-410-164-44', debit: '2000000.00', credit: '0.00' },
  { account_code: '358-101-130-398-44', debit: '0.00', credit: '0.00' },
  { account_code: '131-101-350-098-44', debit: '0.00', credit: '1944664.53' },
  { account_code: '131-101-350-128-44', debit: '0.00', credit: '55335.47' }
];
const ENTRY_DATE = '2026-06-23';
const DESC =
  'Buyback BB20260623001 - GSec Sale - Final Approval - BB20260623001/BB-L1/20260623/GSEC/0005';

async function acctId(code) {
  const [r] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]);
  if (!r.length) throw new Error(`Missing account ${code}`);
  return r[0].id;
}

(async () => {
  const [bb] = await db.query('SELECT * FROM buyback_deals WHERE id = ?', [BB_ID]);
  const [src] = await db.query(
    'SELECT id, remaining_face_value FROM gsec WHERE deal_number = ? AND transaction_type = ?',
    [SOURCE_BUY, 'Buy']
  );
  if (!bb.length || !src.length) throw new Error('Required rows not found');

  const newAlloc = JSON.stringify([{ deal_number: SOURCE_BUY, amountToSell: CORRECT_FACE }]);
  const correctRfv = Math.trunc((parseFloat(src[0].remaining_face_value) + 0) * 10000) / 10000;
  // RFV already corrected (+0.08); only ensure it stays if still at pre-fix value
  const rfvTarget =
    parseFloat(src[0].remaining_face_value) < 432544.95
      ? Math.trunc((parseFloat(src[0].remaining_face_value) + FACE_DELTA) * 10000) / 10000
      : parseFloat(src[0].remaining_face_value);

  console.log('=== Planned (face only) ===');
  console.log('Face ->', CORRECT_FACE.toFixed(2));
  console.log('Settlements restored ->', ORIG_SETTLEMENTS);
  console.log('Allocation ->', newAlloc);
  console.log('Source RFV ->', rfvTarget.toFixed(4));
  console.log('Ledger -> restore', ORIG_LEDGER.length, 'original lines');

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  await db.query(
    `UPDATE buyback_deals
     SET leg1_face_value = ?, leg1_adjusted_face_value = ?,
         leg2_face_value = ?, leg2_adjusted_face_value = ?,
         leg1_settlement_amount = ?, leg2_settlement_amount = ?,
         leg1_accrued_interest = ?, leg2_accrued_interest = ?,
         sell_deal_allocations = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      CORRECT_FACE.toFixed(2),
      CORRECT_FACE.toFixed(2),
      CORRECT_FACE.toFixed(2),
      CORRECT_FACE.toFixed(2),
      ORIG_SETTLEMENTS.leg1_settlement_amount,
      ORIG_SETTLEMENTS.leg2_settlement_amount,
      ORIG_SETTLEMENTS.leg1_accrued_interest,
      ORIG_SETTLEMENTS.leg2_accrued_interest,
      newAlloc,
      BB_ID
    ]
  );

  await db.query('UPDATE gsec SET remaining_face_value = ?, updated_at = NOW() WHERE id = ?', [
    rfvTarget.toFixed(4),
    src[0].id
  ]);

  await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [SYNTHETIC]);
  for (const line of ORIG_LEDGER) {
    const accountId = await acctId(line.account_code);
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, ?, ?, ?, 'LKR')`,
      [ENTRY_DATE, accountId, line.debit, line.credit, SYNTHETIC, DESC]
    );
  }

  const [bbA] = await db.query(
    'SELECT leg1_face_value, leg1_settlement_amount, leg2_settlement_amount, sell_deal_allocations FROM buyback_deals WHERE id = ?',
    [BB_ID]
  );
  const [ledger] = await db.query(
    `SELECT coa.account_code, le.debit_amount, le.credit_amount
     FROM ledger_entries le JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ? ORDER BY le.id`,
    [SYNTHETIC]
  );
  console.log('\n=== After ===');
  console.log('Buyback:', bbA[0]);
  console.log('Ledger:');
  let dr = 0;
  let cr = 0;
  ledger.forEach((r) => {
    dr += Number(r.debit_amount);
    cr += Number(r.credit_amount);
    console.log(`  [${r.account_code}] DR=${r.debit_amount} CR=${r.credit_amount}`);
  });
  console.log(`  TOT DR=${dr} CR=${cr} diff=${dr - cr}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
