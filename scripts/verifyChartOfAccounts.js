const db = require('../config/database');

(async () => {
  try {
    const [countRows] = await db.query('SELECT COUNT(*) as total, COUNT(DISTINCT account_code) as unique_codes FROM chart_of_accounts');
    console.log('📊 Chart of Accounts Summary:');
    console.log(`   Total accounts: ${countRows[0].total}`);
    console.log(`   Unique account codes: ${countRows[0].unique_codes}`);
    
    console.log('\n📋 Sample accounts (first 10):');
    const [sampleRows] = await db.query('SELECT account_code, name, is_active FROM chart_of_accounts ORDER BY account_code LIMIT 10');
    sampleRows.forEach(r => {
      console.log(`   ${r.account_code} - ${r.name} (${r.is_active ? 'Active' : 'Inactive'})`);
    });
    
    console.log('\n✅ Verification complete');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
})();
