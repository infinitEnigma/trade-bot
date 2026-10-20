-- Migration 027: residual exposure admission and operator abandonment.
ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS residual_abandoned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS residual_abandoned_by UUID,
  ADD COLUMN IF NOT EXISTS residual_abandon_reason TEXT,
  ADD COLUMN IF NOT EXISTS residual_accepted_quantity NUMERIC(38, 18),
  ADD COLUMN IF NOT EXISTS residual_accepted_symbol TEXT;
-- Add as NOT VALID first so pre-existing rows can be normalized safely.
-- CHECK constraints are still enforced for new/updated rows while NOT VALID.
ALTER TABLE bot_instances DROP CONSTRAINT IF EXISTS bot_instances_residual_abandon_complete;
ALTER TABLE bot_instances ADD CONSTRAINT bot_instances_residual_abandon_complete CHECK (
  (residual_abandoned_at IS NULL AND residual_abandoned_by IS NULL
   AND residual_abandon_reason IS NULL AND residual_accepted_quantity IS NULL
   AND residual_accepted_symbol IS NULL)
  OR
  (residual_abandoned_at IS NOT NULL AND residual_abandoned_by IS NOT NULL
   AND residual_abandon_reason IS NOT NULL
   AND length(btrim(residual_abandon_reason)) BETWEEN 1 AND 500
   AND residual_accepted_quantity IS NOT NULL AND residual_accepted_quantity >= 0
   AND residual_accepted_symbol IS NOT NULL
   AND length(btrim(residual_accepted_symbol)) BETWEEN 1 AND 64)
) NOT VALID;

-- A partial or malformed historical resolution is not a valid abandonment.
-- Normalize it to "unresolved" rather than preserve an unsafe half-resolution.
UPDATE bot_instances
SET residual_abandoned_at = NULL,
    residual_abandoned_by = NULL,
    residual_abandon_reason = NULL,
    residual_accepted_quantity = NULL,
    residual_accepted_symbol = NULL
WHERE NOT (
  residual_abandoned_at IS NULL AND residual_abandoned_by IS NULL
  AND residual_abandon_reason IS NULL AND residual_accepted_quantity IS NULL
  AND residual_accepted_symbol IS NULL
) AND NOT (
  residual_abandoned_at IS NOT NULL AND residual_abandoned_by IS NOT NULL
  AND residual_abandon_reason IS NOT NULL
  AND length(btrim(residual_abandon_reason)) BETWEEN 1 AND 500
  AND residual_accepted_quantity IS NOT NULL AND residual_accepted_quantity >= 0
  AND residual_accepted_symbol IS NOT NULL
  AND length(btrim(residual_accepted_symbol)) BETWEEN 1 AND 64
);

ALTER TABLE bot_instances VALIDATE CONSTRAINT bot_instances_residual_abandon_complete;
