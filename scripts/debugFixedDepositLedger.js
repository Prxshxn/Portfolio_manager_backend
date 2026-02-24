const db = require('../config/db');

(async () => {
  try {
    console.log('=== Fixed Deposit Ledger Entry Diagnostic ===\n');
    
    // 1. Check if chart_of_accounts has required accounts
    console.log('1. Checking chart_of_accounts for required accounts...');
    const [account2002] = await db.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', ['2002']);
    const [account1002] = await db.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', ['1002']);
    
    console.log(`   Account 2002 (Fixed Income Investments): ${account2002.length > 0 ? '✓ Found' : '✗ NOT FOUND'}`);
    if (account2002.length > 0) {
      console.log(`     ID: ${account2002[0].id}, Name: ${account2002[0].name}`);
    }
    
    console.log(`   Account 1002 (Bank Current Account): ${account1002.length > 0 ? '✓ Found' : '✗ NOT FOUND'}`);
    if (account1002.length > 0) {
      console.log(`     ID: ${account1002[0].id}, Name: ${account1002[0].name}`);
    }
    
    // 2. Check settlement_accounts structure
    console.log('\n2. Checking settlement_accounts table structure...');
    const [settlementColumns] = await db.query('DESCRIBE settlement_accounts');
    const hasLedgerAccountCode = settlementColumns.some(col => col.Field === 'ledger_account_code');
    console.log(`   ledger_account_code column: ${hasLedgerAccountCode ? '✓ Exists' : '✗ NOT FOUND'}`);
    
    if (hasLedgerAccountCode) {
      const [settlementWithCode] = await db.query(
        'SELECT * FROM settlement_accounts WHERE ledger_account_code IS NOT NULL AND ledger_account_code != "" LIMIT 1'
      );
      console.log(`   Settlement accounts with ledger_account_code: ${settlementWithCode.length > 0 ? '✓ Found' : '✗ None found'}`);
      if (settlementWithCode.length > 0) {
        console.log(`     Bank: ${settlementWithCode[0].bank_name}, Code: ${settlementWithCode[0].ledger_account_code}`);
      }
    }
    
    // 3. Check account mappings
    console.log('\n3. Checking account mappings...');
    try {
      const [fdMapping] = await db.query(
        'SELECT * FROM account_mappings WHERE mapping_key = ? AND is_active = TRUE',
        ['FD_INVESTMENT']
      );
      console.log(`   FD_INVESTMENT mapping: ${fdMapping.length > 0 ? '✓ Found' : '✗ NOT FOUND'}`);
      if (fdMapping.length > 0) {
        console.log(`     Account Code: ${fdMapping[0].account_code}`);
      }
    } catch (err) {
      console.log(`   account_mappings table: ${err.message.includes('doesn\'t exist') ? '✗ Table does not exist' : 'Error: ' + err.message}`);
    }
    
    // 4. Check recent fixed deposit approvals
    console.log('\n4. Checking recent fixed deposit approvals...');
    const [recentFDs] = await db.query(
      `SELECT id, request_no, requested_amount, status, current_approval_level, approved_at 
       FROM fixed_deposit_requests 
       WHERE status = 'Approved' 
       ORDER BY approved_at DESC 
       LIMIT 5`
    );
    console.log(`   Recent approved FDs: ${recentFDs.length}`);
    recentFDs.forEach(fd => {
      console.log(`     ID: ${fd.id}, Request No: ${fd.request_no}, Amount: ${fd.requested_amount}, Approved: ${fd.approved_at}`);
    });
    
    // 5. Check if ledger entries exist for recent FDs
    console.log('\n5. Checking ledger entries for recent FDs...');
    for (const fd of recentFDs) {
      const requestNumber = fd.request_no || `FD-${fd.id}`;
      const [entries] = await db.query(
        'SELECT COUNT(*) as cnt FROM ledger_entries WHERE deal_number = ?',
        [requestNumber]
      );
      console.log(`   Request ${requestNumber}: ${entries[0].cnt > 0 ? '✓ Has entries' : '✗ NO ENTRIES'}`);
      if (entries[0].cnt > 0) {
        const [entryDetails] = await db.query(
          'SELECT * FROM ledger_entries WHERE deal_number = ? LIMIT 2',
          [requestNumber]
        );
        entryDetails.forEach(entry => {
          console.log(`     Entry ID: ${entry.id}, Account: ${entry.account_id}, DR: ${entry.debit_amount}, CR: ${entry.credit_amount}`);
        });
      }
    }
    
    // 6. Test account lookup
    console.log('\n6. Testing account lookup logic...');
    let testAccount = null;
    try {
      const [testAccounts] = await db.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', ['2002']);
      testAccount = testAccounts[0];
      console.log(`   Direct lookup (2002): ${testAccount ? '✓ Success' : '✗ Failed'}`);
    } catch (err) {
      console.log(`   Direct lookup error: ${err.message}`);
    }
    
    console.log('\n=== Diagnostic Complete ===\n');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
