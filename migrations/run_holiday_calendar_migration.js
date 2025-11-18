const db = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Running holiday_calendar table migration...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'create_holiday_calendar_table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL
    await db.query(sql);
    
    console.log('✓ Holiday calendar table created successfully!');
    
    // Verify the table was created
    const [tables] = await db.query("SHOW TABLES LIKE 'holiday_calendar'");
    if (tables.length > 0) {
      console.log('✓ Table verification: holiday_calendar table exists');
      
      // Show table structure
      const [columns] = await db.query('DESCRIBE holiday_calendar');
      console.log('\nTable structure:');
      console.table(columns);
    } else {
      console.log('⚠ Warning: Table verification failed');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    if (error.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('ℹ Table already exists. This is okay if you want to keep existing data.');
    } else {
      console.error('Full error:', error);
    }
    process.exit(1);
  }
}

runMigration();

