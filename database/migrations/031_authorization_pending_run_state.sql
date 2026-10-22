-- Migration: 031_authorization_pending_run_state.sql
-- Two-phase admission: a grid run is PREPARED (the engine priced it) before
-- it is ADMITTED (the backend validated the exposure under the account lock)
-- and only then AUTHORIZED (the engine may execute it).
--
-- `strategy_runs.state` gains 'AUTHORIZATION_PENDING': the run has been
-- admitted — its notional_amount is the backend's validated exposure and it
-- COUNTS toward the account's pending exposure — but the engine has not yet
-- acknowledged execution, so it may not place orders.
--
-- The state MUST be inside the pending-notional query (`state IN ('STOPPED',
-- 'STARTING')` in attachRunWithCapGuardTx and
-- sumPendingRunNotionalForAccount). An admitted-but-not-yet-running run
-- carries real exposure; excluding it would let two concurrent admissions
-- each pass the F1 cap against the same remaining capacity.
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

  -- Widen first so the new value fits, then re-add the CHECK with it included.
  ALTER TABLE strategy_runs
    ALTER COLUMN state TYPE VARCHAR(24);

  ALTER TABLE strategy_runs
    ADD CONSTRAINT strategy_runs_state_check
    CHECK (state IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR', 'AUTHORIZATION_PENDING'));
END $$;
