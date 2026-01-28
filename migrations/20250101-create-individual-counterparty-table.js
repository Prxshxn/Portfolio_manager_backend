const db = require('../config/db');

async function createIndividualCounterpartyTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS counterparty_master_individual (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(10),
        short_name VARCHAR(100),
        long_name VARCHAR(200),
        id_type VARCHAR(50),
        id_number VARCHAR(50),
        cux_number VARCHAR(50),
        house_number VARCHAR(50),
        street_name VARCHAR(100),
        province VARCHAR(100),
        postal_code VARCHAR(20),
        city VARCHAR(100),
        country VARCHAR(100),
        telephone VARCHAR(50),
        email VARCHAR(150),
        mobile VARCHAR(50),
        custodian_bank VARCHAR(150),
        cds_account VARCHAR(100),
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_individual_cux (cux_number),
        KEY idx_individual_short_name (short_name),
        KEY idx_individual_id_number (id_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await db.query(sql);
    console.log('Individual counterparty table created successfully');
  } catch (error) {
    console.error('Error creating individual counterparty table:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  createIndividualCounterpartyTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createIndividualCounterpartyTable;
