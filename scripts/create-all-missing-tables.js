const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

// Expected tables list (all tables that should exist)
const expectedTables = [
  'account_mappings',
  'account_types',
  'accounts',
  'authorizer_assignments',
  'balance_impact_log',
  'brokers',
  'buyback_deals',
  'cashflow_categories',
  'cashflow_projections',
  'cashflow_reconciliation',
  'cashflow_transactions',
  'chart_of_accounts',
  'counterparties',
  'counterparty_limits',
  'counterparty_master_corporate',
  'counterparty_master_individual',
  'counterparty_master_joint',
  'fixed_deposit_requests',
  'fund_centre_master',
  'gsec',
  'gsec_sell_deal',
  'gsec_sell_record',
  'holiday_calendar',
  'isin_coupon_schedule',
  'isin_master',
  'joint_counterparty_relationships',
  'ledger_entries',
  'mark_to_market',
  'maturity_processing_log',
  'money_market_deals',
  'payment_masters',
  'portfolio_master',
  'repo_deal_isins',
  'repo_deals',
  'securities',
  'settlement_accounts',
  'strategy_master',
  'system_day',
  'tbill',
  'transaction_types',
  'transactions',
  'users',
  'webhook_logs',
  'webhook_queue'
];

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'portfolio_manager',
  multipleStatements: true
};

