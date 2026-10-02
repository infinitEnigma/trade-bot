-- Migration: 017_accounting_pnl_split.sql
-- Phase 5 of the remediation ledger (PROJECT_REVIEW_GAP_ANALYSIS §4 row 5,
-- finding N6): accounting correctness.
--
-- The engine's POSITION_UPDATED report now splits PnL in two: `pnl` is
-- *realised* PnL net of fees (the same number `bot_trade_fills.pnl` sums to)
-- and `unrealized_pnl` is the mark-to-market of the open inventory at
-- `mark_price`. `bot_positions.pnl` already carries the realised half; this
-- migration adds the unrealised half so the split survives ingest.
--
-- `bot_instances.total_pnl` deliberately stays ledger-derived (see migration
-- 016): POSITION_UPDATED and PERFORMANCE_SNAPSHOT are projections and must
-- never move the authoritative totals.
--
-- Ordering is rerun-safe: ADD COLUMN IF NOT EXISTS and COMMENT ON are no-ops
-- on re-run, and the runner records the file only after every statement
-- succeeded.

ALTER TABLE bot_positions
  ADD COLUMN IF NOT EXISTS unrealized_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN bot_positions.pnl IS
  'Realised PnL net of fees — reconciles with SUM(bot_trade_fills.pnl) (N6).';
COMMENT ON COLUMN bot_positions.unrealized_pnl IS
  'Mark-to-market PnL of the open inventory at mark_price (N6 split).';