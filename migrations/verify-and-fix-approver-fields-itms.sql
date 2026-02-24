-- Verify and fix approver fields in itms.fixed_deposit_requests
-- Run this in MySQL Workbench or your SQL client connected to the itms database

-- First, check current database
SELECT DATABASE() as current_database;

-- Check if approver_id column exists
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'itms' 
  AND TABLE_NAME = 'fixed_deposit_requests' 
  AND COLUMN_NAME LIKE 'approver%'
ORDER BY ORDINAL_POSITION;

-- Check all columns in the table
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'itms' 
  AND TABLE_NAME = 'fixed_deposit_requests'
ORDER BY ORDINAL_POSITION;

-- If approver_id doesn't exist, run this:
-- ALTER TABLE itms.fixed_deposit_requests 
-- ADD COLUMN approver_id INT NULL AFTER maturity_date,
-- ADD COLUMN approver_name VARCHAR(255) NULL AFTER approver_id,
-- ADD COLUMN approver_designation VARCHAR(255) NULL AFTER approver_name,
-- ADD COLUMN approval_category VARCHAR(100) NULL AFTER approver_designation,
-- ADD COLUMN approval_limit_required VARCHAR(255) NULL AFTER approval_category,
-- ADD COLUMN approver_notes TEXT NULL AFTER approval_limit_required;

-- Test INSERT query (will fail if columns don't exist)
-- INSERT INTO itms.fixed_deposit_requests (
--   portfolio_id, book, module, request_no, file_number, status,
--   counterparty_type, counterparty_id, contact_person, request_remarks,
--   instrument_type, isin, currency, requested_amount, target_yield,
--   value_date, maturity_date,
--   approver_id, approver_name, approver_designation, approval_category,
--   approval_limit_required, approver_notes,
--   submitted_by, created_at, updated_at
-- ) VALUES (
--   'TEST', 'Test', 'Pre approval', 'TEST001', 'TEST', 'Draft',
--   'Bank', 1, 'Test', NULL,
--   'Fixed Deposit', NULL, 'LKR', 1000, 10.5,
--   '2026-02-01', '2026-05-01',
--   1, 'Test Approver', 'CEO', 'Test Category',
--   NULL, NULL,
--   1, NOW(), NOW()
-- );
