-- Migration: 013_bot_account_binding.sql
-- C3 of the DB redesign (EXCHANGE_INTEGRATION_PLAN §3 / DATA_MODEL §4.2, §5).
--
-- Scope (draft / expand phase — no drops, no NOT NULL yet):
-- - Add nullable `bot_instances.exchange_account_id` FK -> exchange_accounts(id).
-- - Backfill it: each bot binds to its owner's earliest ACTIVE account
--   (kodiak preferred — the only venue the engine resolves today — else any
--   ACTIVE account, earliest first). Bots with no ACTIVE account stay NULL;
--   the follow-up code PR requires an explicit account pick at bot creation
--   and a NOT NULL constraint once every row is bound.
-- - Create generic `exchange_positions` / `exchange_balances` keyed by
--   exchange_account_id (per-account, not per-user). Left empty: position /
--   balance rows are venue-synced caches, and legacy `kodiak_*` rows keyed by
--   (user_id, symbol/asset) are ambiguous when a user holds 2+ accounts, so
--   no row migration is attempted — the sync path repopulates them.
-- - Legacy `kodiak_accounts` / `kodiak_positions` / `kodiak_balances` /
--   `kodiak_statistics` are NOT dropped here; the drop lands after all
--   readers move (grep gate: `kodiak_positions|kodiak_balances` under
--   backend/src returns no hits).
--
-- Decisions (locked for C3):
-- - FK is ON DELETE RESTRICT: an account with bots bound cannot be hard-
--   deleted; revoke/disconnect must re-home or stop the bots first. The
--   revoke path enforces this in code (checks bot_instances).
-- - No `user_id` column on the new tables: ownership resolves via
--   exchange_accounts.user_id join. One fewer way to drift.
-- - Numeric shapes mirror the legacy `kodiak_positions` (001 + 003) and
--   `kodiak_balances` (001) columns so the sync code moves verbatim.

-- 1. Bot -> account binding (nullable during expand; NOT NULL in a later
--    migration once code always writes it).
ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS exchange_account_id UUID
    REFERENCES exchange_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_bot_instances_exchange_account_id
  ON bot_instances (exchange_account_id);

-- 2. Backfill: earliest ACTIVE account per user, kodiak first.
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

-- 3. Generic per-account positions (replaces `kodiak_positions`
--    UNIQUE(user_id, symbol) with UNIQUE(exchange_account_id, symbol)).
CREATE TABLE IF NOT EXISTS exchange_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_account_id UUID NOT NULL
    REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  position_qty DECIMAL(20, 8) NOT NULL DEFAULT 0,
  cost_position DECIMAL(20, 8) NOT NULL DEFAULT 0,
  average_open_price DECIMAL(20, 8) NOT NULL DEFAULT 0,
  mark_price DECIMAL(20, 8) NOT NULL DEFAULT 0,
  unsettled_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  pnl_24_h DECIMAL(20, 8) NOT NULL DEFAULT 0,
  leverage INTEGER NOT NULL DEFAULT 1,
  imr DECIMAL(20, 8) NOT NULL DEFAULT 0.1,
  mmr DECIMAL(20, 8) NOT NULL DEFAULT 0.05,
  est_liq_price DECIMAL(20, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exchange_account_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_exchange_positions_account_id
  ON exchange_positions (exchange_account_id);
CREATE INDEX IF NOT EXISTS idx_exchange_positions_symbol
  ON exchange_positions (symbol);

-- 4. Generic per-account balances (replaces `kodiak_balances`
--    UNIQUE(user_id, asset) with UNIQUE(exchange_account_id, asset)).
CREATE TABLE IF NOT EXISTS exchange_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_account_id UUID NOT NULL
    REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  asset VARCHAR(32) NOT NULL,
  holding DECIMAL(30, 8) NOT NULL DEFAULT 0,
  frozen DECIMAL(30, 8) NOT NULL DEFAULT 0,
  pending_short_qty DECIMAL(20, 8) NOT NULL DEFAULT 0,
  pending_long_qty DECIMAL(20, 8) NOT NULL DEFAULT 0,
  pnl_24_h DECIMAL(20, 8) NOT NULL DEFAULT 0,
  fee_24_h DECIMAL(20, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exchange_account_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_exchange_balances_account_id
  ON exchange_balances (exchange_account_id);
CREATE INDEX IF NOT EXISTS idx_exchange_balances_asset
  ON exchange_balances (asset);
