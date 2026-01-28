const db = require('../config/db');

async function addUniqueNicConstraint() {
  try {
    console.log('Adding unique constraint on id_number column in counterparty_master_individual...');
    
    // First check if table exists
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_master_individual'
    `);
    
    if (tables.length === 0) {
      console.log('Table counterparty_master_individual does not exist yet. Skipping constraint addition.');
      return;
    }
    
    // Check if unique constraint already exists
    const [indexes] = await db.query(`
      SELECT INDEX_NAME, COLUMN_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_master_individual' 
      AND COLUMN_NAME = 'id_number' 
      AND NON_UNIQUE = 0
    `);
    
    if (indexes.length > 0) {
      console.log('Unique constraint on id_number already exists.');
      return;
    }
    
    // Add unique constraint
    await db.query(`
      ALTER TABLE counterparty_master_individual 
      ADD UNIQUE KEY unique_id_number (id_number)
    `);
    
    console.log('Successfully added unique constraint on id_number column.');
  } catch (error) {
    // If table doesn't exist, that's okay - it will be created later
    if (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146) {
      console.log('Table counterparty_master_individual does not exist yet. Skipping constraint addition.');
      return;
    }
    // If error is about duplicate values, we need to clean them first
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      console.error('Cannot add unique constraint: duplicate NIC numbers exist in the table.');
      console.error('Please remove duplicate NIC numbers before running this migration.');
      throw error;
    }
    // If constraint already exists, that's fine
    if (error.code === 'ER_DUP_KEYNAME' || error.errno === 1061) {
      console.log('Unique constraint on id_number already exists.');
      return;
    }
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  addUniqueNicConstraint()
    .then(() => {
      console.log('Migration completed successfully.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addUniqueNicConstraint;

