-- SQL queries to add approver fields to itms.fixed_deposit_requests table
-- Run these queries one by one in MySQL Workbench or your SQL client

-- Step 1: Check if approver_id column exists
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'itms' 
  AND TABLE_NAME = 'fixed_deposit_requests' 
  AND COLUMN_NAME = 'approver_id';

-- Step 2: Add columns one at a time (run each statement separately)
-- This avoids MySQL syntax errors when adding multiple columns with AFTER clause

ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN approver_id INT NULL AFTER maturity_date;

ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN approver_name VARCHAR(255) NULL AFTER approver_id;

ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN approver_designation VARCHAR(255) NULL AFTER approver_name;

ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN approval_category VARCHAR(100) NULL AFTER approver_designation;

ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN approval_limit_required VARCHAR(255) NULL AFTER approval_category;

ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN approver_notes TEXT NULL AFTER approval_limit_required;

-- Step 3: Add index for better query performance (optional)
CREATE INDEX idx_approver_id ON itms.fixed_deposit_requests(approver_id);

-- Step 4: Verify the columns were added
DESCRIBE itms.fixed_deposit_requests;
