const db = require('../config/database');

const DEAL = '20260601/GSEC/0003';

async function main() {
  console.log('=== START DATABASE CORRECTION ===');

  // 1. Fetch current states
  const [gsecBefore] = await db.query(
    `SELECT id, deal_number, face_value, accrued_interest, accrued_interest_six_decimals, settlement_amount FROM gsec WHERE deal_number = ?`,
    [DEAL]
  );
  console.log('GSec row before:', JSON.stringify(gsecBefore, null, 2));

  const [ledgersBefore] = await db.query(
    `SELECT le.id, le.account_id, le.debit_amount, le.credit_amount, coa.name as account_name 
     FROM ledger_entries le 
     LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id 
     WHERE le.deal_number = ?`,
    [DEAL]
  );
  console.log('Ledger entries before:', JSON.stringify(ledgersBefore, null, 2));

  if (gsecBefore.length === 0) {
    console.error('Error: Transaction not found.');
    await db.end?.();
    return;
  }

  // Use a transaction to ensure atomic updates
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    // 2. Update GSec row
    console.log('\nUpdating GSec table accrued interest to 1,657,450.00...');
    await connection.query(
      `UPDATE gsec 
       SET accrued_interest = 1657450.00,
           accrued_interest_six_decimals = 1657450.00
       WHERE deal_number = ?`,
      [DEAL]
    );

    // 3. Update ledger entries
    console.log('Updating ledger entries...');
    // Update Treasury Bonds (A/C 453) to 46,807,900.00
    await connection.query(
      `UPDATE ledger_entries 
       SET debit_amount = 46807900.00 
       WHERE deal_number = ? AND account_id = 453 AND debit_amount > 0`,
      [DEAL]
    );

    // Update Accrued Interest (A/C 458) to 1,657,450.00
    await connection.query(
      `UPDATE ledger_entries 
       SET debit_amount = 1657450.00 
       WHERE deal_number = ? AND account_id = 458 AND debit_amount > 0`,
      [DEAL]
    );

    await connection.commit();
    console.log('Database transaction committed successfully.');

  } catch (error) {
    await connection.rollback();
    console.error('Error during transaction, rolled back:', error);
  } finally {
    connection.release();
  }

  // 4. Fetch and display after states to verify
  const [gsecAfter] = await db.query(
    `SELECT id, deal_number, face_value, accrued_interest, accrued_interest_six_decimals, settlement_amount FROM gsec WHERE deal_number = ?`,
    [DEAL]
  );
  console.log('\nGSec row after:', JSON.stringify(gsecAfter, null, 2));

  const [ledgersAfter] = await db.query(
    `SELECT le.id, le.account_id, le.debit_amount, le.credit_amount, coa.name as account_name 
     FROM ledger_entries le 
     LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id 
     WHERE le.deal_number = ?`,
    [DEAL]
  );
  console.log('Ledger entries after:', JSON.stringify(ledgersAfter, null, 2));

  await db.end?.();
  console.log('=== END DATABASE CORRECTION ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
