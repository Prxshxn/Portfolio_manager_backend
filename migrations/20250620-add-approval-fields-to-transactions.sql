-- Add approval fields to transactions table
-- Note: Migration runner will handle missing table/duplicate column errors gracefully
ALTER TABLE transactions ADD COLUMN approval_status VARCHAR(50) NOT NULL DEFAULT 'pending';
ALTER TABLE transactions ADD COLUMN current_approval_level VARCHAR(50) NOT NULL DEFAULT 'front_office';
ALTER TABLE transactions ADD COLUMN approval_chain JSON NOT NULL DEFAULT (JSON_ARRAY());
ALTER TABLE transactions ADD COLUMN submitted_by INT NOT NULL DEFAULT 0;
