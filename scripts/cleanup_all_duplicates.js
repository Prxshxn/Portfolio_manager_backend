const db = require('../config/database');

async function cleanupAllDuplicates() {
  try {
    console.log('Cleaning up ALL duplicate cashflow transactions...');
    
    // Get all duplicate reference numbers
    const [allDupes] = await db.query(`
      SELECT reference_number, COUNT(*) as count 
      FROM cashflow_transactions 
      GROUP BY reference_number 
      HAVING COUNT(*) > 1 
      ORDER BY count DESC
    `);
    console.log(`Found ${allDupes.length} duplicate reference numbers`);
    
    let totalDeleted = 0;
    
    // Process in batches to avoid memory issues
    const batchSize = 50;
    for (let i = 0; i < allDupes.length; i += batchSize) {
      const batch = allDupes.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allDupes.length/batchSize)}...`);
      
      for (const dupe of batch) {
        // For each duplicate reference, keep only the most recent entry
        const [deleteResult] = await db.query(`
          DELETE t1 FROM cashflow_transactions t1
          INNER JOIN cashflow_transactions t2 
          WHERE t1.reference_number = t2.reference_number 
          AND t1.id < t2.id
          AND t1.reference_number = ?
        `, [dupe.reference_number]);
        
        totalDeleted += deleteResult.affectedRows;
      }
    }
    
    console.log(`Total deleted: ${totalDeleted} duplicate entries`);
    
    // Verify no more duplicates
    const [remainingDupes] = await db.query(`
      SELECT reference_number, COUNT(*) as count 
      FROM cashflow_transactions 
      GROUP BY reference_number 
      HAVING COUNT(*) > 1
    `);
    console.log('Remaining exact duplicates:', remainingDupes.length);
    
    // Check final count
    const [final] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions');
    console.log('Final total cashflow transactions:', final[0].count);
    
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
    console.log('Final breakdown by source:');
    breakdown.forEach(row => {
      console.log(`  ${row.source}: ${row.count}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

cleanupAllDuplicates();
