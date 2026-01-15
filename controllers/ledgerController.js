const db = require('../config/db');

// Helper to get account_id from account_code
async function getAccountIdByCode(account_code) {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [account_code]
  );
  if (rows.length === 0) throw new Error(`Account code not found: ${account_code}`);
  return rows[0].id;
}

exports.postLedgerEntry = async function(entry) {
  console.log('postLedgerEntry function called');
  const { date, dr_account, cr_account, amount, deal_id, description } = entry;
  console.log('EOD Posting:', entry);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const dr_account_id = await getAccountIdByCode(dr_account);
    const cr_account_id = await getAccountIdByCode(cr_account);
    console.log('Account IDs:', { dr_account_id, cr_account_id });
    if (!dr_account_id || !cr_account_id) {
      throw new Error(`Missing account ID(s): dr_account_id=${dr_account_id}, cr_account_id=${cr_account_id}`);
    }

    // Insert debit entry
    const [debitResult] = await connection.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [date, dr_account_id, amount, deal_id, description, 'LKR']
    );
    console.log('Debit insert result:', debitResult);

    // Insert credit entry
    const [creditResult] = await connection.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
      [date, cr_account_id, amount, deal_id, description, 'LKR']
    );
    console.log('Credit insert result:', creditResult);

    await connection.commit();
    console.log('Ledger entries inserted for deal', deal_id);
    return { success: true };
  } catch (err) {
    await connection.rollback();
    console.error('Ledger entry insert error:', err);
    return { success: false, error: err.message };
  } finally {
    connection.release();
  }
};

/**
 * Post a compound ledger entry with multiple debits and one credit
 * @param {Object} entry - Entry object with:
 *   - date: Entry date
 *   - dr_accounts: Array of {account_code, amount, description} for debits
 *   - cr_account: Credit account code
 *   - deal_id: Deal number
 *   - description: Overall description
 */
exports.postCompoundLedgerEntry = async function(entry) {
  console.log('postCompoundLedgerEntry function called');
  const { date, dr_accounts, cr_account, deal_id, description } = entry;
  
  if (!Array.isArray(dr_accounts) || dr_accounts.length === 0) {
    return { success: false, error: 'dr_accounts must be a non-empty array' };
  }
  
  // Calculate total debit amount
  const totalDebit = dr_accounts.reduce((sum, dr) => sum + parseFloat(dr.amount || 0), 0);
  
  console.log('Compound Entry:', { date, dr_accounts, cr_account, totalDebit, deal_id, description });
  
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    // Get credit account ID
    const cr_account_id = await getAccountIdByCode(cr_account);
    if (!cr_account_id) {
      throw new Error(`Credit account not found: ${cr_account}`);
    }
    
    // Insert all debit entries
    for (const dr of dr_accounts) {
      const dr_account_id = await getAccountIdByCode(dr.account_code);
      if (!dr_account_id) {
        throw new Error(`Debit account not found: ${dr.account_code}`);
      }
      
      const drDescription = dr.description || description;
      const drAmount = parseFloat(dr.amount || 0);
      
      await connection.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [date, dr_account_id, drAmount, deal_id, drDescription, 'LKR']
      );
      console.log(`Debit entry: ${dr.account_code} - ${drAmount}`);
    }
    
    // Insert credit entry (total of all debits)
    await connection.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
      [date, cr_account_id, totalDebit, deal_id, description, 'LKR']
    );
    console.log(`Credit entry: ${cr_account} - ${totalDebit}`);
    
    await connection.commit();
    console.log('Compound ledger entries inserted for deal', deal_id);
    return { success: true };
  } catch (err) {
    await connection.rollback();
    console.error('Compound ledger entry insert error:', err);
    return { success: false, error: err.message };
  } finally {
    connection.release();
  }
};