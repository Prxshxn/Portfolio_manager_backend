-- Update buyback_deals table to include new status for three-level verification workflow
-- This migration adds 'Pending_Final_Approval' status to the deal_status enum
-- Note: Migration runner will handle missing table errors gracefully

-- First, create a temporary table with the new enum
CREATE TABLE buyback_deals_new LIKE buyback_deals;

-- Update the deal_status column definition in the new table
ALTER TABLE buyback_deals_new 
MODIFY COLUMN deal_status ENUM('Draft', 'Pending_Verification', 'Verified', 'Pending_Final_Approval', 'Approved', 'Rejected', 'Settled') DEFAULT 'Draft';

-- Copy data from old table to new table
INSERT INTO buyback_deals_new SELECT * FROM buyback_deals;

-- Drop the old table
DROP TABLE buyback_deals;

-- Rename the new table to the original name
RENAME TABLE buyback_deals_new TO buyback_deals;

-- Recreate indexes and foreign keys
ALTER TABLE buyback_deals 
ADD INDEX idx_deal_number (deal_number),
ADD INDEX idx_isin (leg1_isin, leg2_isin),
ADD INDEX idx_trade_dates (leg1_trade_date, leg2_trade_date),
ADD INDEX idx_status (deal_status),
ADD INDEX idx_created_at (created_at);

-- Recreate foreign key constraints
ALTER TABLE buyback_deals 
ADD CONSTRAINT fk_buyback_leg1_broker FOREIGN KEY (leg1_broker) REFERENCES brokers(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_buyback_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_buyback_verified_by FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_buyback_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
