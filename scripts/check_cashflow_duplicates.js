const db = require('../config/database');

async function checkDuplicates() {
  try {
    console.log('Checking cashflow transactions for duplicates...');
    
    // Check total cashflow transactions
    const [total] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions');
    console.log('Total cashflow transactions:', total[0].count);
    
    // Check coupon transactions specifically
    const [coupon] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions WHERE reference_number LIKE "GSEC-%-COUPON%"');
    console.log('GSEC coupon transactions:', coupon[0].count);
    
    // Check for exact duplicates (same reference_number)
    const [dupes] = await db.query('SELECT reference_number, COUNT(*) as count FROM cashflow_transactions WHERE reference_number LIKE "GSEC-%-COUPON%" GROUP BY reference_number HAVING COUNT(*) > 1 LIMIT 10');
    console.log('Duplicate reference numbers found:', dupes.length);
    if (dupes.length > 0) {
      console.log('Sample duplicates:', dupes.slice(0, 3));
    }
    
    // Check date range of coupon transactions
    const [dateRange] = await db.query('SELECT MIN(transaction_date) as min_date, MAX(transaction_date) as max_date FROM cashflow_transactions WHERE reference_number LIKE "GSEC-%-COUPON%"');
    console.log('Coupon date range:', dateRange[0]);
    
    // Check for duplicates from auto-capture vs backfill
    const [autoCapture] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions WHERE reference_number LIKE "GSEC-%-COUPON" AND reference_number NOT LIKE "%-%"');
    const [backfill] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions WHERE reference_number LIKE "GSEC-%-COUPON-%-%"');
    console.log('Auto-capture coupon entries:', autoCapture[0].count);
    console.log('Backfill coupon entries:', backfill[0].count);
    
    // Check for same deal_id with different reference formats
    const [mixedRefs] = await db.query(`
      SELECT 
        SUBSTRING_INDEX(SUBSTRING_INDEX(reference_number, '-', 2), '-', -1) as deal_id,
        COUNT(DISTINCT reference_number) as ref_count,
        COUNT(*) as total_count
      FROM cashflow_transactions 
      WHERE reference_number LIKE "GSEC-%-COUPON%"
      GROUP BY deal_id
      HAVING COUNT(DISTINCT reference_number) > 1
      LIMIT 5
    `);
    console.log('Deals with mixed reference formats:', mixedRefs.length);
    if (mixedRefs.length > 0) {
      console.log('Sample mixed references:', mixedRefs.slice(0, 3));
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkDuplicates();
