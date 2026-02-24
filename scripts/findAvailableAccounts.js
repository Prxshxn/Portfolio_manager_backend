const db = require('../config/db');

(async () => {
  try {
    console.log('Finding available accounts in chart_of_accounts...\n');
    
    // Get all accounts
    const [allAccounts] = await db.query('SELECT account_code, name, account_type_id FROM chart_of_accounts ORDER BY account_code LIMIT 50');
    
    console.log('Available accounts:');
    allAccounts.forEach(acc => {
      console.log(`  ${acc.account_code} - ${acc.name}`);
    });
    
    // Look for investment accounts
    console.log('\nLooking for investment-related accounts...');
    const [investmentAccounts] = await db.query(
      "SELECT account_code, name FROM chart_of_accounts WHERE name LIKE '%investment%' OR name LIKE '%deposit%' OR name LIKE '%fixed%' OR account_code LIKE '2%'"
    );
    investmentAccounts.forEach(acc => {
      console.log(`  ${acc.account_code} - ${acc.name}`);
    });
    
    // Look for bank/cash accounts
    console.log('\nLooking for bank/cash accounts...');
    const [bankAccounts] = await db.query(
      "SELECT account_code, name FROM chart_of_accounts WHERE name LIKE '%bank%' OR name LIKE '%cash%' OR account_code LIKE '1%'"
    );
    bankAccounts.forEach(acc => {
      console.log(`  ${acc.account_code} - ${acc.name}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
