-- Migration: 024_ledger_incomplete_pnl_docs.sql
--
-- Follow-up to 023 (financial-plane review P1/P2):
-- - 023's header and the `total_pnl_incomplete_fills` column comment call the
--   known-PnL sum a "lower bound". That claim is mathematically unsound: an
--   omitted fill (unknown fee/PnL stored NULL) may have been a LOSS, in which
--   case the known-only sum OVERSTATES true PnL. Correct the semantics to
--   INCOMPLETE with unknown direction — every surface rendering `total_pnl`
--   with a non-zero counter must say "incomplete / N fills unknown", never
--   "≥" / "lower bound" / net PnL.
-- - Mark pre-023 rows as legacy accounting: 023 backfilled
--   `fee_is_estimate = true` for ALL rows with a fee, so exact pre-023 fees
--   are indistinguishable from estimates. Those rows stay estimates (the
--   honest default) and must never be mistaken for verified exact fees.
-- - This migration only rewrites comments (no data change) and is rerun-safe.
--
-- Verification:
--   SELECT col_description('bot_instances'::regclass,
--     (SELECT attnum FROM pg_attribute
--       WHERE attrelid = 'bot_instances'::regclass
--         AND attname = 'total_pnl_incomplete_fills'));
--   -- must contain 'INCOMPLETE' and must NOT contain 'lower bound'.

COMMENT ON COLUMN bot_instances.total_pnl_incomplete_fills IS
  'Fills booked with unknown pnl (NULL). Non-zero means total_pnl sums KNOWN fills only and is INCOMPLETE with unknown direction (never a lower bound: an omitted fill may have been a loss). Pre-023 rows collapsed unknowns to 0 and stay legacy accounting.';

COMMENT ON COLUMN bot_trade_fills.fee_is_estimate IS
  'true when fee is an upper-bound estimate (taker rate / unmapped tier), false when sourced as the exact published rate. All pre-023 rows read true by backfill (legacy) and must not be mistaken for verified exact fees.';
