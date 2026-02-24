-- Add allowed_tabs column to users table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE users ADD COLUMN allowed_tabs TEXT NULL;
