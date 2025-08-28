-- Create buyback deals table
CREATE TABLE IF NOT EXISTS buyback_deals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  deal_number VARCHAR(50) UNIQUE,
  
  -- Leg 1 data
  leg1_trade_date DATE NOT NULL,
  leg1_value_date DATE NOT NULL,
  leg1_transaction_type ENUM('Buy', 'Sell') NOT NULL,
  leg1_trade_type VARCHAR(20) DEFAULT 'BuyBack',
  leg1_isin VARCHAR(20) NOT NULL,
  leg1_counterparty VARCHAR(50) NOT NULL,
  leg1_broker INT,
  leg1_portfolio VARCHAR(50),
  leg1_strategy VARCHAR(50),
  leg1_custodian VARCHAR(100),
  leg1_settlement_mode ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') DEFAULT 'RTGS',
  leg1_brokerage DECIMAL(8,4) DEFAULT 0.0000,
  leg1_interest_rate DECIMAL(8,4) DEFAULT 0.0000,
  leg1_face_value DECIMAL(18,2) NOT NULL,
  leg1_yield_rate DECIMAL(10,6) NOT NULL,
  leg1_settlement_amount DECIMAL(18,2) NOT NULL,
  leg1_clean_price DECIMAL(10,4),
  leg1_dirty_price DECIMAL(10,4),
  leg1_accrued_interest DECIMAL(10,4),
  leg1_currency VARCHAR(3) DEFAULT 'LKR',
  
  -- Leg 2 data
  leg2_trade_date DATE NOT NULL,
  leg2_value_date DATE NOT NULL,
  leg2_transaction_type ENUM('Buy', 'Sell') NOT NULL,
  leg2_trade_type VARCHAR(20) DEFAULT 'BuyBack',
  leg2_isin VARCHAR(20) NOT NULL,
  leg2_counterparty VARCHAR(50) NOT NULL,
  leg2_portfolio VARCHAR(50),
  leg2_strategy VARCHAR(50),
  leg2_custodian VARCHAR(100),
  leg2_settlement_mode ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') DEFAULT 'RTGS',
  leg2_face_value DECIMAL(18,2) NOT NULL,
  leg2_yield_rate DECIMAL(10,6) NOT NULL,
  leg2_settlement_amount DECIMAL(18,2) NOT NULL,
  leg2_clean_price DECIMAL(10,4),
  leg2_dirty_price DECIMAL(10,4),
  leg2_accrued_interest DECIMAL(10,4),
  leg2_currency VARCHAR(3) DEFAULT 'LKR',
  
  -- ISIN metadata (copied for reference)
  issue_date DATE,
  maturity_date DATE,
  coupon_rate DECIMAL(8,4),
  coupon_date1 VARCHAR(5), -- MM-DD format
  coupon_date2 VARCHAR(5), -- MM-DD format
  
  -- Deal status and tracking
  deal_status ENUM('Draft', 'Pending_Verification', 'Verified', 'Pending_Final_Approval', 'Approved', 'Rejected', 'Settled') DEFAULT 'Draft',
  created_by INT,
  verified_by INT NULL,
  approved_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  verified_at TIMESTAMP NULL,
  approved_at TIMESTAMP NULL,
  
  -- Additional metadata
  notes TEXT,
  
  -- Foreign key constraints
  FOREIGN KEY (leg1_broker) REFERENCES brokers(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  
  -- Indexes for performance
  INDEX idx_deal_number (deal_number),
  INDEX idx_isin (leg1_isin, leg2_isin),
  INDEX idx_trade_dates (leg1_trade_date, leg2_trade_date),
  INDEX idx_status (deal_status),
  INDEX idx_created_at (created_at)
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
