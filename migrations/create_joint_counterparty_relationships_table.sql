-- Create table without foreign key first (FK will be added later if parent table exists)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add foreign key constraint separately (will be deferred if parent table doesn't exist)
ALTER TABLE joint_counterparty_relationships 
ADD CONSTRAINT fk_joint_counterparty_relationships_joint_id 
FOREIGN KEY (joint_counterparty_id) REFERENCES counterparty_master_joint(id) ON DELETE CASCADE;
