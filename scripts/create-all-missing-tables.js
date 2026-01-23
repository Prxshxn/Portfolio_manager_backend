const db = require('../config/database');

async function createAllMissingTables() {
  try {
    console.log('\n=== Creating All Missing Tables ===\n');

    // 1. Ensure chart_of_accounts has index on account_code for foreign key
    console.log('Ensuring chart_of_accounts index...');
    try {
      const [indexes] = await db.query(`SHOW INDEXES FROM chart_of_accounts WHERE Column_name = 'account_code'`);
      if (indexes.length === 0) {
        await db.query(`CREATE INDEX idx_account_code ON chart_of_accounts(account_code)`);
        console.log('  ✓ Index created');
      } else {
        console.log('  ✓ Index already exists');
      }
    } catch (e) {
      console.log('  ⚠️  Index check: ' + e.message);
    }

    // 2. Create account_mappings table
    console.log('Creating account_mappings...');
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS account_mappings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          mapping_key VARCHAR(100) NOT NULL UNIQUE,
          account_code VARCHAR(20) NOT NULL,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_mapping_key (mapping_key),
          INDEX idx_account_code (account_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);
      
      // Add foreign key separately if chart_of_accounts exists
      try {
        await db.query(`
          ALTER TABLE account_mappings 
          ADD CONSTRAINT fk_account_mappings_account_code 
          FOREIGN KEY (account_code) REFERENCES chart_of_accounts(account_code) 
          ON DELETE RESTRICT ON UPDATE CASCADE
        `);
      } catch (fkError) {
        // Foreign key might already exist or chart_of_accounts might be empty
        console.log('  (Foreign key constraint skipped - may already exist or chart_of_accounts is empty)');
      }
      console.log('✓ account_mappings created');
    } catch (error) {
      console.log(`  ⚠️  account_mappings: ${error.message}`);
    }

    // 3. Create accounts table
    console.log('Creating accounts...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        account_number VARCHAR(50) UNIQUE,
        balance DECIMAL(15, 2) DEFAULT 0.00,
        currency VARCHAR(10) DEFAULT 'LKR',
        account_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ accounts created');

    // 4. Create fixed_deposit_requests table
    console.log('Creating fixed_deposit_requests...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS fixed_deposit_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        portfolio_id VARCHAR(50),
        book VARCHAR(100),
        module VARCHAR(100) DEFAULT 'Pre approval',
        request_no VARCHAR(50) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'Draft',
        counterparty_type VARCHAR(50) DEFAULT 'Bank',
        counterparty_id INT,
        contact_person VARCHAR(255),
        request_remarks TEXT,
        instrument_type VARCHAR(100),
        isin VARCHAR(50),
        currency VARCHAR(10) DEFAULT 'LKR',
        requested_amount DECIMAL(20, 2),
        target_yield DECIMAL(10, 4),
        value_date DATE,
        maturity_date DATE,
        approval_category VARCHAR(100),
        approval_limit_required VARCHAR(255),
        approver_notes TEXT,
        approval_history TEXT,
        submitted_by INT,
        approved_by INT,
        rejected_by INT,
        submitted_at TIMESTAMP NULL,
        approved_at TIMESTAMP NULL,
        rejected_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_request_no (request_no),
        INDEX idx_counterparty_id (counterparty_id),
        INDEX idx_portfolio_id (portfolio_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('✓ fixed_deposit_requests created');

    // 5. Create fund_centre_master table
    console.log('Creating fund_centre_master...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS fund_centre_master (
        id INT NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        fund_centre_code VARCHAR(50) NOT NULL,
        country VARCHAR(100) NOT NULL,
        gmt_timezone VARCHAR(50) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY unique_fund_centre_code (fund_centre_code),
        KEY idx_fund_centre_code (fund_centre_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ fund_centre_master created');

    // 6. Create holiday_calendar table
    console.log('Creating holiday_calendar...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS holiday_calendar (
        id INT(11) NOT NULL AUTO_INCREMENT,
        holiday_date DATE NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY unique_holiday_date (holiday_date),
        KEY idx_holiday_date (holiday_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ holiday_calendar created');

    // 7. Create joint_counterparty_relationships table
    console.log('Creating joint_counterparty_relationships...');
    try {
      await db.query(`
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_joint_counterparty_sequence (joint_counterparty_id, sequence_number),
          INDEX idx_joint_counterparty (joint_counterparty_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      
      // Add foreign key separately
      try {
        await db.query(`
          ALTER TABLE joint_counterparty_relationships 
          ADD CONSTRAINT fk_joint_counterparty_relationships_joint_id 
          FOREIGN KEY (joint_counterparty_id) REFERENCES counterparty_master_joint(id) ON DELETE CASCADE
        `);
      } catch (fkError) {
        console.log('  (FK skipped)');
      }
      
      console.log('✓ joint_counterparty_relationships created');
    } catch (error) {
      console.log(`  ⚠️  joint_counterparty_relationships: ${error.message}`);
    }

    // 8. Create ledger_entries table (after transactions)
    console.log('Creating ledger_entries...');
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ledger_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          transaction_id INT,
          deal_number VARCHAR(100),
          account_id INT NOT NULL,
          entry_date DATE NOT NULL,
          debit_amount DECIMAL(15, 2) DEFAULT 0.00,
          credit_amount DECIMAL(15, 2) DEFAULT 0.00,
          currency VARCHAR(10) DEFAULT 'LKR',
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_transaction_id (transaction_id),
          INDEX idx_account_id (account_id),
          INDEX idx_deal_number (deal_number),
          INDEX idx_entry_date (entry_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      
      // Add foreign keys separately if parent tables exist
      try {
        await db.query(`
          ALTER TABLE ledger_entries 
          ADD CONSTRAINT fk_ledger_entries_transaction_id 
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
        `);
      } catch (fkError) {
        console.log('  (transaction_id FK skipped)');
      }
      
      try {
        await db.query(`
          ALTER TABLE ledger_entries 
          ADD CONSTRAINT fk_ledger_entries_account_id 
          FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
        `);
      } catch (fkError) {
        console.log('  (account_id FK skipped)');
      }
      
      console.log('✓ ledger_entries created');
    } catch (error) {
      console.log(`  ⚠️  ledger_entries: ${error.message}`);
    }

    // 9. Create repo_deal_isins table
    console.log('Creating repo_deal_isins...');
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS repo_deal_isins (
          id INT AUTO_INCREMENT PRIMARY KEY,
          repo_deal_id INT NOT NULL,
          isin_number VARCHAR(32) NOT NULL,
          face_value DECIMAL(18,6) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_repo_deal_id (repo_deal_id),
          INDEX idx_isin_number (isin_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      
      // Add foreign key separately if repo_deals exists
      try {
        await db.query(`
          ALTER TABLE repo_deal_isins 
          ADD CONSTRAINT fk_repo_deal_isins_repo_deal_id 
          FOREIGN KEY (repo_deal_id) REFERENCES repo_deals(id) ON DELETE CASCADE
        `);
      } catch (fkError) {
        console.log('  (FK skipped - repo_deals may not exist yet)');
      }
      
      console.log('✓ repo_deal_isins created');
    } catch (error) {
      console.log(`  ⚠️  repo_deal_isins: ${error.message}`);
    }

    // 10. Create securities table
    console.log('Creating securities...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS securities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50),
        description VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ securities created');

    // 11. Create transactions table
    console.log('Creating transactions...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deal_number VARCHAR(100) UNIQUE,
        date DATE NOT NULL,
        trade_date DATE,
        value_date DATE,
        source_account_id INT,
        category VARCHAR(100),
        security_id INT,
        amount DECIMAL(15, 2) NOT NULL,
        interest_rate DECIMAL(10, 4),
        counterparty_id VARCHAR(100),
        transaction_type_id INT,
        settlement_mode VARCHAR(50),
        price DECIMAL(15, 4),
        yield DECIMAL(10, 4),
        description TEXT,
        portfolio VARCHAR(50),
        strategy VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'LKR',
        transaction_code VARCHAR(50),
        commission DECIMAL(15, 2),
        brokerage DECIMAL(15, 2),
        remarks TEXT,
        user VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        comment TEXT,
        approval_status VARCHAR(20),
        current_approval_level VARCHAR(50),
        submitted_by INT,
        approval_chain TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_deal_number (deal_number),
        INDEX idx_date (date),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ transactions created');

    // 12. Create webhook_logs table
    console.log('Creating webhook_logs...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        payload TEXT NOT NULL,
        response_status INT,
        response_body TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_event_type (event_type),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ webhook_logs created');

    // 13. Create webhook_queue table
    console.log('Creating webhook_queue...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS webhook_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        payload TEXT NOT NULL,
        retry_count INT DEFAULT 0,
        max_retries INT DEFAULT 3,
        status ENUM('pending', 'processing', 'failed', 'completed') DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        next_retry_at TIMESTAMP NULL,
        INDEX idx_status (status),
        INDEX idx_next_retry_at (next_retry_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ webhook_queue created');

    console.log('\n=== All Missing Tables Created Successfully ===\n');
    
  } catch (error) {
    console.error('\n❌ Error creating tables:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  createAllMissingTables()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = createAllMissingTables;
