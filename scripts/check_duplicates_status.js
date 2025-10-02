const db = require('../config/database');

async function checkStatus() {
  try {
    console.log('Checking current duplicate status...');
    
    // Check total transactions
    const [total] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions');
    console.log('Total cashflow transactions:', total[0].count);
    
    // Check for exact duplicates
    const [dupes] = await db.query(`
      SELECT reference_number, COUNT(*) as count 
      FROM cashflow_transactions 
      GROUP BY reference_number 
      HAVING COUNT(*) > 1 
      ORDER BY count DESC 
      LIMIT 10
    `);
    console.log('Exact duplicate reference numbers:', dupes.length);
    if (dupes.length > 0) {
      console.log('Sample remaining duplicates:');
      dupes.slice(0, 5).forEach(row => {
        console.log(`  ${row.reference_number}: ${row.count} times`);
      });
    }
    
    // Show breakdown by source
    const [breakdown] = await db.query(`
      SELECT 
        CASE 
          WHEN reference_number LIKE 'GSEC-%' AND reference_number LIKE '%-COUPON%' THEN 'GSEC Coupons'
          WHEN reference_number LIKE 'GSEC-%' THEN 'GSEC Transactions'
          WHEN reference_number LIKE 'MM-%' THEN 'Money Market'
          WHEN reference_number LIKE 'REPO-%' THEN 'Repo'
          ELSE 'Other'
        END as source,
        COUNT(*) as count
      FROM cashflow_transactions 
      GROUP BY source
      ORDER BY count DESC
    `);
    console.log('Breakdown by source:');
    breakdown.forEach(row => {
      console.log(`  ${row.source}: ${row.count}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkStatus();
