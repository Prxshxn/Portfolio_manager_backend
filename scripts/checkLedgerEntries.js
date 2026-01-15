const db = require('../config/database');

(async () => {
  try {
    // Check total ledger entries
    const [countRows] = await db.query('SELECT COUNT(*) as total FROM ledger_entries');
    console.log('Total ledger entries in DB:', countRows[0].total);
    
    // Check if entries have valid account_ids
    const [invalidAccounts] = await db.query(`
      SELECT COUNT(*) as total 
      FROM ledger_entries le 
      LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id 
      WHERE coa.id IS NULL
    `);
    console.log('Entries with invalid account_id:', invalidAccounts[0].total);
    
    // Check recent entry dates
    const [dateRows] = await db.query(`
      SELECT entry_date, COUNT(*) as cnt 
      FROM ledger_entries 
      GROUP BY entry_date 
      ORDER BY entry_date DESC 
      LIMIT 10
    `);
    console.log('\nRecent entry dates:');
    dateRows.forEach(r => console.log(`  ${r.entry_date}: ${r.cnt} entries`));
    
    // Check sample entries
    const [sampleRows] = await db.query(`
      SELECT le.id, le.entry_date, le.account_id, le.deal_number, 
             coa.account_code, coa.name as account_name
      FROM ledger_entries le
      LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
      ORDER BY le.id DESC
      LIMIT 5
    `);
    console.log('\nSample entries:');
    sampleRows.forEach(r => {
      console.log(`  ID: ${r.id}, Date: ${r.entry_date}, Account: ${r.account_id} (${r.account_code || 'NOT FOUND'} - ${r.account_name || 'N/A'}), Deal: ${r.deal_number}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
