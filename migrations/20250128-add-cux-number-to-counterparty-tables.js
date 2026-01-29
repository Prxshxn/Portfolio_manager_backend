const db = require('../config/db');

async function addCuxNumberToCounterpartyTables() {
  try {
    // Check and add cux_number to counterparty_master_corporate
    const [corporateColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_master_corporate' 
      AND COLUMN_NAME = 'cux_number'
    `);
    
    if (corporateColumns.length === 0) {
      await db.query(`
        ALTER TABLE counterparty_master_corporate 
        ADD COLUMN cux_number VARCHAR(50) NULL AFTER cds_account
      `);
      console.log('✓ Added cux_number column to counterparty_master_corporate');
    } else {
      console.log('⏭ cux_number column already exists in counterparty_master_corporate');
    }
    
    // Check and add unique index for corporate
    const [corporateIndexes] = await db.query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_master_corporate' 
      AND INDEX_NAME = 'uniq_corporate_cux'
    `);
    
    if (corporateIndexes.length === 0) {
      await db.query(`
        CREATE UNIQUE INDEX uniq_corporate_cux ON counterparty_master_corporate(cux_number)
      `);
      console.log('✓ Added unique index on cux_number for counterparty_master_corporate');
    } else {
      console.log('⏭ Unique index uniq_corporate_cux already exists');
    }
    
    // Check and add cux_number to counterparty_master_joint
    const [jointColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_master_joint' 
      AND COLUMN_NAME = 'cux_number'
    `);
    
    if (jointColumns.length === 0) {
      await db.query(`
        ALTER TABLE counterparty_master_joint 
        ADD COLUMN cux_number VARCHAR(50) NULL AFTER cds_account
      `);
      console.log('✓ Added cux_number column to counterparty_master_joint');
    } else {
      console.log('⏭ cux_number column already exists in counterparty_master_joint');
    }
    
    // Check and add unique index for joint
    const [jointIndexes] = await db.query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_master_joint' 
      AND INDEX_NAME = 'uniq_joint_cux'
    `);
    
    if (jointIndexes.length === 0) {
      await db.query(`
        CREATE UNIQUE INDEX uniq_joint_cux ON counterparty_master_joint(cux_number)
      `);
      console.log('✓ Added unique index on cux_number for counterparty_master_joint');
    } else {
      console.log('⏭ Unique index uniq_joint_cux already exists');
    }
    
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  addCuxNumberToCounterpartyTables()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addCuxNumberToCounterpartyTables;
