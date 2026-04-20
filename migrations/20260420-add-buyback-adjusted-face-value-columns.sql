-- Add adjusted face value capture for buyback legs.
-- These fields preserve user-entered face adjustments while allowing
-- settlement calculations to continue from the base face value.

ALTER TABLE buyback_deals
  ADD COLUMN IF NOT EXISTS leg1_adjusted_face_value DECIMAL(18,2) NULL AFTER leg1_face_value,
  ADD COLUMN IF NOT EXISTS leg2_adjusted_face_value DECIMAL(18,2) NULL AFTER leg2_face_value;
