const db = require('../config/database');

(async () => {
  try {
    // Check what account_ids are used
    const [accountRows] = await db.query(`
      SELECT account_id, COUNT(*) as cnt 
      FROM ledger_entries 
      GROUP BY account_id 
      ORDER BY cnt DESC 
      LIMIT 10
    `);
    console.log('Most used account_ids in ledger_entries:');
    accountRows.forEach(r => console.log(`  Account ID ${r.account_id}: ${r.cnt} entries`));
    
    // Check if any of these account_ids exist in new chart_of_accounts
    const accountIds = accountRows.map(r => r.account_id);
    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',');
      const [existingRows] = await db.query(`
        SELECT id, account_code, name 
        FROM chart_of_accounts 
        WHERE id IN (${placeholders})
      `, accountIds);
      console.log('\nExisting accounts in new chart_of_accounts:');
      existingRows.forEach(r => console.log(`  ID ${r.id}: ${r.account_code} - ${r.name}`));
      
      console.log('\nMissing accounts:', accountIds.length - existingRows.length);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
