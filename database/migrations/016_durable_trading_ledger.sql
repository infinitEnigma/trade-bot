-- Migration: 016_durable_trading_ledger.sql
-- Phase 4 of the remediation ledger (PROJECT_REVIEW_GAP_ANALYSIS §4, finding
-- N7): the durable order/fill ledger. The spoofable `POST /report-trade` path
-- was deleted in `132fbd1`, leaving the `TRADE_EXECUTED` event ingest as the
-- single trade-write path — this migration gives that path somewhere durable
-- and idempotent to write to.
--
-- Design (locked for Phase 4):
-- - `bot_trade_fills` is the authoritative, insert-only fill ledger. The
--   UNIQUE quadruple `(bot_id, client_order_id, exchange_order_id, fill_id)`
--   is the idempotency key: at-least-once event delivery (stream redelivery,
--   crash-mid-fill replay) collapses to exactly one row. `fill_id` is
--   engine-synthesized (sha256 over botId/clientOrderId/exchangeOrderId)
--   until a venue exposes real fill ids — it must stay deterministic so a
--   re-detected fill dedups (Gate 1 finding G1 booked the same fill twice
--   through the history lookup; the ledger makes the second booking a no-op).
-- - Identity (`user_id`, `strategy_id`) is denormalized by the writer from
--   `bot_instances` — never taken from the event payload (the deleted
--   report-trade route took them from the request body; that stays dead).
-- - `bot_instances.total_trades` / `total_pnl` are incremented by the writer
--   ONLY when the ledger insert actually inserted, so the totals always
--   reconcile with `SUM(bot_trade_fills.pnl)` (Phase 4 exit criterion).
--   PERFORMANCE_SNAPSHOT events are telemetry and never touch these totals.
-- - `bot_order_intents` persists order intent BEFORE `createOrder`, so a crash
--   between intent and submission leaves a durable record for reconciliation.
--   Slots reuse deterministic client-order ids across cycles, so the intent
--   row upserts; `state` never regresses from FILLED (a redelivered intent is
--   indistinguishable from a re-arm — the ledger, not this advisory state,
--   is the authority; a future per-cycle id component retires the ambiguity).
-- - `bot_positions` / `bot_performance_snapshots` are latest-per-key upserts
--   of what the engine reports (Phase 5 owns accounting correctness).
-- - `trades` keeps its existing CHECK vocabulary for display; the writer maps
--   engine fill status into it (`FILLED` → FILLED, `PARTIALLY_FILLED` →
--   PARTIAL) instead of widening the constraint.
--
-- Ordering is rerun-safe: CREATE TABLE/INDEX ... IF NOT EXISTS are no-ops on
-- re-run, and the runner records the file in `schema_migrations` only after
-- every statement succeeded.

-- 1. The fill ledger (idempotent, insert-only).
CREATE TABLE IF NOT EXISTS bot_trade_fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  -- Denormalized by the writer from bot_instances; NULL only if the column
  -- types ever outlive their referenced rows.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
  client_order_id VARCHAR(64) NOT NULL,
  exchange_order_id VARCHAR(255) NOT NULL,
  fill_id VARCHAR(255) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity DECIMAL(20, 8) NOT NULL CHECK (quantity > 0),
  price DECIMAL(20, 8) NOT NULL CHECK (price >= 0),
  fee DECIMAL(20, 8) NOT NULL DEFAULT 0,
  pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  -- Narrowed from the engine vocabulary: FILLED | PARTIAL (see header).
  status VARCHAR(20) NOT NULL CHECK (status IN ('FILLED', 'PARTIAL')),
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ingested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_bot_trade_fills_unique
    UNIQUE (bot_id, client_order_id, exchange_order_id, fill_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_trade_fills_bot_executed_at
  ON bot_trade_fills (bot_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_trade_fills_strategy
  ON bot_trade_fills (strategy_id, executed_at DESC)
  WHERE strategy_id IS NOT NULL;

-- 2. Order intent — written BEFORE createOrder (intent-before-create).
CREATE TABLE IF NOT EXISTS bot_order_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  client_order_id VARCHAR(64) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price DECIMAL(20, 8) NOT NULL,
  quantity DECIMAL(20, 8) NOT NULL CHECK (quantity > 0),
  state VARCHAR(20) NOT NULL
    CHECK (state IN ('INTENDED', 'FILLED'))
    DEFAULT 'INTENDED',
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_bot_order_intents_bot_client_order
    UNIQUE (bot_id, client_order_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_order_intents_bot_state
  ON bot_order_intents (bot_id, state);

-- 3. Latest engine-reported position per (bot, symbol).
CREATE TABLE IF NOT EXISTS bot_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('LONG', 'SHORT', 'FLAT')),
  quantity DECIMAL(20, 8) NOT NULL,
  entry_price DECIMAL(20, 8) NOT NULL,
  mark_price DECIMAL(20, 8) NOT NULL,
  pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_bot_positions_bot_symbol UNIQUE (bot_id, symbol)
);

-- 4. Latest engine-reported performance counters per bot (telemetry — never
--    feeds bot_instances totals).
CREATE TABLE IF NOT EXISTS bot_performance_snapshots (
  bot_id UUID PRIMARY KEY REFERENCES bot_instances(id) ON DELETE CASCADE,
  total_trades INTEGER NOT NULL DEFAULT 0,
  total_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  win_rate DECIMAL(10, 6),
  max_drawdown DECIMAL(20, 8),
  profit_factor DECIMAL(20, 8),
  sharpe_ratio DECIMAL(20, 8),
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
