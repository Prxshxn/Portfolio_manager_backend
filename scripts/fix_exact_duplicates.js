const db = require('../config/database');

async function fixExactDuplicates() {
  try {
    console.log('Fixing exact duplicate reference numbers...');
    
    // Check for exact duplicates first
    const [dupes] = await db.query(`
      SELECT reference_number, COUNT(*) as count 
      FROM cashflow_transactions 
      GROUP BY reference_number 
      HAVING COUNT(*) > 1 
      ORDER BY count DESC 
      LIMIT 10
    `);
    console.log('Found exact duplicate reference numbers:', dupes.length);
    if (dupes.length > 0) {
      console.log('Sample duplicates:');
      dupes.slice(0, 5).forEach(row => {
        console.log(`  ${row.reference_number}: ${row.count} times`);
      });
    }
    
    // For each duplicate reference, keep only the most recent entry
    for (const dupe of dupes) {
      console.log(`Fixing duplicates for ${dupe.reference_number}...`);
      
      // Get all entries for this reference
      const [entries] = await db.query(`
        SELECT id, created_at 
        FROM cashflow_transactions 
        WHERE reference_number = ? 
        ORDER BY created_at DESC
      `, [dupe.reference_number]);
      
      // Keep the first (most recent) entry, delete the rest
      const toDelete = entries.slice(1);
      if (toDelete.length > 0) {
        const deleteIds = toDelete.map(e => e.id);
        const [deleteResult] = await db.query(`
          DELETE FROM cashflow_transactions 
          WHERE id IN (${deleteIds.map(() => '?').join(',')})
        `, deleteIds);
        
        console.log(`  Deleted ${deleteResult.affectedRows} duplicate entries for ${dupe.reference_number}`);
      }
    }
    
    // Verify no more exact duplicates
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
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

fixExactDuplicates();
