-- Add trade_date column to gsec table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE gsec ADD COLUMN trade_date DATE NULL COMMENT 'Trade date for the GSec transaction';
