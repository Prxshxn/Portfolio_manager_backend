-- Add per_day_accrual column to gsec table
-- This column stores the daily accrual amount calculated as couponInterest / numberOfDaysForCouponPeriod
ALTER TABLE gsec 
ADD COLUMN IF NOT EXISTS per_day_accrual DECIMAL(20,8) NULL 
COMMENT 'Daily accrual amount: couponInterest / numberOfDaysForCouponPeriod';
