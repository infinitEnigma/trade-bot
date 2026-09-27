-- Migration: 012_wallets_exchange_accounts.sql
-- C2 of the DB redesign (EXCHANGE_INTEGRATION_PLAN §3 / DATA_MODEL §4.3-§4.4).
--
-- Replaces the single-row legacy tables with chain-aware multi-wallets and
-- generic venue/environment exchange accounts, then drops the legacy tables
-- (clean cut, Option B — test users only, no dual-write).
--
-- Decisions (locked before implementation):
-- - Q1: single `credentials_encrypted` JSON envelope, encrypted with
--   `encryptWithVersion()`. Kodiak = {accountId, apiKey, secretKey},
--   Lighter = {accountIndex, apiKeyIndex, privateKey}. No per-venue columns.
-- - Q2: clean cut — legacy routes die in the same PR as these tables.
-- - Q3: closed chain set ('evm','solana','bitcoin'); per-chain address
--   validation lives in backend code, not in CHECK constraints.
--
-- Backfill notes (read before "fixing" them):
-- - `wallets` take `chain='evm'` (the only chain the old flow verified) and
--   the single linked address becomes the primary wallet.
-- - `exchange_accounts` take `environment='mainnet'`: the legacy table stored
--   no environment, and production keys are the only assumption that keeps
--   C3's engine lookup safe. Testnet rows are re-created via the new
--   connect flow. Every backfilled row carries
--   `meta={"backfilled":true,"legacyEnv":"unknown"}` so C3 can spot them.
-- - Credential ciphertexts CANNOT be re-encrypted here (SQL has no keys), so
--   backfilled rows store the wrapper JSON itself (`kind='kodiak-legacy'`)
--   whose fields are the untouched legacy ciphertext blobs — still
--   AES-256-GCM ciphertext, only re-housed as JSON. `encryption_version` is
--   carried over verbatim. The credentials provider JSON-parses the wrapper
--   and decrypts each blob with the existing per-field logic; the next
--   verify/connect lazily rewrites the row into a full single-envelope
--   encryption (kind='kodiak').

-- 1. Chain-aware multi-wallets: one primary per user, same address allowed
--    on different chains and across users (the old global UNIQUEs are gone).
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('evm', 'solana', 'bitcoin')),
  address TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chain, address)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_primary
  ON wallets (user_id) WHERE is_primary;

-- 2. Generic exchange accounts: many per user, venue + environment addressed.
--    `exchange` reuses the EngineCredentials ExchangeKind vocabulary
--    ('kodiak' | 'lighter'); a new venue extends the CHECK, never adds a
--    column (Guardrail 1). No vendor names in table/column names (Guardrail 3).
CREATE TABLE IF NOT EXISTS exchange_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL CHECK (exchange IN ('kodiak', 'lighter')),
  environment TEXT NOT NULL CHECK (environment IN ('testnet', 'mainnet')),
  account_ref TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  encryption_version INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'INVALID', 'REVOKED')),
  verified_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange, environment, account_ref)
);

CREATE INDEX IF NOT EXISTS idx_exchange_accounts_user_id
  ON exchange_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_exchange_accounts_user_status
  ON exchange_accounts (user_id, status);

-- 3. Backfill wallets: the single linked address becomes the primary wallet.
INSERT INTO wallets (user_id, chain, address, is_primary, verified_at, created_at, updated_at)
SELECT
  user_id,
  'evm',
  lower(wallet_address),
  TRUE,
  CASE WHEN verified THEN COALESCE(updated_at, now()) ELSE NULL END,
  COALESCE(created_at, now()),
  COALESCE(updated_at, now())
FROM wallet_addresses
ON CONFLICT (user_id, chain, address) DO NOTHING;

-- 4. Backfill exchange accounts: one row per legacy credential set.
--    `encryption_version` is carried over verbatim so rotation history
--    survives; see the header note on the wrapper envelope.
INSERT INTO exchange_accounts (
  user_id, exchange, environment, account_ref,
  credentials_encrypted, encryption_version, status,
  verified_at, meta, created_at, updated_at
)
SELECT
  user_id,
  'kodiak',
  'mainnet',
  account_id,
  json_build_object(
    'v', 1,
    'kind', 'kodiak-legacy',
    'accountId', account_id,
    'apiKeyCipher', api_key_encrypted,
    'secretKeyCipher', secret_key_encrypted
  )::text,
  encryption_version,
  CASE WHEN verified THEN 'ACTIVE' ELSE 'PENDING' END,
  CASE WHEN verified THEN COALESCE(updated_at, now()) ELSE NULL END,
  '{"backfilled":true,"legacyEnv":"unknown"}',
  COALESCE(created_at, now()),
  COALESCE(updated_at, now())
FROM kodiak_credentials
ON CONFLICT (user_id, exchange, environment, account_ref) DO NOTHING;

-- 5. Clean cut: drop the legacy tables in the same migration. The grep gate
--    before this ships is `kodiak_credentials|wallet_addresses` returning no
--    hits under backend/src (only docs may mention them as history).
--    `user_trading_summary` (002) JOINed the legacy table, so re-point it at
--    `exchange_accounts` first — connection status from any ACTIVE account.
CREATE OR REPLACE VIEW user_trading_summary AS
SELECT
  u.id as user_id,
  u.email,
  u.user_level,
  COUNT(DISTINCT s.id) as total_strategies,
  COUNT(DISTINCT bi.id) as total_bots,
  COUNT(t.id) as total_trades,
  COALESCE(SUM(t.pnl), 0) as total_pnl,
  COALESCE(AVG(t.pnl), 0) as avg_trade_pnl,
  MAX(t.executed_at) as last_trade_date,
  CASE WHEN COUNT(ea.id) FILTER (WHERE ea.status = 'ACTIVE') > 0
    THEN 'CONNECTED' ELSE 'NOT_CONNECTED' END as kodiak_status
FROM users u
LEFT JOIN strategies s ON u.id = s.user_id
LEFT JOIN bot_instances bi ON u.id = bi.user_id
LEFT JOIN trades t ON u.id = t.user_id
LEFT JOIN exchange_accounts ea ON u.id = ea.user_id
GROUP BY u.id, u.email, u.user_level;

DROP TABLE IF EXISTS wallet_addresses;
DROP TABLE IF EXISTS kodiak_credentials;
