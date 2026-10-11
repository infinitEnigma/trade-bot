-- Migration: 023_ledger_unknown_fee_pnl.sql
--
-- Financial-plane finding F2: the engine omits `fee`/`pnl` from TRADE_EXECUTED
-- when the venue's fee rate cannot be sourced (N6: "absence means unknown,
-- never fee-free"), but the Phase-4 schema coerced that absence to zero —
-- `fee`/`pnl` were NOT NULL DEFAULT 0 and the writer flattened `undefined` to
-- 0. A fill whose entry fee was unknown therefore disappeared from the
-- accounting while its known exit fee stayed, overstating net profit.
--
-- This migration preserves the known-zero vs unknown distinction:
-- - `bot_trade_fills.fee`/`pnl` become nullable. NULL = unknown; 0 stays a
--   sourced zero (e.g. Lighter's zero-fee standard tier). No existing row is
--   rewritten: pre-023 rows recorded a value for every fill by construction.
-- - `fee_is_estimate` records fee provenance (F5): false = the rate was the
--   venue's exact published rate (ExchangeFeeRates.exact); true = an upper
--   bound (taker-rate estimate, unmapped tier, unapplied discount). Every
--   pre-023 fee was `notional × takerRate` with no provenance carried, so
--   all existing rows are marked as estimates — the honest default.
-- - `bot_instances.total_pnl_incomplete_fills` counts the fills whose pnl
--   arrived unknown. `total_pnl` keeps summing only KNOWN pnl
--   (`SUM(pnl) WHERE pnl IS NOT NULL`); the counter is what tells a reader
--   the total is a lower bound, not net PnL. Any surface that shows
--   `total_pnl` must treat a non-zero counter as "incomplete".
-- - Legacy `trades.fee`/`trades.pnl` are already nullable (001/003:
--   `DECIMAL(20,8) DEFAULT 0` without NOT NULL), so the writer can store the
--   same NULLs there without DDL; the DEFAULT only applies to inserts that
--   omit the column, which this writer never does.
--
-- Ordering is rerun-safe: all statements are idempotent (ADD COLUMN IF NOT
-- EXISTS, SET on a constant rewrites no rows in effect), and the runner
-- records the file only after every statement succeeded.

-- 1. Nullable fee/pnl on the ledger: unknown is representable.
ALTER TABLE bot_trade_fills ALTER COLUMN fee DROP DEFAULT;
ALTER TABLE bot_trade_fills ALTER COLUMN fee DROP NOT NULL;
ALTER TABLE bot_trade_fills ALTER COLUMN pnl DROP DEFAULT;
ALTER TABLE bot_trade_fills ALTER COLUMN pnl DROP NOT NULL;

-- 2. Fee provenance (F5). All pre-023 fees are taker-rate estimates.
ALTER TABLE bot_trade_fills
  ADD COLUMN IF NOT EXISTS fee_is_estimate BOOLEAN NOT NULL DEFAULT false;
UPDATE bot_trade_fills SET fee_is_estimate = true WHERE fee IS NOT NULL;

-- 3. Incompleteness counter on the authoritative bot totals.
ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS total_pnl_incomplete_fills INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN bot_trade_fills.fee IS
  'Venue fee for this fill (notional x rate). NULL = unknown rate, never zero.';
COMMENT ON COLUMN bot_trade_fills.pnl IS
  'Realised PnL net of fees contributed by this fill. NULL = unknown (fee unsourced); total_pnl sums only known values.';
COMMENT ON COLUMN bot_trade_fills.fee_is_estimate IS
  'true when fee is an upper-bound estimate (taker rate / unmapped tier), false when sourced as the exact published rate.';
COMMENT ON COLUMN bot_instances.total_pnl_incomplete_fills IS
  'Fills booked with unknown pnl. Non-zero means total_pnl is a lower bound of realised PnL, not net PnL.';
