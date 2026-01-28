-- Add buyback_roles column to users table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE users ADD COLUMN buyback_roles VARCHAR(255) NULL;
