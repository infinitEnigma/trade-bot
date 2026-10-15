-- Migration: 026_strategy_venue.sql
--
-- Store the venue on the strategy as (exchange, environment) — the same pair
-- exchange_accounts already uses. Nullable expand; NOT NULL is deferred to a
-- later migration after the backfill report shows zero nulls. No SQL guessing.
--
-- Rerun-safe: ADD COLUMN IF NOT EXISTS + DROP-IF-EXISTS-then-ADD for the
-- CHECKs (025 convention), pair-constraint guarded by pg_constraint lookup.

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS exchange TEXT;

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS environment TEXT;

ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_exchange_check;
ALTER TABLE strategies ADD CONSTRAINT strategies_exchange_check
  CHECK (exchange IS NULL OR exchange IN ('kodiak', 'lighter'));

ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_environment_check;
ALTER TABLE strategies ADD CONSTRAINT strategies_environment_check
  CHECK (environment IS NULL OR environment IN ('testnet', 'mainnet'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategies_venue_pair') THEN
    ALTER TABLE strategies ADD CONSTRAINT strategies_venue_pair CHECK (
      (exchange IS NULL AND environment IS NULL)
      OR (exchange IS NOT NULL AND environment IS NOT NULL)
    );
  END IF;
END $$;

COMMENT ON COLUMN strategies.exchange IS 'Venue exchange: kodiak|lighter. NULL=legacy unknown.';
COMMENT ON COLUMN strategies.environment IS 'Venue environment: testnet|mainnet. NULL=legacy unknown.';
