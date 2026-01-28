-- Add brokerage column to gsec table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE gsec ADD COLUMN brokerage DECIMAL(20,6) NULL;
