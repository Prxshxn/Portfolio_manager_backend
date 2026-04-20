-- Backfill approved_at for buyback deals that were marked Approved but never
-- had approved_at populated. Prior versions of updateStatus silently skipped
-- setting approved_at when the column was missing from the schema cache, which
-- caused downstream queries filtering `DATE(approved_at) <= DATE(?)` to drop
-- these rows and leave fully-sold source buy deals showing undeducted balance
-- in the GSEC report and the GSEC sell modal.
--
-- Idempotent: only rows with deal_status='Approved' AND approved_at IS NULL are
-- touched, and each such row receives the earliest non-null timestamp we still
-- have for it (updated_at, then created_at). This schema does not have a
-- verified_at column, so we fall back through updated_at (set via
-- ON UPDATE CURRENT_TIMESTAMP when the deal was approved) to created_at.

UPDATE buyback_deals
SET approved_at = COALESCE(updated_at, created_at)
WHERE deal_status = 'Approved'
  AND approved_at IS NULL;

-- Verification:
-- SELECT deal_number, deal_status, approved_at, updated_at, created_at
-- FROM buyback_deals
-- WHERE deal_status = 'Approved' AND approved_at IS NULL;
-- Expected: 0 rows after running this migration.
