-- Add currency column to gsec table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE gsec ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'LKR';
