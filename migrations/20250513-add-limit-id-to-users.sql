-- Add limit_id column to users table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE users ADD COLUMN limit_id INT NULL;