// Table creation SQL statements
const tableDefinitions = {
  'authorizer_assignments': `
    CREATE TABLE IF NOT EXISTS authorizer_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      role VARCHAR(32) NOT NULL,
      allowed_pages JSON NOT NULL,
      per_deal_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
      per_day_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'balance_impact_log': `
    CREATE TABLE IF NOT EXISTS balance_impact_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      context VARCHAR(100),
      message TEXT,
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'brokers': `
    CREATE TABLE IF NOT EXISTS brokers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      broker_code VARCHAR(50) NOT NULL UNIQUE,
      broker_name VARCHAR(100) NOT NULL,
      building_number VARCHAR(50),
      street_name VARCHAR(100),
      street_name2 VARCHAR(100),
      city VARCHAR(100),
      province VARCHAR(100),
      zip_code VARCHAR(20),
      country VARCHAR(100),
      contact_name VARCHAR(100),
      contact_phone VARCHAR(30),
      contact_mobile VARCHAR(30),
      contact_fax VARCHAR(30),
      contact_email VARCHAR(100),
      broker_type VARCHAR(20),
      brokerage_method VARCHAR(20),
      brokerage_cal_method_id INT,
      brokerage_input_percentage DECIMAL(10, 4),
      brokerage_settlement_method_id INT,
      settlement_account_number VARCHAR(100),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_broker_code (broker_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'buyback_deals': `
    CREATE TABLE IF NOT EXISTS buyback_deals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_number VARCHAR(50) UNIQUE NOT NULL,
      leg1_isin VARCHAR(50) NOT NULL,
      leg1_trade_date DATE NOT NULL,
      leg1_value_date DATE NOT NULL,
      leg1_face_value DECIMAL(20,4) NOT NULL,
      leg1_clean_price DECIMAL(20,6) NOT NULL,
      leg1_dirty_price DECIMAL(20,6) NOT NULL,
      leg1_settlement_amount DECIMAL(20,4) NOT NULL,
      leg1_broker INT,
      leg2_isin VARCHAR(50) NOT NULL,
      leg2_trade_date DATE NOT NULL,
      leg2_value_date DATE NOT NULL,
      leg2_face_value DECIMAL(20,4) NOT NULL,
      leg2_clean_price DECIMAL(20,6) NOT NULL,
      leg2_dirty_price DECIMAL(20,6) NOT NULL,
      leg2_settlement_amount DECIMAL(20,4) NOT NULL,
      leg2_broker INT,
      coupon_date1 VARCHAR(5),
      coupon_date2 VARCHAR(5),
      deal_status ENUM('Draft', 'Pending_Verification', 'Verified', 'Pending_Final_Approval', 'Approved', 'Rejected', 'Settled') DEFAULT 'Draft',
      created_by INT,
      verified_by INT NULL,
      approved_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      verified_at TIMESTAMP NULL,
      approved_at TIMESTAMP NULL,
      notes TEXT,
      matured TINYINT(1) DEFAULT 0,
      source_buy_deal_number VARCHAR(50),
      INDEX idx_deal_number (deal_number),
      INDEX idx_status (deal_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'counterparties': `
    CREATE TABLE IF NOT EXISTS counterparties (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(50),
      contact_info VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'gsec': `
    CREATE TABLE IF NOT EXISTS gsec (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_number VARCHAR(50) UNIQUE NOT NULL,
      transaction_type ENUM('Buy', 'Sell') NOT NULL,
      counterparty_id INT NOT NULL,
      isin_number VARCHAR(50) NOT NULL,
      face_value DECIMAL(20,4) NOT NULL,
      value_date DATE NOT NULL,
      next_coupon_date DATE,
      last_coupon_date DATE,
      number_of_days_interest_accrued INT,
      number_of_days_for_coupon_period INT,
      accrued_interest DECIMAL(20,6),
      accrued_interest_base DECIMAL(20,6),
      coupon_interest DECIMAL(20,6),
      clean_price DECIMAL(20,6),
      dirty_price DECIMAL(20,6),
      coupon_date_1 DATE,
      coupon_date_2 DATE,
      issue_date DATE,
      maturity_date DATE,
      coupon_rate DECIMAL(10,4),
      yield_rate DECIMAL(10,4),
      clean_price_base DECIMAL(20,6),
      accrued_interest_calculation VARCHAR(50),
      broker_id INT,
      accrued_interest_six_decimals DECIMAL(20,6),
      accrued_interest_for_100 DECIMAL(20,6),
      settlement_amount DECIMAL(20,4),
      settlement_mode VARCHAR(50),
      coupon_dates TEXT,
      yield DECIMAL(10,4),
      brokerage DECIMAL(20,6),
      currency VARCHAR(10) DEFAULT 'LKR',
      portfolio VARCHAR(255),
      strategy VARCHAR(255),
      broker VARCHAR(255),
      accrued_interest_adjustment DECIMAL(20,6) DEFAULT 0,
      clean_price_adjustment DECIMAL(20,6) DEFAULT 0,
      trade_date DATE,
      buy_deal_number VARCHAR(50),
      matured TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_deal_number (deal_number),
      INDEX idx_isin (isin_number),
      INDEX idx_counterparty (counterparty_id),
      INDEX idx_value_date (value_date),
      INDEX idx_maturity_date (maturity_date),
      INDEX idx_buy_deal_number (buy_deal_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'gsec_sell_deal': `
    CREATE TABLE IF NOT EXISTS gsec_sell_deal (
      id INT AUTO_INCREMENT PRIMARY KEY,
      buy_deal_number VARCHAR(64),
      sell_deal_number VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_buy_deal (buy_deal_number),
      INDEX idx_sell_deal (sell_deal_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'gsec_sell_record': `
    CREATE TABLE IF NOT EXISTS gsec_sell_record (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_number VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_deal_number (deal_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'isin_coupon_schedule': `
    CREATE TABLE IF NOT EXISTS isin_coupon_schedule (
      id INT AUTO_INCREMENT PRIMARY KEY,
      isin VARCHAR(20) NOT NULL,
      coupon_number INT NOT NULL,
      coupon_date DATE NOT NULL,
      coupon_amount DECIMAL(10,4) NOT NULL,
      principal DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
      INDEX idx_isin (isin),
      INDEX idx_coupon_date (coupon_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'isin_master': `
    CREATE TABLE IF NOT EXISTS isin_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      isin_issuer VARCHAR(255) NOT NULL,
      isin_number VARCHAR(50) NOT NULL,
      issue_date DATE NOT NULL,
      maturity_date DATE NOT NULL,
      coupon_rate DECIMAL(10, 4) NOT NULL,
      series VARCHAR(50),
      coupon_date_1 DATE NOT NULL,
      coupon_date_2 DATE NOT NULL,
      day_basis INT NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'LKR',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isin_number (isin_number),
      INDEX idx_issue_date (issue_date),
      INDEX idx_maturity_date (maturity_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'joint_counterparty_relationships': `
    CREATE TABLE IF NOT EXISTS joint_counterparty_relationships (
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
      UNIQUE KEY unique_joint_counterparty_sequence (joint_counterparty_id, sequence_number),
      INDEX idx_joint_counterparty (joint_counterparty_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'mark_to_market': `
    CREATE TABLE IF NOT EXISTS mark_to_market (
      id INT AUTO_INCREMENT PRIMARY KEY,
      series VARCHAR(50) NOT NULL,
      isin_number VARCHAR(50) NOT NULL,
      isin_issuer VARCHAR(255),
      maturity_date DATE,
      buying_price DECIMAL(10, 4),
      selling_price DECIMAL(10, 4),
      average_price DECIMAL(10, 4),
      buying_yield DECIMAL(10, 4),
      selling_yield DECIMAL(10, 4),
      average_yield DECIMAL(10, 4),
      dirty_price DECIMAL(10, 4),
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      excel_source VARCHAR(255),
      upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_series (series),
      INDEX idx_isin (isin_number),
      INDEX idx_last_updated (last_updated),
      UNIQUE KEY unique_series_isin (series, isin_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'maturity_processing_log': `
    CREATE TABLE IF NOT EXISTS maturity_processing_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_type VARCHAR(50) NOT NULL,
      deal_id INT NOT NULL,
      deal_number VARCHAR(100),
      maturity_date DATE NOT NULL,
      principal_amount DECIMAL(20,4) NOT NULL,
      interest_amount DECIMAL(20,4) DEFAULT 0,
      total_amount DECIMAL(20,4) NOT NULL,
      processing_status ENUM('Pending', 'Processed', 'Failed', 'Skipped') DEFAULT 'Pending',
      processed_at TIMESTAMP NULL,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_deal_type (deal_type),
      INDEX idx_deal_id (deal_id),
      INDEX idx_maturity_date (maturity_date),
      INDEX idx_status (processing_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'money_market_deals': `
    CREATE TABLE IF NOT EXISTS money_market_deals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deal_number VARCHAR(32) NOT NULL UNIQUE,
      trade_date DATE NOT NULL,
      value_date DATE NOT NULL,
      maturity_date DATE NOT NULL,
      counterparty_id INT NOT NULL,
      product_type VARCHAR(32) NOT NULL,
      currency VARCHAR(8) NOT NULL,
      principal_amount DECIMAL(18,4) NOT NULL,
      interest_rate DECIMAL(8,4) NOT NULL,
      tenor INT NOT NULL,
      interest_amount DECIMAL(18,4) NOT NULL,
      maturity_value DECIMAL(18,4) NOT NULL,
      settlement_mode VARCHAR(32),
      remarks VARCHAR(255),
      deal_type VARCHAR(32),
      created_by INT,
      status VARCHAR(20) DEFAULT 'pending',
      comment TEXT,
      current_approval_level VARCHAR(50) DEFAULT 'front_office',
      authorized_by INT,
      authorized_at DATETIME,
      matured TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_mm_deal_number (deal_number),
      KEY idx_mm_trade_date (trade_date),
      KEY idx_mm_maturity_date (maturity_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'payment_masters': `
    CREATE TABLE IF NOT EXISTS payment_masters (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_method VARCHAR(100) NOT NULL,
      payment_method_owner VARCHAR(100) NOT NULL,
      payment_method_code VARCHAR(50) NOT NULL,
      bank_payment_code VARCHAR(50) NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_payment_code (payment_method_code),
      KEY idx_payment_method (payment_method),
      KEY idx_bank_payment_code (bank_payment_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'portfolio_master': `
    CREATE TABLE IF NOT EXISTS portfolio_master (
      portfolio_id VARCHAR(50) PRIMARY KEY,
      portfolio_name VARCHAR(255) NOT NULL,
      portfolio_type VARCHAR(100),
      entity_business_unit VARCHAR(100),
      fund_manager_user_id VARCHAR(100),
      base_currency VARCHAR(20),
      benchmark VARCHAR(255),
      start_date DATE,
      end_date DATE,
      status VARCHAR(32) DEFAULT 'Active',
      risk_profile VARCHAR(50),
      investment_horizon VARCHAR(50),
      target_yield_return DECIMAL(8,4),
      compliance_rules_id VARCHAR(100),
      notes_description TEXT,
      parent_portfolio_id VARCHAR(50),
      valuation_method VARCHAR(50),
      accounting_treatment VARCHAR(50),
      rebalancing_frequency VARCHAR(50),
      external_reference_code VARCHAR(100),
      tags_categories VARCHAR(255),
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_portfolio_parent (parent_portfolio_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'securities': `
    CREATE TABLE IF NOT EXISTS securities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(50),
      description VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_name (name),
      INDEX idx_type (type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'settlement_accounts': `
    CREATE TABLE IF NOT EXISTS settlement_accounts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      bank_name VARCHAR(100) NOT NULL,
      bank_payment_code VARCHAR(50),
      bank_code VARCHAR(50),
      address_building_number VARCHAR(30),
      address_street_name VARCHAR(100),
      address_street_name2 VARCHAR(100),
      address_city VARCHAR(50),
      address_province VARCHAR(50),
      address_zip_code VARCHAR(20),
      address_country VARCHAR(50),
      contact_name VARCHAR(100),
      contact_phone VARCHAR(30),
      contact_mobile VARCHAR(30),
      contact_fax VARCHAR(30),
      contact_email VARCHAR(100),
      account_type VARCHAR(30),
      bank_account_number VARCHAR(50),
      bank_branch VARCHAR(100),
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_bank_payment_code (bank_payment_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'strategy_master': `
    CREATE TABLE IF NOT EXISTS strategy_master (
      strategy_id VARCHAR(64) PRIMARY KEY,
      portfolio_name VARCHAR(128) NOT NULL,
      strategy_type VARCHAR(64),
      entity_business_unit VARCHAR(64),
      INDEX idx_portfolio_name (portfolio_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'system_day': `
    CREATE TABLE IF NOT EXISTS system_day (
      id INT AUTO_INCREMENT PRIMARY KEY,
      system_date DATE NOT NULL,
      last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_system_date (system_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'tbill': `
    CREATE TABLE IF NOT EXISTS tbill (
      id INT AUTO_INCREMENT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'transaction_types': `
    CREATE TABLE IF NOT EXISTS transaction_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255),
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'webhook_logs': `
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      webhook_url VARCHAR(500) NOT NULL,
      payload JSON,
      response_status INT,
      response_body TEXT,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  'webhook_queue': `
    CREATE TABLE IF NOT EXISTS webhook_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      webhook_url VARCHAR(500) NOT NULL,
      payload JSON NOT NULL,
      retry_count INT DEFAULT 0,
      status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP NULL,
      INDEX idx_status (status),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `
};

async function createAllMissingTables() {
  let connection;
  
  try {
    console.log('🚀 Creating all missing tables...\n');
    console.log(`📊 Database: ${dbConfig.database}`);
    console.log(`🔗 Host: ${dbConfig.host}:${dbConfig.port}\n`);
    
    // Create connection
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ Connected to database\n');
    
    // Ensure database exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    await connection.query(`USE ${dbConfig.database}`);
    
    // Get existing tables
    const [tables] = await connection.query('SHOW TABLES');
    const existingTables = tables.map(t => Object.values(t)[0]);
    console.log(`📋 Found ${existingTables.length} existing tables\n`);
    
    // Find missing tables
    const missingTables = expectedTables.filter(table => !existingTables.includes(table));
    
    if (missingTables.length === 0) {
      console.log('✅ All tables already exist!\n');
      return;
    }
    
    console.log(`📊 Missing tables: ${missingTables.length}\n`);
    console.log('Creating missing tables...\n');
    
    let created = 0;
    let skipped = 0;
    
    // Create missing tables
    for (const tableName of missingTables) {
      if (tableDefinitions[tableName]) {
        try {
          await connection.query(tableDefinitions[tableName]);
          console.log(`✓ Created: ${tableName}`);
          created++;
        } catch (error) {
          if (error.code === 'ER_TABLE_EXISTS_ERROR') {
            console.log(`⏭  Skipped: ${tableName} (already exists)`);
            skipped++;
          } else {
            console.error(`✗ Failed: ${tableName} - ${error.message}`);
            throw error;
          }
        }
      } else {
        console.log(`⚠  No definition found for: ${tableName}`);
      }
    }
    
    // Verify tables were created
    const [finalTables] = await connection.query('SHOW TABLES');
    const finalTableCount = finalTables.length;
    
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Missing definitions: ${missingTables.length - created - skipped}`);
    console.log(`   Total tables now: ${finalTableCount}`);
    console.log(`   Expected tables: ${expectedTables.length}`);
    console.log('='.repeat(50) + '\n');
    
    if (finalTableCount >= expectedTables.length) {
      console.log('✅ All expected tables are now present!\n');
    } else {
      const stillMissing = expectedTables.filter(t => !finalTables.map(ft => Object.values(ft)[0]).includes(t));
      console.log(`⚠️  Still missing ${stillMissing.length} tables:`);
      stillMissing.forEach(t => console.log(`   - ${t}`));
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed\n');
    }
  }
}

// Run the script
if (require.main === module) {
  createAllMissingTables().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { createAllMissingTables };
