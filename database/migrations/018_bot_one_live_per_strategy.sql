-- Migration: 018_bot_one_live_per_strategy.sql
-- Enforces the P0 create-guard at the DATABASE level (PROJECT_REVIEW_GAP_ANALYSIS
-- §6 P0 "crash-recovery path"; plan docs/instructions/crash-recovery-resume-plan.md
-- task 2.2).
--
-- The application guard in
-- `BotLifecycleRepository.findActiveBotForStrategy()` already refuses a second
-- live bot per strategy. This index is defence in depth, following the same
-- precedent as 015_credentials_issued_unique.sql: an application check is a
-- convention, a unique index is a constraint. It also closes the window where
-- two concurrent POST /start calls both pass the SELECT before either INSERTs.
--
-- The predicate is deliberately WIDER than the pre-2026-10-05 application check.
-- That check only counted `actual_state IN ('STARTING','RUNNING')`, so a bot a
-- crashed engine had parked in UNKNOWN (or ERROR) with `desired_state='RUNNING'`
-- did not block a new bot — `POST /start` then created a SECOND live bot on the
-- same venue account. Reproduced live during Gate-4 §9 run 3.
--
--   * STOPPING is excluded: the bot is on its way out (orders being cancelled),
--     and blocking here would break the ordinary stop-then-start flow.
--   * STOPPED / desired STOPPED rows are terminal and unconstrained, so history
--     accumulates freely.
--
-- Keyed on `strategy_id` because that is today's axis (a bot IS a running
-- strategy). The account-session model (plan §D) replaces this with
-- "one live session per exchange_account_id" — DATA_MODEL.md §4.4 sketches it as
-- `bot_instances_one_live_per_account`. When that migration lands this index is
-- dropped, not edited.
--
-- Rerun-safe: the guard only RAISEs on real duplicates, and CREATE INDEX
-- CONCURRENTLY IF NOT EXISTS is a no-op on re-run.

-- 1. Refuse to build the index while duplicates already exist — they must be
--    resolved by hand; silently deleting bot rows is not this migration's job.
DO $$
DECLARE dupes integer;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT 1
    FROM bot_instances
    WHERE actual_state IN ('STARTING', 'RUNNING')
       OR (desired_state = 'RUNNING' AND actual_state IN ('UNKNOWN', 'ERROR'))
    GROUP BY strategy_id
    HAVING COUNT(*) > 1
  ) AS d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      '018: % strategy_id(s) already have more than one live-or-parked bot — stop or resolve the duplicates by hand, then re-run',
      dupes;
  END IF;
END $$;

-- 2. CONCURRENTLY: build without locking bot_instances for writes.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  bot_instances_one_live_per_strategy
  ON bot_instances (strategy_id)
  WHERE actual_state IN ('STARTING', 'RUNNING')
     OR (desired_state = 'RUNNING' AND actual_state IN ('UNKNOWN', 'ERROR'));