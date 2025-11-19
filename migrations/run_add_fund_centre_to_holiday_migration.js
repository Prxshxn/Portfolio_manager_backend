const db = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Running add fund_centre_id to holiday_calendar migration...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'add_fund_centre_to_holiday_calendar.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL
    await db.query(sql);
    
    console.log('✓ Fund centre ID column added to holiday_calendar table successfully!');
    
    // Verify the column was added
    const [columns] = await db.query('DESCRIBE holiday_calendar');
    const fundCentreColumn = columns.find(col => col.Field === 'fund_centre_id');
    
    if (fundCentreColumn) {
      console.log('✓ Column verification: fund_centre_id column exists');
      console.log('\nColumn details:');
      console.table([fundCentreColumn]);
    } else {
      console.log('⚠ Warning: Column verification failed');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ Column already exists. This is okay if you want to keep existing data.');
      process.exit(0);
    } else {
      console.error('Full error:', error);
      process.exit(1);
    }
  }
}

runMigration();

