const db = require('../config/db');

async function createAccountMappingsTable() {
  try {
    console.log('Creating account_mappings table...');

    // Create account_mappings table
    // Note: Using utf8mb4_0900_ai_ci collation to match chart_of_accounts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS account_mappings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mapping_key VARCHAR(100) NOT NULL UNIQUE,
        account_code VARCHAR(20) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (account_code) REFERENCES chart_of_accounts(account_code) ON DELETE RESTRICT ON UPDATE CASCADE,
        INDEX idx_mapping_key (mapping_key),
        INDEX idx_account_code (account_code),
        INDEX idx_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('Account mappings table created successfully');

    // Insert default mappings (these will use the old account codes as defaults)
    // Users can update these via API or admin interface
    const defaultMappings = [
      { key: 'GSEC_ASSET_TBONDS', code: '1-034-01-01-01', desc: 'GSEC Asset - Treasury Bonds' },
      { key: 'GSEC_DEFAULT_SETTLEMENT', code: '1-666-01-01-01', desc: 'GSEC Default Settlement Account - Seylan Bank' },
      { key: 'GSEC_ACCRUAL_ASSET', code: '1-212-01-01-01', desc: 'GSEC Daily Accrual Asset' },
      { key: 'GSEC_ACCRUAL_INCOME', code: '3-004-01-01-01', desc: 'GSEC Daily Accrual Income' },
      { key: 'MM_LENDING_CONTROL', code: '1-315-01-01-01', desc: 'Money Market Lending Control Account' },
      { key: 'MM_LOAN_LIABILITY', code: '2-708-01-01-01', desc: 'Money Market Loan Liability Account' },
      { key: 'MM_LENDING_INTEREST_ASSET', code: '1-201-01-01-01', desc: 'Money Market Lending Interest Asset' },
      { key: 'MM_LENDING_INTEREST_INCOME', code: '4-015-01-01-01', desc: 'Money Market Lending Interest Income' },
      { key: 'MM_BORROWING_INTEREST_EXPENSE', code: '6-288-01-01-01', desc: 'Money Market Borrowing Interest Expense' },
      { key: 'MM_BORROWING_INTEREST_LIABILITY', code: '2-304-01-01-01', desc: 'Money Market Borrowing Interest Liability' }
    ];

    for (const mapping of defaultMappings) {
      try {
        await db.query(
          `INSERT INTO account_mappings (mapping_key, account_code, description, is_active)
           VALUES (?, ?, ?, TRUE)
           ON DUPLICATE KEY UPDATE 
             account_code = VALUES(account_code),
             description = VALUES(description),
             updated_at = NOW()`,
          [mapping.key, mapping.code, mapping.desc]
        );
      } catch (err) {
        // Ignore if account code doesn't exist yet (will be set up later)
        console.log(`Skipping mapping ${mapping.key} - account code may not exist yet`);
      }
    }

    console.log('Default account mappings initialized');
    console.log('Note: You can update these mappings via the API or admin interface after setting up your new chart of accounts');

  } catch (error) {
    console.error('Error creating account_mappings table:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  createAccountMappingsTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createAccountMappingsTable;
