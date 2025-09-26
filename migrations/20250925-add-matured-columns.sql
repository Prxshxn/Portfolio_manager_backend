-- Add matured flag to core deal tables

ALTER TABLE money_market_deals
  ADD COLUMN matured TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE gsec
  ADD COLUMN matured TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE buyback_deals
  ADD COLUMN matured TINYINT(1) NOT NULL DEFAULT 0;



