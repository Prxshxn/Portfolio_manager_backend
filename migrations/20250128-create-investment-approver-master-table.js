const db = require('../config/db');

async function createInvestmentApproverMasterTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS investment_approver_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        approver_type ENUM('Committee', 'Individual') NOT NULL DEFAULT 'Individual',
        designation VARCHAR(150),
        contact_number VARCHAR(50),
        address TEXT,
        approver_level ENUM('Checker', 'Approver', 'Final Approver') NOT NULL DEFAULT 'Checker',
        approver_limit DECIMAL(18,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_approver_type (approver_type),
        INDEX idx_approver_level (approver_level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await db.query(sql);
    console.log('Investment Approver Master table created successfully');
  } catch (error) {
    console.error('Error creating Investment Approver Master table:', error);
    throw error;
  }
}

// Run the migration directly if executed as a script
if (require.main === module) {
  createInvestmentApproverMasterTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createInvestmentApproverMasterTable;

