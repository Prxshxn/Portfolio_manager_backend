const db = require('../config/database');

async function addTransactionLimitToLimitSetup() {
  try {
    // First check if table exists
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_limits'
    `);
    
    if (tables.length === 0) {
      console.log('Table counterparty_limits does not exist yet. Skipping column addition.');
      return;
    }
    
    // Check if columns already exist
    const [columns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'counterparty_limits' 
      AND COLUMN_NAME IN ('product_transaction_limit', 'currency')
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    // Build ALTER statement only for missing columns
    const alterStatements = [];
    if (!existingColumns.includes('product_transaction_limit')) {
      alterStatements.push('ADD COLUMN product_transaction_limit DECIMAL(15, 2) DEFAULT 0.00');
    }
    if (!existingColumns.includes('currency')) {
      alterStatements.push("ADD COLUMN currency VARCHAR(10) DEFAULT 'LKR'");
    }
    
    if (alterStatements.length > 0) {
      await db.query(`
        ALTER TABLE counterparty_limits 
        ${alterStatements.join(',\n      ')}
      `);
      console.log('Added product_transaction_limit and currency columns to counterparty_limits table');
    } else {
      console.log('Columns already exist, skipping migration.');
    }
  } catch (err) {
    // If table doesn't exist, that's okay - it will be created later
    if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
      console.log('Table counterparty_limits does not exist yet. Skipping column addition.');
      return;
    }
    // If columns already exist, print a message
    if (err.message.includes('Duplicate column name') || err.code === 'ER_DUP_FIELDNAME') {
      console.log('Columns already exist, skipping migration.');
    } else {
      throw err;
    }
  }
}

addTransactionLimitToLimitSetup();
