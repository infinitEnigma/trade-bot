-- Migration: 019_bot_account_sessions.sql
-- D1 of the account-session model (EXCHANGE_INTEGRATION_PLAN §D / DATA_MODEL
-- §4.4, P1 #2): the unit of execution becomes the exchange account, not the
-- strategy. One bot per (user, exchange_accounts) row running N strategy_runs.
--
-- Staged for the single-run shim (Act-mode decision 2): `strategy_id` and the
-- 018 per-strategy index STAY until D2 moves readers off them. The drop lands
-- in a later migration with the grep gate
-- (`strategy_id` in backend + engine + frontend) plus the suites, as with the
-- 014 table drops. What this file does:
-- - CREATE strategy_runs (bot_id, strategy_id, config snapshot, sizing,
--   state) with UNIQUE(bot_id, strategy_id) + partial unique
--   strategy_runs_one_active_per_strategy WHERE STARTING/RUNNING.
-- - Backfill one run per existing bot (1:1 today) carrying its strategy_id
--   and notional from the BOT_CREATED audit metadata (fallback 0 when the
--   metadata never recorded one — sizing is enforced at attach time anyway).
-- - CREATE UNIQUE INDEX CONCURRENTLY bot_instances_one_live_per_account ON
--   (exchange_account_id) WHERE STARTING/RUNNING (the D axis; coexists with
--   the 018 per-strategy index during the shim window).
-- - ADD nullable bot_trade_fills.run_id FK -> strategy_runs (Act-mode
--   decision 1): backfilled where the bot has exactly one run, NULL for
--   pre-D history. The ledger idempotency key is UNCHANGED.
--
-- Rerun-safe: guards RAISE only on real conflicts; CREATE TABLE/INDEX IF NOT
-- EXISTS and ADD COLUMN IF NOT EXISTS are no-ops on re-run; the backfill
-- INSERT ... ON CONFLICT DO NOTHING converges; the runner records the file
-- only after every statement succeeded.

-- 1. strategy_runs: the per-strategy unit inside a session.
CREATE TABLE IF NOT EXISTS strategy_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  config_version INTEGER NOT NULL DEFAULT 1,
  config JSONB NOT NULL DEFAULT '{}',
  notional_amount NUMERIC NOT NULL CHECK (notional_amount >= 0),
  state VARCHAR(10) NOT NULL DEFAULT 'STOPPED'
    CHECK (state IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR')),
  last_error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_runs_bot_id
  ON strategy_runs (bot_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_strategy_id
  ON strategy_runs (strategy_id);

-- 2. One live run per strategy across sessions (replaces 018's bot-level
--    rule once strategy_id drops off bot_instances).
DO $$
DECLARE dupes integer;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT 1
    FROM strategy_runs
    WHERE state IN ('STARTING', 'RUNNING')
    GROUP BY strategy_id
    HAVING COUNT(*) > 1
  ) AS d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      '019: % strateg(ies) already have more than one live run — resolve by hand, then re-run',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  strategy_runs_one_active_per_strategy
  ON strategy_runs (strategy_id)
  WHERE state IN ('STARTING', 'RUNNING');

-- 3. Backfill: one run per existing bot. Config is snapshotted from the
--    live strategies row; notional from the BOT_CREATED audit metadata
--    (D2 writes it going forward — see bot-lifecycle.service).
INSERT INTO strategy_runs (bot_id, strategy_id, config_version, config, notional_amount, state)
SELECT
  bi.id,
  bi.strategy_id,
  1,
  COALESCE(s.config, '{}'),
  COALESCE(
    NULLIF((ev.metadata ->> 'notionalAmount'), '')::NUMERIC,
    0
  ),
  CASE bi.actual_state
    WHEN 'RUNNING' THEN 'RUNNING'
    WHEN 'STARTING' THEN 'STARTING'
    ELSE 'STOPPED'
  END
FROM bot_instances bi
JOIN strategies s ON s.id = bi.strategy_id
LEFT JOIN LATERAL (
  SELECT metadata
  FROM bot_lifecycle_events
  WHERE bot_id = bi.id AND event_type = 'BOT_CREATED'
  ORDER BY created_at ASC
  LIMIT 1
) AS ev ON true
ON CONFLICT (bot_id, strategy_id) DO NOTHING;

-- 4. One live session per account (the D axis). Coexists with 018 during the
--    shim window; 018 is dropped when strategy_id drops off bot_instances.
DO $$
DECLARE dupes integer;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT 1
    FROM bot_instances
    WHERE exchange_account_id IS NOT NULL
      AND (
        actual_state IN ('STARTING', 'RUNNING')
        OR (desired_state = 'RUNNING' AND actual_state IN ('UNKNOWN', 'ERROR'))
      )
    GROUP BY exchange_account_id
    HAVING COUNT(*) > 1
  ) AS d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      '019: % exchange account(s) already have more than one live-or-parked session — stop or resolve the duplicates by hand, then re-run',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  bot_instances_one_live_per_account
  ON bot_instances (exchange_account_id)
  WHERE actual_state IN ('STARTING', 'RUNNING')
     OR (desired_state = 'RUNNING' AND actual_state IN ('UNKNOWN', 'ERROR'));

-- 5. Ledger attribution (nullable; Act-mode decision 1). Backfilled where
--    the bot has exactly one run; pre-D ambiguous rows stay NULL.
ALTER TABLE bot_trade_fills
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES strategy_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bot_trade_fills_run_executed_at
  ON bot_trade_fills (run_id, executed_at DESC)
  WHERE run_id IS NOT NULL;

UPDATE bot_trade_fills f
SET run_id = single.id
FROM (
  SELECT DISTINCT ON (bot_id) bot_id, id
  FROM strategy_runs
  ORDER BY bot_id, created_at ASC, id ASC
) AS single
JOIN (
  SELECT bot_id
  FROM strategy_runs
  GROUP BY bot_id
  HAVING COUNT(*) = 1
) AS only_one ON only_one.bot_id = single.bot_id
WHERE f.bot_id = single.bot_id
  AND f.run_id IS NULL;
