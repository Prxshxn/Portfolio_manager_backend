const db = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Running joint_counterparty_relationships table migration...');
    
    // Drop the old table if it exists
    try {
      await db.query('DROP TABLE IF EXISTS joint_counterparty_relationships');
      console.log('✓ Dropped existing table (if any)');
    } catch (error) {
      console.log('ℹ No existing table to drop');
    }
    
    // Create the new table
    const createTableSql = `CREATE TABLE IF NOT EXISTS joint_counterparty_relationships (
      id INT AUTO_INCREMENT PRIMARY KEY,
      joint_counterparty_id INT NOT NULL,
      sequence_number INT NOT NULL DEFAULT 1,
      title VARCHAR(10),
      short_name VARCHAR(255) NOT NULL,
      long_name VARCHAR(255) NOT NULL,
      id_type VARCHAR(50) NOT NULL,
      id_number VARCHAR(255),
      house_number VARCHAR(100),
      street_name VARCHAR(255),
      province VARCHAR(100),
      postal_code VARCHAR(20),
      city VARCHAR(100),
      country VARCHAR(100),
      telephone VARCHAR(50),
      email VARCHAR(255),
      mobile VARCHAR(50),
      cds_account VARCHAR(255),
      custodian_bank VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (joint_counterparty_id) REFERENCES counterparty_master_joint(id) ON DELETE CASCADE,
      UNIQUE KEY unique_joint_counterparty_sequence (joint_counterparty_id, sequence_number),
      INDEX idx_joint_counterparty (joint_counterparty_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    
    await db.query(createTableSql);
    
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

