/* eslint-disable no-console */
const db = require('../config/database');

const DEAL = '20260522/GSEC/0004';

(async () => {
  console.log('=== LEDGER CORRECTNESS ANALYSIS FOR', DEAL, '===\n');

  // Get all sell records
  const [sellRecords] = await db.query(
    `SELECT id, face_value, settlement_amount, buy_deal_number, status
     FROM gsec 
     WHERE deal_number = ? 
     ORDER BY id`,
    [DEAL]
  );

  console.log('ISSUE #1: DUPLICATE DEAL NUMBER');
  console.log('Found', sellRecords.length, 'sell records with the SAME deal number');
  console.log('Expected: 1 deal number = 1 sell transaction (or split allocations with unique sub-IDs)\n');

  console.log('ISSUE #2: INCORRECT SETTLEMENT AMOUNTS');
  console.log('All', sellRecords.length, 'records show settlement_amount = 208,895,800.00');
  console.log('But they have DIFFERENT face values:');
  const totalFaceValue = sellRecords.reduce((s, r) => s + Number(r.face_value), 0);
  console.log('  Total face value across all records:', totalFaceValue.toFixed(2));
  console.log('  Settlement amount (repeated):', Number(sellRecords[0].settlement_amount).toFixed(2));
  console.log('Expected: Each allocation should have its own settlement amount OR aggregate to one posting\n');

  // Get ledger entries
  const [ledgerEntries] = await db.query(
    `SELECT id, account_id, debit_amount, credit_amount, description, created_at
     FROM ledger_entries 
     WHERE deal_number = ? 
     ORDER BY id`,
    [DEAL]
  );

  console.log('ISSUE #3: INCORRECT POSTING COUNT');
  console.log('Found', ledgerEntries.length, 'ledger entries');
  
  // Count unique posting sets
  const uniqueTimestamps = [...new Set(ledgerEntries.map(e => e.created_at.toISOString()))];
  console.log('Posted in', uniqueTimestamps.length, 'distinct timestamps (posting events)');
  console.log('Expected: Either 1 posting (aggregated) OR', sellRecords.length, 'postings (one per allocation)');
  console.log('Actual: 6 postings (partial/incorrect)\n');

  console.log('ISSUE #4: BALANCE OUT OF TOLERANCE');
  const totalDebit = ledgerEntries.reduce((s, e) => s + Number(e.debit_amount || 0), 0);
  const totalCredit = ledgerEntries.reduce((s, e) => s + Number(e.credit_amount || 0), 0);
  const netDiff = totalDebit - totalCredit;
  console.log('Total Debits:', totalDebit.toFixed(2));
  console.log('Total Credits:', totalCredit.toFixed(2));
  console.log('Net Difference:', netDiff.toFixed(2));
  console.log('Tolerance: 0.01');
  console.log('Within tolerance:', Math.abs(netDiff) <= 0.01 ? 'YES' : 'NO (FAILED)');
  console.log();

  console.log('=== RECOMMENDED ACTIONS ===');
  console.log('1. Investigate why 15 sell allocations share the same deal number');
  console.log('2. Determine if this is:');
  console.log('   a) A split sell that should aggregate to ONE posting');
  console.log('   b) 15 separate sells that need unique deal numbers');
  console.log('3. Delete incorrect ledger entries for this deal');
  console.log('4. Fix the deal records (unique IDs or correct amounts)');
  console.log('5. Re-post with correct logic');
  console.log('6. Investigate why only 6 of 15 were posted (possible loop/trigger issue)');

  await db.pool.end();
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
