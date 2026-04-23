-- Add notes column to maturity_processing_log for premature maturity audit details
SET @has_notes := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'maturity_processing_log'
    AND COLUMN_NAME = 'notes'
);

SET @ddl := IF(
  @has_notes = 0,
  'ALTER TABLE maturity_processing_log ADD COLUMN notes TEXT NULL AFTER authorization_level',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
