-- Add face value adjustment fields to repo_deals
ALTER TABLE repo_deals
  ADD COLUMN IF NOT EXISTS face_value_adjustment DECIMAL(20,4) NULL,
  ADD COLUMN IF NOT EXISTS face_value_as_per_counterparty DECIMAL(20,4) NULL;

