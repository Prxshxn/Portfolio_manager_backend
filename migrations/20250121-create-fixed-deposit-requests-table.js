const db = require('../config/db');

async function createFixedDepositRequestsTable() {
  try {
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
        
        approver_id INT,
        approver_name VARCHAR(255),
        approver_designation VARCHAR(255),
        approval_category VARCHAR(100),
        approval_limit_required VARCHAR(255),
        approver_notes TEXT,
        
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
        INDEX idx_portfolio_id (portfolio_id),
        INDEX idx_submitted_by (submitted_by),
        INDEX idx_approver_id (approver_id),
        INDEX idx_created_at (created_at)
        
        -- Foreign keys removed to avoid type mismatch issues
        -- Can be added later after verifying table structures
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    
    console.log('Fixed deposit requests table created successfully');
  } catch (error) {
    console.error('Error creating fixed deposit requests table:', error);
    throw error;
  }
}

if (require.main === module) {
  createFixedDepositRequestsTable()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = createFixedDepositRequestsTable;
