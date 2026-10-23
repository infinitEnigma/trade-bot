-- Migration: 031_authorization_pending_run_state.sql
-- Two-phase admission: a grid run is PREPARING (the engine is pricing it) or
-- PREPARED before it is ADMITTED (the backend validated the exposure under the
-- account lock) and only then AUTHORIZED (the engine may execute it).
--
-- Two new run states:
--
--   PREPARING             The engine is preparing the run. NOT admitted, NOT
--                         authorized, may NOT trade, and reserves NO exposure.
--                         The row exists so the engine can resolve the bot and
--                         its credentials — its existence grants nothing.
--   AUTHORIZATION_PENDING The backend ADMITTED the run: its notional_amount is
--                         the backend's validated exposure and it RESERVES that
--                         exposure, but the engine has not yet acknowledged
--                         execution, so it may NOT place orders.
--
-- Only an ADMITTED run reserves trading exposure. The pending-notional queries
-- (`state IN ('STOPPED', 'STARTING', 'AUTHORIZATION_PENDING')` in
-- attachRunWithCapGuardTx and sumPendingRunNotionalForAccount) therefore
-- EXCLUDE 'PREPARING' — a prepared run must not consume capacity it has not
-- been admitted for, and an admitted-but-not-yet-running run must not be
-- allowed to escape the cap.
--
-- The column is widened to VARCHAR(24) because 'AUTHORIZATION_PENDING' is 21
-- characters — VARCHAR(10) would truncate it.
--
-- The original CHECK was declared inline (unnamed), so PostgreSQL named it
-- `strategy_runs_state_check`. The drop is guarded on the COLUMN's check
-- constraints rather than that name, so it also works against a database
-- where the constraint was renamed.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
    FROM pg_constraint c
   WHERE c.conrelid = 'strategy_runs'::regclass
     AND c.contype = 'c'
     AND c.conkey = ARRAY[
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'strategy_runs'::regclass AND attname = 'state')
     ];

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE strategy_runs DROP CONSTRAINT %I', constraint_name);
  END IF;

  -- Widen first so the new values fit, then re-add the CHECK with them included.
  ALTER TABLE strategy_runs
    ALTER COLUMN state TYPE VARCHAR(24);

  ALTER TABLE strategy_runs
    ADD CONSTRAINT strategy_runs_state_check
    CHECK (state IN (
      'STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR',
      'PREPARING', 'AUTHORIZATION_PENDING'
    ));
END $$;
