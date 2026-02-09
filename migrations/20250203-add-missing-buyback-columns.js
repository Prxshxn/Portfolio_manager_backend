const db = require('../config/db');
const mysql = require('mysql2/promise');

async function addMissingColumns() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'itms'
    });

    // Function to check if column exists
    async function columnExists(columnName) {
      const [rows] = await connection.query(
        `SELECT COUNT(*) as count 
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = ? 
         AND TABLE_NAME = 'buyback_deals' 
         AND COLUMN_NAME = ?`,
        [process.env.DB_NAME || 'itms', columnName]
      );
      return rows[0].count > 0;
    }

    // Function to add column if it doesn't exist
    async function addColumnIfNotExists(columnDef) {
      const columnName = columnDef.match(/ADD COLUMN\s+(\w+)/i)?.[1];
      if (!columnName) {
        console.log('Could not extract column name from:', columnDef);
        return;
      }
      
      if (await columnExists(columnName)) {
        console.log(`Column ${columnName} already exists, skipping...`);
        return;
      }

      try {
        await connection.query(`ALTER TABLE buyback_deals ${columnDef}`);
        console.log(`✓ Added column: ${columnName}`);
      } catch (error) {
        console.error(`✗ Error adding column ${columnName}:`, error.message);
      }
    }

    console.log('Adding missing columns to buyback_deals table...\n');

    // Leg 1 columns
    await addColumnIfNotExists("ADD COLUMN leg1_transaction_type ENUM('Buy', 'Sell') NOT NULL DEFAULT 'Buy' AFTER leg1_value_date");
    await addColumnIfNotExists("ADD COLUMN leg1_trade_type VARCHAR(20) DEFAULT 'BuyBack' AFTER leg1_transaction_type");
    await addColumnIfNotExists("ADD COLUMN leg1_counterparty VARCHAR(50) NOT NULL DEFAULT '' AFTER leg1_isin");
    await addColumnIfNotExists("ADD COLUMN leg1_portfolio VARCHAR(50) AFTER leg1_broker");
    await addColumnIfNotExists("ADD COLUMN leg1_strategy VARCHAR(50) AFTER leg1_portfolio");
    await addColumnIfNotExists("ADD COLUMN leg1_custodian VARCHAR(100) AFTER leg1_strategy");
    await addColumnIfNotExists("ADD COLUMN leg1_settlement_mode ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') DEFAULT 'RTGS' AFTER leg1_custodian");
    await addColumnIfNotExists("ADD COLUMN leg1_brokerage DECIMAL(8,4) DEFAULT 0.0000 AFTER leg1_settlement_mode");
    await addColumnIfNotExists("ADD COLUMN leg1_interest_rate DECIMAL(8,4) DEFAULT 0.0000 AFTER leg1_brokerage");
    await addColumnIfNotExists("ADD COLUMN leg1_yield_rate DECIMAL(10,6) NOT NULL DEFAULT 0.000000 AFTER leg1_face_value");
    await addColumnIfNotExists("ADD COLUMN leg1_accrued_interest DECIMAL(10,4) AFTER leg1_dirty_price");
    await addColumnIfNotExists("ADD COLUMN leg1_currency VARCHAR(3) DEFAULT 'LKR' AFTER leg1_accrued_interest");

    // Leg 2 columns
    await addColumnIfNotExists("ADD COLUMN leg2_transaction_type ENUM('Buy', 'Sell') NOT NULL DEFAULT 'Sell' AFTER leg2_value_date");
    await addColumnIfNotExists("ADD COLUMN leg2_trade_type VARCHAR(20) DEFAULT 'BuyBack' AFTER leg2_transaction_type");
    await addColumnIfNotExists("ADD COLUMN leg2_counterparty VARCHAR(50) NOT NULL DEFAULT '' AFTER leg2_isin");
    await addColumnIfNotExists("ADD COLUMN leg2_portfolio VARCHAR(50) AFTER leg2_broker");
    await addColumnIfNotExists("ADD COLUMN leg2_strategy VARCHAR(50) AFTER leg2_portfolio");
    await addColumnIfNotExists("ADD COLUMN leg2_custodian VARCHAR(100) AFTER leg2_strategy");
    await addColumnIfNotExists("ADD COLUMN leg2_settlement_mode ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') DEFAULT 'RTGS' AFTER leg2_custodian");
    await addColumnIfNotExists("ADD COLUMN leg2_yield_rate DECIMAL(10,6) NOT NULL DEFAULT 0.000000 AFTER leg2_face_value");
    await addColumnIfNotExists("ADD COLUMN leg2_accrued_interest DECIMAL(10,4) AFTER leg2_dirty_price");
    await addColumnIfNotExists("ADD COLUMN leg2_currency VARCHAR(3) DEFAULT 'LKR' AFTER leg2_accrued_interest");

    // ISIN metadata columns
    await addColumnIfNotExists("ADD COLUMN issue_date DATE AFTER coupon_date2");
    await addColumnIfNotExists("ADD COLUMN maturity_date DATE AFTER issue_date");
    await addColumnIfNotExists("ADD COLUMN coupon_rate DECIMAL(8,4) AFTER maturity_date");

    console.log('\n✓ Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the migration
if (require.main === module) {
  addMissingColumns()
    .then(() => {
      console.log('Migration script finished.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addMissingColumns;
