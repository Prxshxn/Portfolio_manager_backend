const db = require('../config/database');

async function cleanupDuplicates() {
  try {
    console.log('Cleaning up duplicate coupon cashflow entries...');
    
    // Delete auto-capture entries (GSEC-<dealId>-COUPON without date)
    // Keep only backfill entries (GSEC-<dealId>-COUPON-<date>)
    const [deleteResult] = await db.query(`
      DELETE FROM cashflow_transactions 
      WHERE reference_number LIKE 'GSEC-%-COUPON' 
      AND reference_number NOT LIKE 'GSEC-%-COUPON-%-%'
    `);
    
    console.log(`Deleted ${deleteResult.affectedRows} duplicate auto-capture entries`);
    
    // Check remaining coupon transactions
    const [remaining] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions WHERE reference_number LIKE "GSEC-%-COUPON%"');
    console.log('Remaining coupon transactions:', remaining[0].count);
    
    // Verify no more duplicates
    const [dupes] = await db.query('SELECT reference_number, COUNT(*) as count FROM cashflow_transactions WHERE reference_number LIKE "GSEC-%-COUPON%" GROUP BY reference_number HAVING COUNT(*) > 1');
    console.log('Remaining duplicates:', dupes.length);
    
    // Show sample of remaining entries
    const [samples] = await db.query(`
      SELECT transaction_date, amount, reference_number, description 
      FROM cashflow_transactions 
      WHERE reference_number LIKE 'GSEC-%-COUPON%' 
      ORDER BY transaction_date DESC 
      LIMIT 5
    `);
    console.log('Sample remaining entries:');
    samples.forEach(row => {
      console.log(`  ${row.transaction_date} | ${row.amount} | ${row.reference_number} | ${row.description}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

cleanupDuplicates();
