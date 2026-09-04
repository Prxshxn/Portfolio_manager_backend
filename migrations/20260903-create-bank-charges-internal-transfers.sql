-- Bank charges table
CREATE TABLE IF NOT EXISTS bank_charges (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  entry_date    DATE         NOT NULL,
  bank_name     VARCHAR(200) NOT NULL,
  description   VARCHAR(500) NOT NULL,
  amount        DECIMAL(18,2) NOT NULL,
  charge_type   VARCHAR(100) DEFAULT NULL,   -- e.g. 'RTGS Fee', 'Swift Fee', 'Service Charge'
  reference_no  VARCHAR(100) DEFAULT NULL,
  account_code  VARCHAR(50)  DEFAULT NULL,   -- GL account code
  created_by    VARCHAR(100) DEFAULT NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Internal transfers table
CREATE TABLE IF NOT EXISTS internal_transfers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  transfer_date   DATE         NOT NULL,
  from_account    VARCHAR(200) NOT NULL,
  to_account      VARCHAR(200) NOT NULL,
  amount          DECIMAL(18,2) NOT NULL,
  description     VARCHAR(500) NOT NULL,
  reference_no    VARCHAR(100) DEFAULT NULL,
  transfer_type   VARCHAR(100) DEFAULT NULL,  -- e.g. 'FMC', 'CBSL', 'BOC', 'NSB'
  created_by      VARCHAR(100) DEFAULT NULL,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
