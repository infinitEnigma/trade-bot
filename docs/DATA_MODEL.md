# Data Model: Identity, Wallets & Exchange Accounts

**Status:** design proposal — nothing here is implemented yet.

This document describes the target data model for user identity, wallets, and
exchange accounts, why the current schema cannot express it, and the phased path
to get there. It exists because the Lighter.xyz integration (Phase 1 of the
exchange work) cannot be built honestly on a schema that assumes **one exchange
account per user**.

| Question                            | Document                                                         |
| ----------------------------------- | ---------------------------------------------------------------- |
| What is the system?                 | [README](../README.md)                                           |
| How does it work?                   | [ARCHITECTURE.md](ARCHITECTURE.md)                               |
| How do we run and recover it?       | [OPERATIONS.md](OPERATIONS.md)                                   |
| How did we get here / what remains? | [PROJECT_REVIEW_GAP_ANALYSIS.md](PROJECT_REVIEW_GAP_ANALYSIS.md) |
| Identity/accounts data model        | this document                                                    |

---

## 1. Drivers

1. **A user has many wallets.** The product already links wallets for the
   `BASIC → REGISTERED` step; multi-chain and multi-wallet (hot/cold, per-chain)
   is expected.
2. **A user has many exchange accounts.** Same user, several venues and
   environments (e.g. Lighter testnet + Lighter mainnet + a Kodiak account).
3. **A user should log in with a username (nick).** Email is one identity among
   several, alongside wallet, and later social providers.
4. **The platform is chain- and exchange-agnostic.** Today one exchange's name is
   baked into table names, validation rules, and the engine credential contract.
5. **A bot must know which account it trades.** Bots currently reference only
   `strategy_id` + `user_id`, so the engine cannot be told which account to use.

---

## 2. Current state (verified against the schema and code)

### `users` — migration `001`, level constraint fixed in `006`

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,          -- login identifier
  password_hash VARCHAR(255) NOT NULL,         -- always required
  user_level VARCHAR(20) DEFAULT 'BASIC'
    CHECK (user_level IN ('BASIC', 'REGISTERED', 'VERIFIED')),
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

- Login is email + password only: `AuthService.register(email, password)`
  (`backend/src/core/auth/auth.service.pure.ts:107`), `login({ email, password })`
  via `findByEmailWithPassword` (`:188`), routes `/api/auth/register|login`, and
  the Joi schemas `validators.register` / `validators.login`
  (`backend/src/interfaces/middleware/validation.middleware.ts:216-229`).
- Profile update can change the email
  (`backend/src/interfaces/http/users/profile.ts:23`, `user-profile.service.ts:241`).
- JWT claims carry `email`: `TokenPayload { userId, email }`
  (`shared/src/types/infrastructure.ts:543`).

### `wallet_addresses` — migration `010`

```sql
CREATE TABLE wallet_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  verified BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ ..., updated_at TIMESTAMPTZ ...,
  UNIQUE(user_id),        -- one wallet per user
  UNIQUE(wallet_address)  -- an address belongs to one user
);
```

No chain/network column, no label, no primary flag, no verification method.

### `kodiak_credentials` — migrations `001`, `004`

```sql
CREATE TABLE kodiak_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  account_id VARCHAR(255) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  secret_key_encrypted TEXT NOT NULL,
  wallet_signature TEXT,
  wallet_address VARCHAR(255),
  verified BOOLEAN DEFAULT FALSE,
  encryption_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ ..., updated_at TIMESTAMPTZ ...,
  UNIQUE(user_id),     -- one exchange account per user
  UNIQUE(account_id)   -- an exchange account belongs to one user
);
```

Behaviour coupled to it:

- Orderly-specific validation lives in the connection service
  (`backend/src/infrastructure/external/kodiak-connection.service.ts:275-312`):
  `accountId.length >= 10`, `apiKey` must start with `ed25519:`,
  `secretKey.length >= 30`.
- Connect is all-or-nothing: credentials are rolled back if verification fails
  (`:103-127`).
- Disconnect deletes the row and downgrades the user level (`:191-230`); status
  reads a single row (`:235-257`).
