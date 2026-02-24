const db = require('../config/db');

async function addDealNumberColumn() {
  try {
    console.log('Adding deal_number column to ledger_entries table...');
    
    // Check if column already exists
    const [columns] = await db.query('DESCRIBE ledger_entries');
    const hasDealNumber = columns.some(col => col.Field === 'deal_number');
    
    if (hasDealNumber) {
      console.log('deal_number column already exists in ledger_entries table');
      return;
    }
    
    // Add the column
    await db.query(`
      ALTER TABLE ledger_entries 
      ADD COLUMN deal_number VARCHAR(64) NULL AFTER transaction_id
    `);
    
    console.log('Successfully added deal_number column to ledger_entries table');
  } catch (error) {
    console.error('Error adding deal_number column:', error);
    throw error;
  }
}

if (require.main === module) {
  addDealNumberColumn()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = addDealNumberColumn;
