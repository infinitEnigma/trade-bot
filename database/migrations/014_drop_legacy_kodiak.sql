-- Migration: 014_drop_legacy_kodiak.sql
-- C3b of the DB redesign (EXCHANGE_INTEGRATION_PLAN §3 C3b / DATA_MODEL §5).
--
-- Scope (the "contract" half of C3b — the reader migration landed in code):
-- - Re-run the C3a binding backfill, then make
--   `bot_instances.exchange_account_id` NOT NULL: every code path that
--   creates a bot writes it (C3a start flow), so only legacy rows can be
--   unbound, and this migration refuses to proceed while any remain.
-- - Drop the legacy per-user `kodiak_*` tables:
--     kodiak_positions, kodiak_balances, kodiak_statistics, kodiak_accounts.
--   Safe because (all verified live immediately before this file):
--     * no code reads or writes them — grep gate: zero hits for
--       `kodiak_positions|kodiak_balances` (and `kodiak_accounts|kodiak_statistics`)
--       under backend/src; the readers moved to `exchange_positions` /
--       `exchange_balances` and the credentials to `exchange_accounts` (C2);
--     * all four were empty (the legacy "sync" never wrote — the writer was
--       a no-op) — nothing is migrated, the C3b venue sync repopulates
--       `exchange_*` from live venue reads;
--     * no foreign key points at them (information_schema check).
--
-- Ordering is rerun-safe (the runner executes statements one by one, ledger
-- recorded only after the whole file succeeds): backfill and guard are
-- idempotent, `SET NOT NULL` on an already NOT NULL column is a no-op, and
-- every drop is IF EXISTS — a partial run converges on the next attempt.

-- 1. Backfill any bot that became bindable after 013 (same ranking as 013:
--    earliest ACTIVE account, kodiak preferred).
UPDATE bot_instances bi
SET exchange_account_id = ranked.id
FROM (
  SELECT DISTINCT ON (ea.user_id) ea.user_id, ea.id
  FROM exchange_accounts ea
  WHERE ea.status = 'ACTIVE'
  ORDER BY ea.user_id,
    CASE ea.exchange WHEN 'kodiak' THEN 0 ELSE 1 END,
    ea.created_at ASC, ea.id ASC
) AS ranked
WHERE bi.user_id = ranked.user_id
  AND bi.exchange_account_id IS NULL;

-- 2. Refuse to tighten/drop while a bot is still unbound — a bot without an
--    account must be stopped and deleted (or its owner must connect an
--    ACTIVE account) rather than left to trade an unknown account.
DO $$
DECLARE
  unbound integer;
BEGIN
  SELECT COUNT(*) INTO unbound
  FROM bot_instances
  WHERE exchange_account_id IS NULL;
  IF unbound > 0 THEN
    RAISE EXCEPTION
      'C3b: % bot instance(s) still unbound (owner has no ACTIVE exchange account) — stop/delete them or connect an account, then re-run',
      unbound;
  END IF;
END $$;

-- 3. The binding becomes mandatory.
ALTER TABLE bot_instances
  ALTER COLUMN exchange_account_id SET NOT NULL;

-- 4. Drop the legacy tables (indexes and comments go with them).
DROP TABLE IF EXISTS kodiak_positions;
DROP TABLE IF EXISTS kodiak_balances;
DROP TABLE IF EXISTS kodiak_statistics;
DROP TABLE IF EXISTS kodiak_accounts;