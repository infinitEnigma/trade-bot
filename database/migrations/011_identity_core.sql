-- Migration: 011_identity_core.sql
-- C1 of the DB redesign (EXCHANGE_INTEGRATION_PLAN §3 / DATA_MODEL §4.2).
--
-- Adds the username handle, creates user_identities, and backfills both for
-- existing users. Deliberate deviation from the DATA_MODEL §4.2 sketch:
-- email and password_hash KEEP their NOT NULL constraints — login remains
-- email + password (revised C1 decision); dropping them is only needed for
-- wallet-only users and lands with D4 (wallet login), not here.

-- 1. Identity columns on users. username stays nullable at the DB level so
--    legacy INSERT paths without a handle keep working; application code
--    (register) always writes it.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username     VARCHAR(32),
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(64),
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT;

-- 2. Backfill: derive a handle for every existing user from the email local
--    part. Rule (must stay in sync with AuthService's derivation):
--    lowercase local part -> strip [^a-z0-9._-] -> take 24 chars -> empty
--    becomes 'user' -> collisions get a numeric suffix, total length <= 32.
DO $$
DECLARE
  u        RECORD;
  base     TEXT;
  candidate TEXT;
  n        INT;
BEGIN
  FOR u IN SELECT id, email FROM users WHERE username IS NULL ORDER BY created_at, id LOOP
    base := left(
      regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9._-]', '', 'g'),
      24
    );
    IF base = '' THEN
      base := 'user';
    END IF;

    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM users x WHERE lower(x.username) = lower(candidate)
    ) LOOP
      n := n + 1;
      candidate := left(base, 32 - length(n::text)) || n::text;
    END LOOP;

    UPDATE users SET username = candidate WHERE id = u.id;
  END LOOP;
END $$;

-- 3. Case-insensitive uniqueness (handles are stored lowercase; the lower()
--    index also catches any strays). After the backfill, never before.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (LOWER(username));

-- 4. Identity rows: who can log in (DATA_MODEL §4.2 columns, verbatim).
CREATE TABLE IF NOT EXISTS user_identities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      VARCHAR(32) NOT NULL,   -- 'password' | 'email' | 'google' | 'github' | 'x' | 'discord'
  identifier    TEXT NOT NULL,          -- lowercased email / provider subject
  secret_hash   TEXT,                   -- password provider only
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at   TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, identifier)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
  ON user_identities(user_id);

-- 5. Backfill one password identity per existing user. identifier = the login
--    handle (lowercased email); verified_at = now() because a stored hash IS
--    a working credential. provider='email' rows are NOT created here — they
--    appear when the user edits their email (identity edit), and email
--    verification itself is a later phase (users.email_verified drives it).
INSERT INTO user_identities (user_id, provider, identifier, secret_hash, is_primary, verified_at)
SELECT id, 'password', lower(email), password_hash, TRUE, now()
FROM users
WHERE email IS NOT NULL AND password_hash IS NOT NULL
ON CONFLICT (provider, identifier) DO NOTHING;
