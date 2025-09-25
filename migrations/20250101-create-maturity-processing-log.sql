-- Create maturity processing log table for authorization tracking
CREATE TABLE IF NOT EXISTS maturity_processing_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  deal_id INT NOT NULL,
  deal_number VARCHAR(50) NOT NULL,
  maturity_action VARCHAR(100) NOT NULL,
  principal_amount DECIMAL(15,2) NOT NULL,
  interest_amount DECIMAL(15,2) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  processed_date DATE NOT NULL,
  processed_by INT NOT NULL,
  authorization_level VARCHAR(20) NOT NULL,
  bank_account_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_processed_by (processed_by),
  INDEX idx_processed_date (processed_date),
  INDEX idx_deal_id (deal_id),
  INDEX idx_authorization_level (authorization_level)
);

-- Add foreign key constraints if the tables exist
-- ALTER TABLE maturity_processing_log 
-- ADD CONSTRAINT fk_maturity_log_processed_by 
-- FOREIGN KEY (processed_by) REFERENCES users(id);

-- ALTER TABLE maturity_processing_log 
-- ADD CONSTRAINT fk_maturity_log_bank_account 
-- FOREIGN KEY (bank_account_id) REFERENCES chart_of_accounts(id);
