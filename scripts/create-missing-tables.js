const db = require('../config/database');

async function createTables() {
  try {
    console.log('=== Creating missing core tables if they do not exist ===');

    // 1) authorizer_assignments (from 20250620-create-authorizer-assignments-table.sql)
    await db.query(`
      CREATE TABLE IF NOT EXISTS authorizer_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        role VARCHAR(32) NOT NULL,
        allowed_pages JSON NOT NULL,
        per_deal_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
        per_day_limit DECIMAL(20,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('authorizer_assignments OK');

    // 2) counterparties (legacy simple table – used only in some maturity reports)
    await db.query(`
      CREATE TABLE IF NOT EXISTS counterparties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50),
        contact_info VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('counterparties OK');

    // 3) counterparty_limits (schema from Prisma)
    await db.query(`
      CREATE TABLE IF NOT EXISTS counterparty_limits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        counterparty_id INT NOT NULL,
        counterparty_type VARCHAR(32) NOT NULL,
        overall_exposure_limit DECIMAL(18,2) NULL,
        currency_limit VARCHAR(10) NULL,
        product_money_market_limit DECIMAL(18,2) NULL,
        product_fx_limit DECIMAL(18,2) NULL,
        product_derivative_limit DECIMAL(18,2) NULL,
        product_repo_limit DECIMAL(18,2) NULL,
        product_reverse_repo_limit DECIMAL(18,2) NULL,
        product_gsec_limit DECIMAL(18,2) NULL,
        product_sell_and_buy_back_limit DECIMAL(18,2) NULL,
        product_buy_and_sell_back_limit DECIMAL(18,2) NULL,
        tenor_limit DECIMAL(18,2) NULL,
        settlement_risk_limit DECIMAL(18,2) NULL,
        country_limit DECIMAL(18,2) NULL,
        group_limit DECIMAL(18,2) NULL,
        intraday_limit DECIMAL(18,2) NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        product_transaction_limit DECIMAL(15,2) NULL DEFAULT 0.00,
        currency VARCHAR(10) NULL DEFAULT 'LKR'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('counterparty_limits OK');

    // 4) counterparty_master_individual (schema based on model + Prisma)
    await db.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('counterparty_master_individual OK');

    // 5) money_market_deals (schema aligned with routes/moneyMarketDeals.js)
    await db.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('money_market_deals OK');

    // 6) payment_masters (from paymentMasterController)
    await db.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('payment_masters OK');

    // 7) portfolio_master (schema from Prisma)
    await db.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('portfolio_master OK');

    // 8) settlement_accounts (schema from Prisma + model)
    await db.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('settlement_accounts OK');

    // 9) strategy_master (from models/strategy_master.sql)
    await db.query(`
      CREATE TABLE IF NOT EXISTS strategy_master (
        strategy_id VARCHAR(64) PRIMARY KEY,
        portfolio_name VARCHAR(128) NOT NULL,
        strategy_type VARCHAR(64),
        entity_business_unit VARCHAR(64)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('strategy_master OK');

    // 10) system_day (simple master table)
    await db.query(`
      CREATE TABLE IF NOT EXISTS system_day (
        id INT AUTO_INCREMENT PRIMARY KEY,
        system_date DATE NOT NULL,
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('system_day OK');

    // 11) transaction_types (simplified schema compatible with TransactionTypeModel)
    await db.query(`
      CREATE TABLE IF NOT EXISTS transaction_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255),
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('transaction_types OK');

    // 12) isin_coupon_schedule (from Prisma / model)
    await db.query(`
      CREATE TABLE IF NOT EXISTS isin_coupon_schedule (
        id INT AUTO_INCREMENT PRIMARY KEY,
        isin VARCHAR(20) NOT NULL,
        coupon_number INT NOT NULL,
        coupon_date DATE NOT NULL,
        coupon_amount DECIMAL(10,4) NOT NULL,
        principal DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
        KEY idx_isin (isin)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('isin_coupon_schedule OK');

    // 13) Optional / low-impact tables – create very simple shells so code never fails

    // balance_impact_log (generic audit log, not currently used by code)
    await db.query(`
      CREATE TABLE IF NOT EXISTS balance_impact_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        context VARCHAR(100),
        message TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('balance_impact_log OK');

    // gsec_sell_deal (legacy; keep minimal structure in case any ad‑hoc queries rely on it)
    await db.query(`
      CREATE TABLE IF NOT EXISTS gsec_sell_deal (
        id INT AUTO_INCREMENT PRIMARY KEY,
        buy_deal_number VARCHAR(64),
        sell_deal_number VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('gsec_sell_deal OK');

    // gsec_sell_record (legacy; minimal shell)
    await db.query(`
      CREATE TABLE IF NOT EXISTS gsec_sell_record (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_number VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('gsec_sell_record OK');

    // tbill (not referenced in current code – create minimal placeholder)
    await db.query(`
      CREATE TABLE IF NOT EXISTS tbill (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('tbill OK');

    console.log('=== All missing tables created (if they were absent) ===');
  } catch (err) {
    console.error('Error while creating missing tables:', err);
  } finally {
    process.exit();
  }
}

createTables();

