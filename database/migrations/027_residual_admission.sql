-- Migration 027: residual exposure admission and operator abandonment.
-- The migration runner executes statements individually (autocommit); therefore
-- the forensic INSERT + normalization UPDATE below are deliberately one SQL
-- statement so the evidence and clearing update commit or roll back together.
--
-- Historical value-level violations are preserved. The value constraints are
-- NOT VALID until snapshot pre-counts and explicit adjudication permit a later
-- validation migration. Do not broaden the normalization predicate without
-- reviewing actual counts and approving each pattern.
--
-- residual_normalization_log is an append-only forensic record. Later
-- migrations must not UPDATE or DELETE rows without explicit review.

ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS residual_abandoned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS residual_abandoned_by UUID,
  ADD COLUMN IF NOT EXISTS residual_abandon_reason TEXT,
  ADD COLUMN IF NOT EXISTS residual_accepted_quantity NUMERIC(38, 18),
  ADD COLUMN IF NOT EXISTS residual_accepted_symbol TEXT;

CREATE TABLE IF NOT EXISTS residual_normalization_log (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL,
  residual_abandoned_at TIMESTAMPTZ NULL,
  residual_abandoned_by UUID NULL,
  residual_abandon_reason TEXT NULL,
  residual_accepted_quantity NUMERIC(38, 18) NULL,
  residual_accepted_symbol TEXT NULL,
  pattern TEXT NOT NULL CHECK (pattern IN ('PARTIAL', 'NEGATIVE_QTY', 'EMPTY_REASON', 'EMPTY_SYMBOL', 'INVALID_REASON_LENGTH', 'INVALID_SYMBOL_LENGTH')),
  migration_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL
);
COMMENT ON TABLE residual_normalization_log IS
  'Append-only forensic evidence for residual abandonment normalization. Do not UPDATE or DELETE without explicit review.';

-- Null-pattern invariant. NOT VALID allows existing partial records to be
-- normalized first; it still applies to every new or updated row.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bot_instances'::regclass
      AND conname = 'bot_instances_residual_abandon_complete'
  ) THEN
    ALTER TABLE bot_instances ADD CONSTRAINT bot_instances_residual_abandon_complete CHECK (
      (residual_abandoned_at IS NULL AND residual_abandoned_by IS NULL
       AND residual_abandon_reason IS NULL AND residual_accepted_quantity IS NULL
       AND residual_accepted_symbol IS NULL)
      OR
      (residual_abandoned_at IS NOT NULL AND residual_abandoned_by IS NOT NULL
       AND residual_abandon_reason IS NOT NULL
       AND residual_accepted_quantity IS NOT NULL
       AND residual_accepted_symbol IS NOT NULL)
    ) NOT VALID;
  END IF;
END
$migration$;

-- Value checks are intentionally NOT VALID. Existing all-set rows with invalid
-- values are retained with their evidence and adjudicated in a later migration.
-- NOT VALID checks still protect new/updated rows.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bot_instances'::regclass AND conname='bot_instances_residual_abandon_reason_valid') THEN
    ALTER TABLE bot_instances ADD CONSTRAINT bot_instances_residual_abandon_reason_valid
      CHECK (residual_abandon_reason IS NULL OR length(btrim(residual_abandon_reason)) BETWEEN 1 AND 500) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bot_instances'::regclass AND conname='bot_instances_residual_abandon_quantity_valid') THEN
    ALTER TABLE bot_instances ADD CONSTRAINT bot_instances_residual_abandon_quantity_valid
      CHECK (residual_accepted_quantity IS NULL OR residual_accepted_quantity >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bot_instances'::regclass AND conname='bot_instances_residual_abandon_symbol_valid') THEN
    ALTER TABLE bot_instances ADD CONSTRAINT bot_instances_residual_abandon_symbol_valid
      CHECK (residual_accepted_symbol IS NULL OR length(btrim(residual_accepted_symbol)) BETWEEN 1 AND 64) NOT VALID;
  END IF;
END
$migration$;

-- Normalize ONLY partial null-patterns. Valid all-set rows (including quantity
-- zero) and invalid-value all-set rows are untouched. The WHERE explicitly
-- excludes all-null rows, making a rerun produce zero new log rows and zero
-- updated sessions after the first successful execution.
WITH partial_rows AS MATERIALIZED (
  SELECT id, residual_abandoned_at, residual_abandoned_by,
         residual_abandon_reason, residual_accepted_quantity,
         residual_accepted_symbol
  FROM bot_instances
  WHERE NOT (
    residual_abandoned_at IS NULL AND residual_abandoned_by IS NULL
    AND residual_abandon_reason IS NULL AND residual_accepted_quantity IS NULL
    AND residual_accepted_symbol IS NULL
  )
  AND NOT (
    residual_abandoned_at IS NOT NULL AND residual_abandoned_by IS NOT NULL
    AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL
    AND residual_accepted_symbol IS NOT NULL
  )
),
logged AS (
  INSERT INTO residual_normalization_log (
    session_id, residual_abandoned_at, residual_abandoned_by,
    residual_abandon_reason, residual_accepted_quantity,
    residual_accepted_symbol, pattern, migration_id, actor, reason
  )
  SELECT id, residual_abandoned_at, residual_abandoned_by,
         residual_abandon_reason, residual_accepted_quantity,
         residual_accepted_symbol, 'PARTIAL', '027', 'migration:027',
         'Partial residual-abandonment record normalized to unresolved; original values preserved in this log.'
  FROM partial_rows
  RETURNING session_id
)
UPDATE bot_instances AS bi
SET residual_abandoned_at = NULL,
    residual_abandoned_by = NULL,
    residual_abandon_reason = NULL,
    residual_accepted_quantity = NULL,
    residual_accepted_symbol = NULL
FROM logged
WHERE bi.id = logged.session_id;

-- Validate only the all-null-or-all-set invariant. A failed validation leaves
-- the constraint installed but NOT VALID; it still protects new/updated rows,
-- and retrying VALIDATE after remediation is safe. lock_timeout bounds DDL wait.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='bot_instances'::regclass
      AND conname='bot_instances_residual_abandon_complete'
      AND NOT convalidated
  ) THEN
    ALTER TABLE bot_instances VALIDATE CONSTRAINT bot_instances_residual_abandon_complete;
  END IF;
END
$migration$;
