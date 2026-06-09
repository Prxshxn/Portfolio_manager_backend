/* eslint-disable no-console */
'use strict';

const db = require('../config/database');

const DEAL = '20260522/GSEC/0004';

async function main() {
  // #region agent log
  const fs = require('fs');
  const logPath = 'debug-ea67d3.log';
  const log = (location, message, data) => {
    const entry = JSON.stringify({
      sessionId: 'ea67d3',
      location,
      message,
      data,
      timestamp: Date.now(),
      runId: 'verify'
    }) + '\n';
    fs.appendFileSync(logPath, entry);
  };
  // #endregion

  console.log('=== Verifying ledger entries for', DEAL, '===\n');

  // Step 1: Get existing ledger entries
  const [existingEntries] = await db.query(
    `SELECT le.id, le.entry_date, le.deal_number, le.account_id, 
            coa.account_code, coa.name AS account_name,
            ROUND(COALESCE(le.debit_amount, 0), 2) AS debit_amount,
            ROUND(COALESCE(le.credit_amount, 0), 2) AS credit_amount,
            le.description, le.created_at
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE TRIM(le.deal_number) = ?
     ORDER BY le.id`,
    [DEAL]
  );

  console.log('Found', existingEntries.length, 'existing ledger entries');

  // #region agent log
  log('verify-deal-20260522-GSEC-0004.js:40', 'Existing entries count', {
    totalEntries: existingEntries.length,
    hypothesisId: 'A'
  });
  // #endregion

  // Step 2: Check for duplicates
  const entryMap = {};
  existingEntries.forEach(e => {
    const key = `${e.account_code}_${e.debit_amount}_${e.credit_amount}_${e.description}`;
    entryMap[key] = (entryMap[key] || 0) + 1;
  });

  const duplicates = Object.entries(entryMap).filter(([_, count]) => count > 1);
  console.log('\n--- Duplicate Check ---');
  if (duplicates.length > 0) {
    console.log('WARNING: Found duplicate entries:');
    duplicates.forEach(([key, count]) => {
      console.log(`  ${key}: ${count} occurrences`);
    });
  } else {
    console.log('No duplicates found (each unique entry pattern appears once)');
  }

  // #region agent log
  log('verify-deal-20260522-GSEC-0004.js:63', 'Duplicate check result', {
    duplicateCount: duplicates.length,
    duplicates: duplicates.map(([key, count]) => ({ key, count })),
    hypothesisId: 'A'
  });
  // #endregion

  // Step 3: Calculate totals
  const totalDebit = existingEntries.reduce((sum, e) => sum + Number(e.debit_amount), 0);
  const totalCredit = existingEntries.reduce((sum, e) => sum + Number(e.credit_amount), 0);
  const netDiff = totalDebit - totalCredit;

  console.log('\n--- Balance Check ---');
  console.log('Total Debits:', totalDebit.toFixed(2));
  console.log('Total Credits:', totalCredit.toFixed(2));
  console.log('Net Difference:', netDiff.toFixed(2));
  console.log('Within tolerance (0.01):', Math.abs(netDiff) <= 0.01 ? 'YES' : 'NO');

  // #region agent log
  log('verify-deal-20260522-GSEC-0004.js:82', 'Balance check', {
    totalDebit,
    totalCredit,
    netDiff,
    withinTolerance: Math.abs(netDiff) <= 0.01,
    hypothesisId: 'B'
  });
  // #endregion

  // Step 4: Get deal details
  const [sellDeals] = await db.query(
    `SELECT id, deal_number, transaction_type, settlement_amount, face_value, 
            value_date, buy_deal_number, accrued_interest
     FROM gsec
     WHERE deal_number = ?`,
    [DEAL]
  );

  if (sellDeals.length === 0) {
    console.log('\nERROR: Deal not found in gsec table');
    process.exit(1);
  }

  const sellDeal = sellDeals[0];
  console.log('\n--- Deal Details ---');
  console.log('Transaction Type:', sellDeal.transaction_type);
  console.log('Settlement Amount:', sellDeal.settlement_amount);
  console.log('Face Value:', sellDeal.face_value);
  console.log('Accrued Interest:', sellDeal.accrued_interest);
  console.log('Buy Deal Number:', sellDeal.buy_deal_number);

  // #region agent log
  log('verify-deal-20260522-GSEC-0004.js:112', 'Deal details', {
    sellDeal,
    hypothesisId: 'C'
  });
  // #endregion

  // Step 5: Check account codes used
  const accountsUsed = {};
  existingEntries.forEach(e => {
    if (!accountsUsed[e.account_code]) {
      accountsUsed[e.account_code] = {
        name: e.account_name,
        debitTotal: 0,
        creditTotal: 0,
        count: 0
      };
    }
    accountsUsed[e.account_code].debitTotal += Number(e.debit_amount);
    accountsUsed[e.account_code].creditTotal += Number(e.credit_amount);
    accountsUsed[e.account_code].count += 1;
  });

  console.log('\n--- Accounts Used ---');
  Object.entries(accountsUsed).forEach(([code, info]) => {
    console.log(`${code} - ${info.name}`);
    console.log(`  Debits: ${info.debitTotal.toFixed(2)}, Credits: ${info.creditTotal.toFixed(2)}, Lines: ${info.count}`);
  });

  // #region agent log
  log('verify-deal-20260522-GSEC-0004.js:140', 'Accounts used', {
    accountsUsed,
    hypothesisId: 'E'
  });
  // #endregion

  // Step 6: Check descriptions
  const descriptionGroups = {};
  existingEntries.forEach(e => {
    descriptionGroups[e.description] = (descriptionGroups[e.description] || 0) + 1;
  });

  console.log('\n--- Entry Descriptions ---');
  Object.entries(descriptionGroups).forEach(([desc, count]) => {
    console.log(`${count} entries: ${desc}`);
  });

  // #region agent log
  log('verify-deal-20260522-GSEC-0004.js:157', 'Description groups', {
    descriptionGroups,
    hypothesisId: 'D'
  });
  // #endregion

  console.log('\n=== Verification Complete ===');

  await db.pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
