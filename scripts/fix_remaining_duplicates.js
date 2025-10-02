const db = require('../config/database');

async function fixRemainingDuplicates() {
  try {
    console.log('Checking for remaining duplicates...');
    
    // Check for exact duplicates (same date, category, description, amount)
    const [exactDupes] = await db.query(`
      SELECT transaction_date, category_id, description, amount, COUNT(*) as count
      FROM cashflow_transactions 
      GROUP BY transaction_date, category_id, description, amount
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `);
    
    console.log('Exact duplicates found:', exactDupes.length);
    if (exactDupes.length > 0) {
      console.log('Sample duplicates:');
      exactDupes.slice(0, 10).forEach(row => {
        console.log(`  ${row.transaction_date} | ${row.description} | ${row.amount} | ${row.count} times`);
      });
    }
    
    // Clean exact duplicates (keep only the first occurrence)
    let totalDeleted = 0;
    for (const dupe of exactDupes) {
      const [result] = await db.query(`
        DELETE t1 FROM cashflow_transactions t1
        INNER JOIN cashflow_transactions t2 
        WHERE t1.transaction_date = t2.transaction_date 
        AND t1.category_id = t2.category_id 
        AND t1.description = t2.description 
        AND t1.amount = t2.amount 
        AND t1.id > t2.id
        AND t1.transaction_date = ? 
        AND t1.category_id = ?
        AND t1.description = ?
        AND t1.amount = ?
      `, [dupe.transaction_date, dupe.category_id, dupe.description, dupe.amount]);
      
      if (result.affectedRows > 0) {
        console.log(`Cleaned ${dupe.description.substring(0, 50)}... - deleted ${result.affectedRows} duplicates`);
        totalDeleted += result.affectedRows;
      }
    }
    
    console.log(`Total duplicates deleted: ${totalDeleted}`);
    
    // Final count
    const [final] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions');
    console.log('Final count after cleanup:', final[0].count);
    
    // Verify no more duplicates
    const [verify] = await db.query(`
      SELECT COUNT(*) as duplicate_count
      FROM (
        SELECT transaction_date, category_id, description, amount, COUNT(*) as count
        FROM cashflow_transactions 
        GROUP BY transaction_date, category_id, description, amount
        HAVING COUNT(*) > 1
      ) as dupes
    `);
    
    console.log('Remaining duplicates:', verify[0].duplicate_count);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

fixRemainingDuplicates();
