-- Migration: 021_drop_kodiak_status.sql
-- Residue cleanup (b): drop the unconsumed `kodiak_status` column from the
-- `user_trading_summary` view.
--
-- The column was emitted in 002 (legacy `kodiak_credentials` join) and
-- re-pointed at `exchange_accounts` in 012. Grep gate before this ships:
-- `user_trading_summary|kodiak_status` returns no hits under backend/src,
-- engine/src, frontend/src, shared/src (migrations + docs + README
-- checklist only) — no in-repo consumer exists.
--
-- Minimal change: the `kodiak_status` CASE is dropped. The now-unused
-- `exchange_accounts` LEFT JOIN is dropped with it: it joined on
-- `u.id = ea.user_id` (one-to-many), so it only ever multiplied rows that
-- the DISTINCT/aggregate layer collapsed again — removing it cannot change
-- the remaining aggregates. GROUP BY unchanged.
--
-- Postgres cannot drop a view column via CREATE OR REPLACE (error 42P16),
-- so DROP + CREATE. Rerun-safe: DROP IF EXISTS + CREATE is a no-op on
-- re-run, and the runner records the file only after every statement
-- succeeded. The runner executes one statement at a time (no transaction
-- wrap issue for DROP/CREATE VIEW).
DROP VIEW IF EXISTS user_trading_summary;
CREATE VIEW user_trading_summary AS
SELECT
  u.id as user_id,
  u.email,
  u.user_level,
  COUNT(DISTINCT s.id) as total_strategies,
  COUNT(DISTINCT bi.id) as total_bots,
  COUNT(t.id) as total_trades,
  COALESCE(SUM(t.pnl), 0) as total_pnl,
  COALESCE(AVG(t.pnl), 0) as avg_trade_pnl,
  MAX(t.executed_at) as last_trade_date
FROM users u
LEFT JOIN strategies s ON u.id = s.user_id
LEFT JOIN bot_instances bi ON u.id = bi.user_id
LEFT JOIN trades t ON u.id = t.user_id
GROUP BY u.id, u.email, u.user_level;
