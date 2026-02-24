const db = require('../config/db');

async function createJointCounterpartyTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS counterparty_master_joint (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(10) NOT NULL,
        short_name VARCHAR(100),
        long_name VARCHAR(200),
        id_type VARCHAR(30) NOT NULL,
        house_number VARCHAR(50),
        street_name VARCHAR(100),
        province VARCHAR(50),
        postal_code VARCHAR(20),
        city VARCHAR(50),
        country VARCHAR(50),
        telephone VARCHAR(30),
        email VARCHAR(100),
        mobile VARCHAR(30),
        custodian_bank VARCHAR(200),
        cds_account VARCHAR(100),
        cux_number VARCHAR(50),
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_joint_cux (cux_number),
        INDEX idx_short_name (short_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await db.query(sql);
    console.log('Joint counterparty table created successfully');
  } catch (error) {
    console.error('Error creating joint counterparty table:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  createJointCounterpartyTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createJointCounterpartyTable;
