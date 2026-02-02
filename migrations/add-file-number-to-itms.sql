-- SQL query to add file_number column to itms.fixed_deposit_requests table
-- This query checks if the column exists before adding it

-- Option 1: Simple ALTER TABLE (will fail if column already exists)
ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN file_number VARCHAR(100) NULL AFTER request_no;

-- Option 2: Safe version - Check and add only if doesn't exist
-- Run this in MySQL to check if column exists first
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'itms' 
  AND TABLE_NAME = 'fixed_deposit_requests' 
  AND COLUMN_NAME = 'file_number';

-- If the above query returns no rows, then run:
ALTER TABLE itms.fixed_deposit_requests 
ADD COLUMN file_number VARCHAR(100) NULL AFTER request_no;

-- Option 3: Using a stored procedure approach (MySQL 5.7+)
-- This will only add the column if it doesn't exist
SET @dbname = 'itms';
SET @tablename = 'fixed_deposit_requests';
SET @columnname = 'file_number';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1', -- Column exists, do nothing
  CONCAT('ALTER TABLE ', @dbname, '.', @tablename, ' ADD COLUMN ', @columnname, ' VARCHAR(100) NULL AFTER request_no')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
