-- Create isin_master table
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
