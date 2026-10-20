-- Migration 027: residual exposure schema expansion.
-- This file is intentionally additive only. Apply it to the restored production
-- snapshot first, run database/ops/residual-admission-preflight.sql, and record
-- the counts in the PR before applying migration 028 (normalization).
-- The migration runner executes each statement in autocommit mode; DDL blocks
-- set a bounded lock_timeout locally. All statements are idempotent.

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

-- All-null-or-all-set is validated only after 028 normalizes partial rows.
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

-- Preserve historical all-set rows with invalid values. Value constraints are
-- NOT VALID until the snapshot counts have been reviewed and invalid records
-- adjudicated. PostgreSQL still enforces each constraint on new/updated rows.
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
