-- Migration 029: validate only the all-null-or-all-set invariant.
-- Value-level constraints remain NOT VALID until historical invalid values are
-- adjudicated or a reviewed pre-count confirms none remain. A failed validation
-- leaves the constraint present but unvalidated; it still protects new/updated
-- rows and retrying VALIDATE is safe.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bot_instances'::regclass
      AND conname = 'bot_instances_residual_abandon_complete'
      AND NOT convalidated
  ) THEN
    ALTER TABLE bot_instances VALIDATE CONSTRAINT bot_instances_residual_abandon_complete;
  END IF;
END
$migration$;
