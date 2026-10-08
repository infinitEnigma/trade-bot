-- Migration: 022_drop_bot_strategy_id_shim.sql
-- Residue cleanup (a): drop the `strategy_id` shim column off bot_instances.
--
-- The account-session model (plan §D, DATA_MODEL §4.4) is landed: the unit
-- of execution is the session (user, exchange_accounts) with N strategy_runs
-- inside it. Code was moved off the column first (single PR ordering):
-- - create guard: `findLiveRunForStrategy` (runs-only), the bot-level
--   `findActiveBotForStrategy` is a retired throwing stub;
-- - badge sync: `syncSessionStrategiesActive` fans the session's runs;
-- - start dispatch: legacy top-level strategyId derived from the oldest run;
-- - ledger attribution: `user_id` from the session row, `strategy_id` from
--   its oldest run;
-- - list/detail: oldest-run strategy projection; strategy-scoped delete
--   lookup via `strategy_runs`.
--
-- Grep gate before this ships: `strategy_id` in backend + engine + frontend
-- must show only `strategy_runs.strategy_id` / `runs[].strategy_id` /
-- protocol `strategyId` (run specs), plus suites, as with the 014 drops.
--
-- Guard: refuse while pre-D rows exist (sessions with no exchange account
-- or no run row) — backfill/clean those by hand first, per the 019 header.
-- Rerun-safe: the guard only RAISEs on real conflicts; DROP COLUMN IF
-- EXISTS and DROP INDEX IF EXISTS are no-ops on re-run; the runner records
-- the file only after every statement succeeded.
DO $$
DECLARE pre_d integer;
BEGIN
  SELECT COUNT(*) INTO pre_d
  FROM bot_instances bi
  WHERE bi.exchange_account_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM strategy_runs r WHERE r.bot_id = bi.id
     );
  IF pre_d > 0 THEN
    RAISE EXCEPTION
      '022: % bot_instances row(s) have no exchange account or no strategy_runs row — backfill/clean by hand, then re-run',
      pre_d;
  END IF;
END $$;

-- 018's per-strategy rule is superseded by the 019 per-account rule
-- (`bot_instances_one_live_per_account`) plus the per-strategy runs rule
-- (`strategy_runs_one_active_per_strategy`).
DROP INDEX IF EXISTS bot_instances_one_live_per_strategy;

-- 002's per-strategy bot indexes die with the column they index.
DROP INDEX IF EXISTS idx_bot_instances_strategy_id;
DROP INDEX IF EXISTS idx_bot_instances_user_strategy;
DROP INDEX IF EXISTS idx_bot_instances_running;

ALTER TABLE bot_instances DROP COLUMN IF EXISTS strategy_id;
