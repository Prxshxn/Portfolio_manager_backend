const db = require('../config/database');

async function checkAllDuplicates() {
  try {
    console.log('Checking for all types of duplicates in cashflow transactions...');
    
    // Check total transactions
    const [total] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions');
    console.log('Total cashflow transactions:', total[0].count);
    
    // Check for exact duplicates (same reference_number)
    const [exactDupes] = await db.query(`
      SELECT reference_number, COUNT(*) as count 
      FROM cashflow_transactions 
      GROUP BY reference_number 
      HAVING COUNT(*) > 1 
      ORDER BY count DESC 
      LIMIT 10
    `);
    console.log('Exact duplicate reference numbers:', exactDupes.length);
    if (exactDupes.length > 0) {
      console.log('Sample exact duplicates:');
      exactDupes.slice(0, 5).forEach(row => {
        console.log(`  ${row.reference_number}: ${row.count} times`);
      });
    }
    
    // Check for same deal but different reference formats
    const [dealDupes] = await db.query(`
      SELECT 
        CASE 
          WHEN reference_number LIKE 'GSEC-%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(reference_number, '-', 2), '-', -1)
          WHEN reference_number LIKE 'MM-%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(reference_number, '-', 2), '-', -1)
          WHEN reference_number LIKE 'REPO-%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(reference_number, '-', 2), '-', -1)
          ELSE 'other'
        END as deal_id,
        COUNT(DISTINCT reference_number) as ref_count,
        COUNT(*) as total_count,
        GROUP_CONCAT(DISTINCT reference_number) as references
      FROM cashflow_transactions 
      WHERE reference_number LIKE 'GSEC-%' OR reference_number LIKE 'MM-%' OR reference_number LIKE 'REPO-%'
      GROUP BY deal_id
      HAVING COUNT(DISTINCT reference_number) > 1
      ORDER BY total_count DESC
      LIMIT 10
    `);
    console.log('Deals with multiple reference formats:', dealDupes.length);
    if (dealDupes.length > 0) {
      console.log('Sample deal duplicates:');
      dealDupes.slice(0, 5).forEach(row => {
        console.log(`  Deal ${row.deal_id}: ${row.ref_count} ref formats, ${row.total_count} total entries`);
        console.log(`    References: ${row.references}`);
      });
    }
    
    // Check for same date/amount/description duplicates
    const [contentDupes] = await db.query(`
      SELECT 
        transaction_date, 
        amount, 
        description, 
        flow_type,
        COUNT(*) as count
      FROM cashflow_transactions 
      GROUP BY transaction_date, amount, description, flow_type
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10
    `);
    console.log('Content duplicates (same date/amount/description):', contentDupes.length);
    if (contentDupes.length > 0) {
      console.log('Sample content duplicates:');
      contentDupes.slice(0, 5).forEach(row => {
        console.log(`  ${row.transaction_date} | ${row.amount} | ${row.description} | ${row.flow_type}: ${row.count} times`);
      });
    }
    
    // Check breakdown by source
    const [breakdown] = await db.query(`
      SELECT 
        CASE 
          WHEN reference_number LIKE 'GSEC-%' THEN 'GSEC'
          WHEN reference_number LIKE 'MM-%' THEN 'Money Market'
          WHEN reference_number LIKE 'REPO-%' THEN 'Repo'
          WHEN reference_number LIKE '%-COUPON%' THEN 'Coupon'
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

checkAllDuplicates();
