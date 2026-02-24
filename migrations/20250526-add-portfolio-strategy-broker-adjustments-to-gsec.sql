-- Add portfolio, strategy, broker, and adjustment columns to gsec table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE gsec ADD COLUMN portfolio VARCHAR(255) NULL;
ALTER TABLE gsec ADD COLUMN strategy VARCHAR(255) NULL;
ALTER TABLE gsec ADD COLUMN broker VARCHAR(255) NULL;
ALTER TABLE gsec ADD COLUMN accrued_interest_adjustment DECIMAL(20,6) DEFAULT 0;
ALTER TABLE gsec ADD COLUMN clean_price_adjustment DECIMAL(20,6) DEFAULT 0;
