-- Add missing columns to buyback_deals table
-- This migration adds all the columns that are expected by the buybackDealModel

ALTER TABLE buyback_deals
  -- Leg 1 missing columns
  ADD COLUMN IF NOT EXISTS leg1_transaction_type ENUM('Buy', 'Sell') NOT NULL DEFAULT 'Buy' AFTER leg1_value_date,
  ADD COLUMN IF NOT EXISTS leg1_trade_type VARCHAR(20) DEFAULT 'BuyBack' AFTER leg1_transaction_type,
  ADD COLUMN IF NOT EXISTS leg1_counterparty VARCHAR(50) NOT NULL DEFAULT '' AFTER leg1_isin,
  ADD COLUMN IF NOT EXISTS leg1_portfolio VARCHAR(50) AFTER leg1_broker,
  ADD COLUMN IF NOT EXISTS leg1_strategy VARCHAR(50) AFTER leg1_portfolio,
  ADD COLUMN IF NOT EXISTS leg1_custodian VARCHAR(100) AFTER leg1_strategy,
  ADD COLUMN IF NOT EXISTS leg1_settlement_mode ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') DEFAULT 'RTGS' AFTER leg1_custodian,
  ADD COLUMN IF NOT EXISTS leg1_brokerage DECIMAL(8,4) DEFAULT 0.0000 AFTER leg1_settlement_mode,
  ADD COLUMN IF NOT EXISTS leg1_interest_rate DECIMAL(8,4) DEFAULT 0.0000 AFTER leg1_brokerage,
  ADD COLUMN IF NOT EXISTS leg1_yield_rate DECIMAL(10,6) NOT NULL DEFAULT 0.000000 AFTER leg1_face_value,
  ADD COLUMN IF NOT EXISTS leg1_accrued_interest DECIMAL(10,4) AFTER leg1_dirty_price,
  ADD COLUMN IF NOT EXISTS leg1_currency VARCHAR(3) DEFAULT 'LKR' AFTER leg1_accrued_interest,
  
  -- Leg 2 missing columns
  ADD COLUMN IF NOT EXISTS leg2_transaction_type ENUM('Buy', 'Sell') NOT NULL DEFAULT 'Sell' AFTER leg2_value_date,
  ADD COLUMN IF NOT EXISTS leg2_trade_type VARCHAR(20) DEFAULT 'BuyBack' AFTER leg2_transaction_type,
  ADD COLUMN IF NOT EXISTS leg2_counterparty VARCHAR(50) NOT NULL DEFAULT '' AFTER leg2_isin,
  ADD COLUMN IF NOT EXISTS leg2_portfolio VARCHAR(50) AFTER leg2_broker,
  ADD COLUMN IF NOT EXISTS leg2_strategy VARCHAR(50) AFTER leg2_portfolio,
  ADD COLUMN IF NOT EXISTS leg2_custodian VARCHAR(100) AFTER leg2_strategy,
  ADD COLUMN IF NOT EXISTS leg2_settlement_mode ENUM('RTGS', 'CEFT', 'SLIPS', 'Cheque', 'Other') DEFAULT 'RTGS' AFTER leg2_custodian,
  ADD COLUMN IF NOT EXISTS leg2_yield_rate DECIMAL(10,6) NOT NULL DEFAULT 0.000000 AFTER leg2_face_value,
  ADD COLUMN IF NOT EXISTS leg2_accrued_interest DECIMAL(10,4) AFTER leg2_dirty_price,
  ADD COLUMN IF NOT EXISTS leg2_currency VARCHAR(3) DEFAULT 'LKR' AFTER leg2_accrued_interest,
  
  -- ISIN metadata missing columns
  ADD COLUMN IF NOT EXISTS issue_date DATE AFTER coupon_date2,
  ADD COLUMN IF NOT EXISTS maturity_date DATE AFTER issue_date,
  ADD COLUMN IF NOT EXISTS coupon_rate DECIMAL(8,4) AFTER maturity_date;
