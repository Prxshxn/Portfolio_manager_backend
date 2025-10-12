-- Add matured column to repo_deals table
-- This migration adds the matured flag to prevent duplicate processing in maturity handling

ALTER TABLE repo_deals
  ADD COLUMN matured TINYINT(1) NOT NULL DEFAULT 0;

-- Add index for better performance on maturity queries
CREATE INDEX idx_repo_deals_matured ON repo_deals(matured);
CREATE INDEX idx_repo_deals_maturity_date_matured ON repo_deals(maturity_date, matured);
