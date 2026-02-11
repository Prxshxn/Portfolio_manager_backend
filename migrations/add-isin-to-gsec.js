const db = require('../config/db');

async function addMissingColumns() {
  try {
    console.log('Adding missing columns to gsec table...');
    
    // Check existing columns
    const [columns] = await db.query('DESCRIBE gsec');
    const columnNames = columns.map(col => col.Field);
    const hasIsin = columnNames.includes('isin');
    const hasCounterparty = columnNames.includes('counterparty');
    
    // Add isin column if missing
    if (!hasIsin) {
      console.log('Adding isin column...');
      await db.query(`
        ALTER TABLE gsec 
        ADD COLUMN isin VARCHAR(50) NULL AFTER isin_number
      `);
      
      // Populate isin column from isin_number for existing records
      console.log('Populating isin column from isin_number...');
      await db.query(`
        UPDATE gsec 
        SET isin = isin_number 
        WHERE isin IS NULL AND isin_number IS NOT NULL
      `);
      console.log('Successfully added and populated isin column');
    } else {
      console.log('isin column already exists');
    }
    
    // Add counterparty column if missing
    if (!hasCounterparty) {
      console.log('Adding counterparty column...');
      await db.query(`
        ALTER TABLE gsec 
        ADD COLUMN counterparty VARCHAR(255) NULL AFTER counterparty_id
      `);
      
      // Populate counterparty column from counterparty_id for existing records
      // Format: 'c' + counterparty_id for corporate, 'i' + id for individual, 'j' + id for joint
      console.log('Populating counterparty column from counterparty_id...');
      // Default to 'c' prefix (corporate) - this may need adjustment based on your data
      await db.query(`
        UPDATE gsec 
        SET counterparty = CONCAT('c', counterparty_id) 
        WHERE counterparty IS NULL AND counterparty_id IS NOT NULL
      `);
      console.log('Successfully added and populated counterparty column');
    } else {
      console.log('counterparty column already exists');
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error adding columns:', error);
    throw error;
  }
}

if (require.main === module) {
  addMissingColumns()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = addMissingColumns;
