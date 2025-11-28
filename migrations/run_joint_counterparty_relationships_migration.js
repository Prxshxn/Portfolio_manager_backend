const db = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Running joint_counterparty_relationships table migration...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'update_joint_counterparty_relationships_table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL
    await db.query(sql);
    
    console.log('✓ Joint counterparty relationships table created successfully!');
    
    // Verify the table was created
    const [tables] = await db.query("SHOW TABLES LIKE 'joint_counterparty_relationships'");
    if (tables.length > 0) {
      console.log('✓ Table verification: joint_counterparty_relationships table exists');
      
      // Show table structure
      const [columns] = await db.query('DESCRIBE joint_counterparty_relationships');
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

