-- Add source_buy_deal_number field to track which specific buy deal the buyback was created from
-- Note: Migration runner will handle missing table errors gracefully
ALTER TABLE buyback_deals 
ADD COLUMN source_buy_deal_number VARCHAR(50) NULL 
COMMENT 'The specific buy deal number that this buyback transaction was created from';

-- Add index for better performance
-- Note: Migration runner will defer this if column doesn't exist yet
CREATE INDEX idx_buyback_source_buy_deal ON buyback_deals(source_buy_deal_number);
