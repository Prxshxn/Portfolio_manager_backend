-- Add approval columns to money_market_deals table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully

-- Add status column
ALTER TABLE money_market_deals 
ADD COLUMN status VARCHAR(20) DEFAULT 'pending' AFTER remarks;

-- Add comment column
ALTER TABLE money_market_deals 
ADD COLUMN comment TEXT AFTER status;

-- Add current_approval_level column
ALTER TABLE money_market_deals 
ADD COLUMN current_approval_level VARCHAR(50) DEFAULT 'front_office' AFTER comment;

-- Add authorized_by column
ALTER TABLE money_market_deals 
ADD COLUMN authorized_by INT AFTER updated_at;

-- Add authorized_at column
ALTER TABLE money_market_deals 
ADD COLUMN authorized_at DATETIME AFTER authorized_by;

