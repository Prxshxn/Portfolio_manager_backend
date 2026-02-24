-- Add buy_deal_number column to gsec table to track which buy deal a sell transaction references
-- Note: Migration runner will handle missing table errors gracefully
ALTER TABLE gsec ADD COLUMN buy_deal_number VARCHAR(50) NULL AFTER deal_number;

-- Add index for performance
-- Note: Migration runner will defer this if column doesn't exist yet
CREATE INDEX idx_gsec_buy_deal_number ON gsec(buy_deal_number);

-- Add foreign key constraint to ensure referential integrity
-- ALTER TABLE gsec ADD CONSTRAINT fk_gsec_buy_deal_number 
-- FOREIGN KEY (buy_deal_number) REFERENCES gsec(deal_number) ON DELETE SET NULL;