- Verification state feeds `user_level` through a join in
  `getAuthenticatedUserData` (`user-repository.adapter.ts:246-250`).

### Vendor-named data tables

| Table               | Key assumption                                                    |
| ------------------- | ----------------------------------------------------------------- |
| `kodiak_accounts`   | `UNIQUE(user_id)`                                                 |
| `kodiak_positions`  | `UNIQUE(user_id, symbol)` — positions per _user_, not per account |
| `kodiak_balances`   | keyed by `user_id`                                                |
| `kodiak_statistics` | `UNIQUE(user_id)`                                                 |
| `trades`            | `user_id` + optional `strategy_id`/`bot_id`; no account reference |

### `bot_instances` / `strategies` — migrations `001`, `003`, `007`

`bot_instances(strategy_id, user_id, desired_state, actual_state, engine_id, …)`
and `strategies(user_id, type, config JSONB, active)` have **no exchange or
account reference**.

### Engine credential contract

`FetchCredentialsResult { accountId, accessKey, secretKey }`
(`engine/src/domain/bot-runtime.ts:30-34`) is fetched from
`GET /api/bot/engine/credentials/:botId`
(`backend/src/interfaces/http/bots/engine.ts:180-256`), which returns the single
decrypted credential set for the bot's owner, at most once per
`(botId, correlationId)`.

---

## 3. Problems this creates

| #   | Problem                                     | Consequence                                                                                                                               |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `kodiak_credentials UNIQUE(user_id)`        | A user cannot hold two exchange accounts, or the same venue on two environments (mainnet + testnet)                                       |
| P2  | Vendor-named tables + Orderly validation    | Lighter credentials (`accountIndex`, `apiKeyIndex`, `privateKey`, `env`) fit nowhere; each new venue would need a new table and endpoints |
| P3  | `wallet_addresses UNIQUE(user_id)`          | One wallet per user; no chain column, so the same address on two chains cannot be represented, and there is no primary-wallet concept     |
| P4  | Identity == email                           | No username/nick, no path for social logins; email is required, and JWT claims carry it                                                   |
| P5  | No bot → account link                       | The engine cannot know which account a bot trades; `/credentials/:botId` has no account parameter                                         |
| P6  | `user_level` derived from a vendor join     | With several accounts, one revoked account would flip the whole user, and per-account status is invisible                                 |
| P7  | Positions/balances keyed by `user_id`       | `UNIQUE(user_id, symbol)` collides when two accounts hold the same symbol                                                                 |
| P8  | Disconnect deletes credentials + downgrades | Disconnecting one account must be per-account, audited, and must not change global level unless no verified account remains               |

---

## 4. Target model

### 4.1 Shape

```
users ──┬──< user_identities     (password / email / google / github / x / discord)
        ├──< wallets              (chain-aware, many per user, one primary)
        ├──< exchange_accounts    (many venues/environments per user)
        │        ├──< exchange_positions
        │        ├──< exchange_balances
        │        └──< trade_fills   (P1 durable ledger)
        ├──< strategies
        └──< bot_instances ──> exchange_accounts   (which account a bot trades)
```

---

### 4.2 Table sketches

```sql
-- Identity: who can log in.
ALTER TABLE users
  ADD COLUMN username     VARCHAR(32),        -- login handle (lowercase, unique)
  ADD COLUMN display_name VARCHAR(64),
  ADD COLUMN avatar_url   TEXT,
  ALTER COLUMN email DROP NOT NULL,           -- email becomes an identity row
  ALTER COLUMN password_hash DROP NOT NULL;   -- wallet-only users have no password

CREATE TABLE user_identities (
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

-- Wallets: chain-aware, many per user.
CREATE TABLE wallets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain               VARCHAR(32) NOT NULL,   -- 'evm' | 'solana' | ...
  chain_id            BIGINT,                 -- when the chain has a numeric id
  address             TEXT NOT NULL,
  label               VARCHAR(64),
  is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at         TIMESTAMPTZ,
  verification_method VARCHAR(32),            -- 'signed_message' | 'exchange_api'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, address)                     -- an address belongs to one user per chain
);

-- Exchange accounts: any venue, any environment; credentials validated per venue.
CREATE TABLE exchange_accounts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange               VARCHAR(32) NOT NULL,  -- 'kodiak' | 'lighter' | ...
  environment            VARCHAR(16) NOT NULL,  -- 'mainnet' | 'testnet'
  account_ref            TEXT NOT NULL,         -- Orderly accountId / Lighter accountIndex
  label                  VARCHAR(64),
  status                 VARCHAR(16) NOT NULL DEFAULT 'PENDING', -- PENDING|ACTIVE|INVALID|REVOKED
  credentials_ciphertext TEXT,                  -- encrypted JSON envelope (see 4.3)
  encryption_version     INTEGER NOT NULL DEFAULT 2,
  meta                   JSONB NOT NULL DEFAULT '{}',  -- non-secret: fees, leverage, markets
  verified_at            TIMESTAMPTZ,
  last_synced_at         TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange, environment, account_ref)
);

-- Bot → account binding (backfilled, then NOT NULL).
ALTER TABLE bot_instances
  ADD COLUMN exchange_account_id UUID REFERENCES exchange_accounts(id);
```

