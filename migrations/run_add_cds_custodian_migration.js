const db = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Adding CDS Account and Custodian Bank columns to joint_counterparty_relationships...');
    
    // Check if table exists
    const [tables] = await db.query("SHOW TABLES LIKE 'joint_counterparty_relationships'");
    if (tables.length === 0) {
      console.log('⚠ Table does not exist. Please run the main migration first.');
      process.exit(1);
    }
    
    // Check if columns already exist
    const [columns] = await db.query('DESCRIBE joint_counterparty_relationships');
    const hasCdsAccount = columns.some(col => col.Field === 'cds_account');
    const hasCustodianBank = columns.some(col => col.Field === 'custodian_bank');
    
    if (hasCdsAccount && hasCustodianBank) {
      console.log('✓ Columns already exist');
      process.exit(0);
    }
    
    // Add columns if they don't exist
    if (!hasCdsAccount) {
      await db.query('ALTER TABLE joint_counterparty_relationships ADD COLUMN cds_account VARCHAR(255) AFTER mobile');
      console.log('✓ Added cds_account column');
    }
    
    if (!hasCustodianBank) {
      await db.query('ALTER TABLE joint_counterparty_relationships ADD COLUMN custodian_bank VARCHAR(255) AFTER cds_account');
      console.log('✓ Added custodian_bank column');
    }
    
    console.log('✓ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    // If column already exists, that's okay
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ Column already exists. This is okay.');
      process.exit(0);
    } else {
      console.error('Full error:', error);
      process.exit(1);
    }
  }
}

runMigration();

