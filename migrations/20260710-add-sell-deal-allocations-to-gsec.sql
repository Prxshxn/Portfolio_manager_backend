-- A multi-lot GSec Sell (drawing face value from more than one Buy deal) should be
-- one deal with one deal_number, not a separate row per buy lot. This mirrors
-- buyback_deals.sell_deal_allocations so the allocation breakdown lives on the
-- single Sell row instead of being modeled as multiple independent deals.
--
-- This MySQL version does not support ADD COLUMN IF NOT EXISTS; run_migrations.js
-- treats each migration as run-once, but if replaying manually, check first:
--   SHOW COLUMNS FROM gsec WHERE Field = 'sell_deal_allocations';
ALTER TABLE gsec
  ADD COLUMN sell_deal_allocations JSON NULL AFTER buy_deal_number;