Partial unique indexes to add alongside: one primary wallet per user, one
primary identity per user.

### 4.3 Credential storage

One encrypted JSON envelope per account, decrypted only in memory:

```jsonc
// kodiak / orderly
{ "v": 1, "exchange": "kodiak",  "accountId": "...", "apiKey": "ed25519:...", "secretKey": "..." }
// lighter
{ "v": 1, "exchange": "lighter", "accountIndex": 404, "apiKeyIndex": 4, "privateKey": "..." }
```

Per-exchange **adapters** own validation and shape — this is where the existing
Orderly rules move out of the connection service — so adding a venue never
touches the schema. Secrets never enter `meta` or logs; `encryption_version`
reuses the existing version-aware encryption service.

---

## 5. Derived semantics (must be centralised)

| Concept            | Rule                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_level`       | `BASIC` = account + password identity only · `REGISTERED` = ≥1 verified wallet · `VERIFIED` = ≥1 `ACTIVE` verified exchange account. Computed by one service on any change (wallet link/unlink, account connect/verify/revoke/disconnect) and cached — never by ad-hoc joins in request handlers |
| Per-account status | `exchange_accounts.status` is authoritative per account (`PENDING` → `ACTIVE` → `INVALID`/`REVOKED`); a failed re-verification invalidates only that account                                                                                                                                     |
| Bot startability   | A bot may start only when its bound account is `ACTIVE` **and** the engine reports support for that exchange + environment                                                                                                                                                                       |
| Disconnect         | Per-account, audited, keeps history; level is recomputed rather than force-downgraded                                                                                                                                                                                                            |
| Login              | Username + password by default; any verified identity of the user is an alternative login path                                                                                                                                                                                                   |

### 5.1 Engine credential contract (v2)

```jsonc
// GET /api/bot/engine/credentials/:botId
// → { success, data: { exchange, environment, accountRef, credentials } }
{
  "exchange": "lighter",
  "environment": "testnet",
  "accountRef": "404",
  "credentials": { "accountIndex": 404, "apiKeyIndex": 4, "privateKey": "..." },
}
```

Still out-of-band, still at-most-once per `(botId, correlationId)`, still never
through Redis Streams. The engine's `FetchCredentialsResult` becomes a
discriminated union keyed by `exchange`, and `BotManager` picks the client
(Kodiak today, Lighter next) from it instead of always calling
`createOrderlyClient(...)`.

---

## 6. Migration strategy (two options)

Both options produce the same target model; they differ in how much legacy
compatibility code we carry.

**Option A — expand/contract (safe, keeps every row)**

1. `011_identity_accounts.sql`: create `user_identities`, `wallets`,
   `exchange_accounts`; add `users.username`; backfill from `users`,
   `wallet_addresses`, `kodiak_credentials`; add nullable
   `bot_instances.exchange_account_id` and backfill it.
2. Ship dual-read/dual-write: services read the new tables and keep writing
   legacy columns until readers are migrated.
3. `012_constraints.sql`: make `username` / `exchange_account_id` NOT NULL, add
   partial unique indexes, drop `UNIQUE(user_id)` constraints.
4. `013_retire_legacy.sql`: drop `wallet_addresses`, `kodiak_credentials` and the
   vendor-named data tables once nothing reads them.

_Cost:_ three migrations plus temporary dual-write code. _Benefit:_ no data loss,
reversible at every step.

**Option B — clean cut (dev-only data)**

A single `011_identity_accounts.sql` that creates the new model, backfills what
exists, and drops the legacy tables in the same file; all code switches in one
PR. _Cost:_ no rollback path; real user data would need a manual export/import.
_Benefit:_ no compatibility layer, roughly half the work.

> Recommendation: **A** if this database is — or will soon be — shared with real
> users; **B** if it is still a throwaway development database. The engine and
> frontend work is identical either way.

---

## 7. Phased workstream

| Phase | Scope                                                                                                                 | Acceptance                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | Schema + backfill (Option A steps 1-3, or Option B)                                                                   | Migrations apply on a copy of the dev DB; row counts match; `npm run db:status` clean                                |
| 2     | Identity layer: `user_identities` repository, username register/login/availability, email as identity, profile update | Register and log in by username; changing email no longer touches the login handle; JWT claims updated; suites green |
| 3     | Wallets: multi-wallet CRUD, chain-aware link/unlink, primary wallet, level recompute                                  | Link two wallets on different chains, unlink one, level recomputed correctly, UI shows both                          |
| 4     | Exchange accounts: generic connect/verify/list/disconnect + per-exchange adapters (Kodiak moved, Lighter added)       | Connect a real Lighter testnet account **and** a second account; both listed; verify/disconnect audited per account  |
| 5     | Bot → account binding: bot creation UI + API, engine credentials v2 + client selection                                | The same strategy started on two accounts runs two bots against different accounts                                   |
| 6     | Data-table generalisation: `exchange_positions`/`exchange_balances` replace `kodiak_*`; retire vendor-named tables    | Positions and balances are per account; two accounts holding the same symbol both display correctly                  |

Phases 1-4 are prerequisites for the Lighter engine work (extended
`ExchangeClient` + `LighterClient`); Phase 5 is what lets the engine trade a
specifically chosen account.

---

## 8. Impact inventory

| Area     | Touches                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database | New migration(s); `scripts/drop-tables.ts`, `scripts/migration-status.ts`, `src/database/validate-schema.ts`, seed data                                                                                                                                                                          |
| Backend  | `core/auth/auth.service.pure.ts`, `user-repository.adapter.ts`, `user-profile.service.ts`, `external/kodiak-connection.service.ts`, `interfaces/http/{auth,users,bots}`, `shared/validation/schema-validation-middleware.ts`, DI container, and the Jest suites that assert on `query()` strings |
| Shared   | `User`, `UserRegistration`, `UserLogin`, `KodiakConnectionRequest`, `TokenPayload`, `IUserRepository`, `KodiakCredentials`, frontend-backend contract types                                                                                                                                      |
| Engine   | `protocol/credential-fetcher.ts`, `domain/bot-runtime.ts` (`FetchCredentialsResult`), `application/bot-manager.ts` (client factory)                                                                                                                                                              |
| Frontend | Register/Login (username), Settings (account list), wallet dialog (multi-wallet), profile (identities), API clients and their tests                                                                                                                                                              |
| Docs     | `ARCHITECTURE.md` §6/§8, `OPERATIONS.md` (env/credentials), this file, gap-analysis ledger row                                                                                                                                                                                                   |

Migration-author note: `005_performance_indexes.sql` uses
`CREATE INDEX CONCURRENTLY`, which the runner executes standalone (outside a
transaction) — new migrations should avoid mixing `CONCURRENTLY` with statements
that assume a surrounding transaction.

---

## 9. Decisions needed

1. **Migration strategy** — Option A (expand/contract) or Option B (clean cut)?
2. **Username rules** — length/charset, reserved words, case-insensitive uniqueness, and whether it is changeable.
3. **Email login during transition** — keep email + password working until social identities land, or switch to username-only immediately?
4. **Wallet as login** — should a verified wallet also be usable as a login method, or stay link/verification only?
5. **Default account** — with several accounts, is one marked default for quick bot creation, or must every bot explicitly choose?
