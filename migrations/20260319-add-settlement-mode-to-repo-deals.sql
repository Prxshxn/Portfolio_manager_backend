-- Add settlement_mode to repo_deals (nullable for backward compatibility)
ALTER TABLE repo_deals
  ADD COLUMN settlement_mode VARCHAR(50) NULL AFTER counterparty_id;

