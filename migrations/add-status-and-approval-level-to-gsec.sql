-- Add status and current_approval_level columns to itms.gsec table
-- Run this in MySQL Workbench or your SQL client

-- Check if status column exists
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'itms' 
  AND TABLE_NAME = 'gsec' 
  AND COLUMN_NAME = 'status';

-- If no rows returned, add status column
ALTER TABLE itms.gsec 
ADD COLUMN status VARCHAR(50) DEFAULT 'pending' AFTER buy_deal_number;

-- Check if current_approval_level column exists
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'itms' 
  AND TABLE_NAME = 'gsec' 
  AND COLUMN_NAME = 'current_approval_level';

-- If no rows returned, add current_approval_level column
ALTER TABLE itms.gsec 
ADD COLUMN current_approval_level VARCHAR(50) DEFAULT 'back_office_final' AFTER status;

-- Verify the columns were added
DESCRIBE itms.gsec;
