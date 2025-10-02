const db = require('../config/database');

async function aggressiveCleanup() {
  try {
    console.log('Starting aggressive duplicate cleanup...');
    
    let iteration = 0;
    let totalDeleted = 0;
    
    while (true) {
      iteration++;
      console.log(`\n--- Iteration ${iteration} ---`);
      
      // Check for exact duplicates
      const [exactDupes] = await db.query(`
        SELECT transaction_date, category_id, description, amount, COUNT(*) as count
        FROM cashflow_transactions 
        GROUP BY transaction_date, category_id, description, amount
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 50
      `);
      
      if (exactDupes.length === 0) {
        console.log('No more duplicates found!');
        break;
      }
      
      console.log(`Found ${exactDupes.length} duplicate groups`);
      
      // Clean exact duplicates (keep only the first occurrence)
      let iterationDeleted = 0;
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
          iterationDeleted += result.affectedRows;
        }
      }
      
      console.log(`Deleted ${iterationDeleted} duplicates in this iteration`);
      totalDeleted += iterationDeleted;
      
      // Safety check - prevent infinite loop
      if (iteration > 20) {
        console.log('Maximum iterations reached, stopping...');
        break;
      }
    }
    
    console.log(`\n=== CLEANUP COMPLETE ===`);
    console.log(`Total iterations: ${iteration}`);
    console.log(`Total duplicates deleted: ${totalDeleted}`);
    
    // Final count
    const [final] = await db.query('SELECT COUNT(*) as count FROM cashflow_transactions');
    console.log(`Final count: ${final[0].count}`);
    
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
    
    console.log(`Remaining duplicates: ${verify[0].duplicate_count}`);
    
    if (verify[0].duplicate_count === 0) {
      console.log('✅ ALL DUPLICATES SUCCESSFULLY REMOVED!');
    } else {
      console.log('⚠️  Some duplicates may still remain');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

aggressiveCleanup();
