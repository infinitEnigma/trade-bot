# Exchange Integration & Data Model — Execution Plan

**Status:** A, B and C executed — **C1 (identity), C2 (wallets + exchange accounts) and C3 (bot→account binding + per-account data tables) landed**.
**Companion docs:** [DATA_MODEL.md](DATA_MODEL.md) (target schema + why),
[PROJECT_REVIEW_GAP_ANALYSIS.md](PROJECT_REVIEW_GAP_ANALYSIS.md) (ledger),
[ARCHITECTURE.md](ARCHITECTURE.md) (current design),
[OPERATIONS.md](OPERATIONS.md) (run/recover).

---

## Sequence

```
A. credential-contract slice   (0.5 d)  ── stops the wrong shape being baked in
        │
B. Lighter engine adapter      (2-3 d)  ── verified against testnet (Phase 0 done)
        │
C1. identity (username handle) (1 d)    ── DB Option B, PR 1 of 3  ✅ landed
C2. wallets + exchange accounts(1.5 d)  ── PR 2 of 3  (adapter-based credentials) ✅ landed
C3. bot→account + data tables  (1 d)    ── PR 3 of 3  (engine gets a real account)
```

A and B are **engine-side**; C is **backend/DB**. C3 is the only step that
changes what A's contract is fed from — the engine must not need edits then.

---

## 0. Guardrails (violating any of these is what creates future rework)

1. **No exchange-specific fields in the credential contract.** New venue ⇒ new
   union member, never new optional fields on an existing member.
2. **No exchange names outside `engine/src/exchanges/**` and their backend
   adapters.** The strategy, `BotManager`, and the reconciliation layer speak
   `ExchangeClient` only.
3. **No vendor names in new table or column names** (the legacy `kodiak_*` tables
   are the exception and are scheduled for retirement in C3).
4. **Every step lands with its tests and its docs in the same commit** — the
   existing gate plus the CONTRIBUTING docs rule.

---

## 1. Workstream A — credential-contract slice (≈0.5 day)

**Goal:** the engine's credential contract becomes exchange-agnostic _before_
Lighter code exists, so the DB redesign later swaps only a data source.

| File                                           | Change                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/types/engine-credentials.ts` (new) | `ExchangeKind = "kodiak" \| "lighter"`; `EngineCredentials` discriminated union: `{ exchange, environment, accountRef, credentials }`; per-exchange credential payloads; `isEngineCredentials()` type guard                                              |
| `backend/src/interfaces/http/bots/engine.ts`   | `/credentials/:botId` returns the new envelope — today reading the single `kodiak_credentials` row: `exchange: "kodiak"`, `environment` from `NODE_ENV`, `accountRef: account_id`. Guards and the at-most-once `CREDENTIALS_ISSUED` marker are unchanged |
| `engine/src/domain/bot-runtime.ts`             | `FetchCredentialsResult` becomes the shared `EngineCredentials` union                                                                                                                                                                                    |
| `engine/src/protocol/credential-fetcher.ts`    | Validate the envelope with the type guard; reject malformed payloads before they reach the client factory                                                                                                                                                |
| `engine/src/exchanges/factory.ts` (new)        | `createExchangeClient(credentials)` → Kodiak returns `OrderlyClient`; unknown/unsupported exchange throws `CommandError(retryable: false, "UNSUPPORTED_EXCHANGE")`                                                                                       |
| `engine/src/application/bot-manager.ts`        | Replace `createOrderlyClient(...)` with the factory; keep the existing cancel checks between steps                                                                                                                                                       |

**Tests:** union guard accepts both shapes and rejects malformed ones; factory
returns `OrderlyClient` for `kodiak`; unknown exchange produces a clean
`COMMAND_FAILED` + `STATE_CHANGED → ERROR` (not an unhandled throw); existing
credential-fetch tests updated to the new shape.

**Acceptance:** bots start exactly as today against the Kodiak payload; a
hand-crafted `exchange: "lighter"` payload reaches the factory and fails cleanly
until B lands; all four gates green.

**What changes later (C3):** inside the backend handler only — the account row
lookup replaces the single-credential lookup, and `accountRef`/`environment` come
from `exchange_accounts`. No engine edit.

---

## 2. Workstream B — Lighter engine adapter (≈2-3 days)

Phase 0 already verified the contract live on testnet; B implements against those
findings, not against the published docs.

### B1 — extend `ExchangeClient` (`engine/src/domain/exchange.ts`)

| Addition                                           | Shape                                                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listOpenOrders(symbol)`                           | `ExchangeOpenOrder[]` — the startup orphan cross-check source                                                                                                                      |
| `queryOrderByClientOrderId(symbol, clientOrderId)` | `OrderLookup` = `FOUND_OPEN \| FOUND_FILLED \| FOUND_CANCELED \| NOT_FOUND \| UNREACHABLE` — **never `null`**, so "definitively absent" is distinguishable from "we could not ask" |
| `cancelOrder(...)`                                 | resolves only when the exchange confirms the cancellation                                                                                                                          |
| HTTP timeouts                                      | every request (axios currently has **none** — a hung socket would stall the single-flight tick forever)                                                                            |

`OrderlyClient` implements the additions with its own semantics (string
`client_order_id` ≤36 chars, `GET /v1/orders` listing) so the adapter keeps
compiling and stays the reference implementation.

### B2 — signer plumbing (sidecar already exists)

| File                                                        | Change                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `engine/src/domain/signer.ts` (new)                         | `TransactionSigner` interface (`createOrder`, `cancelOrder`, `authToken`)                                                      |
| `engine/src/infrastructure/signer/lighter-sidecar.ts` (new) | HTTP client for `sidecar/lighter-signer` — timeout, health probe, optional bearer token, credentials per request, never logged |
| `.env.example`                                              | `LIGHTER_SIDECAR_URL`, `SIDECAR_AUTH_TOKEN` (already added) get documented in OPERATIONS                                       |

Sidecar unavailability maps to `UNREACHABLE` at the caller, which freezes affected
slots instead of re-placing orders.

### B3 — `LighterClient` (`engine/src/exchanges/lighter/`)

| File                 | Responsibility                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`          | `ExchangeClient` implementation over REST + sidecar: `/info` connectivity, `orderBooks` + `orderBookDetails` market resolution, `accountActiveOrders`, `accountOrders?client_order_indexes=`, create/cancel via sidecar                                             |
| `status-map.ts`      | Normalise Lighter statuses → canonical (`open`→`OPEN`, `canceled`→`CANCELED`, `filled`→`FILLED`, unknown→`UNRESOLVED`) — the vocabulary verified in Phase 0                                                                                                         |
| `client-order-id.ts` | Deterministic key derivation: one pure function per representation (Orderly's ≤36-char string, Lighter's int64 index) from `(botId, levelIndex, side)`; both stable across restarts, unit-tested. **Landed for Orderly (ledger 1)** as `<botKey>-<level(base36)>-<B | S>`; the Lighter int64 derivation follows in workstream B |
| `market-map.ts`      | Symbol → `market_id` + price/size decimals, cached with a TTL; unknown symbol ⇒ clean `CommandError`                                                                                                                                                                |

Phase 0 facts the implementation must encode: cancel/query are **eventually
consistent** (poll, don't one-shot); a duplicate `client_order_index` is
**accepted idempotently** (adopt the existing live order, never assume rejection);
`market_id` is the order identifier (4095 for testnet ETH).

### B4 — strategy decoupling

`engine/src/strategies/grid.ts` currently imports the concrete `OrderlyClient`
type. It must depend on `ExchangeClient` only — this is what makes a second venue
possible at all. The reconciliation state machine
(`OrderManager` + `OrderReconciliationService`, ledger rows 2-3) then consumes
`queryOrderByClientOrderId`/`listOpenOrders` rather than implementing failure
semantics inline.

### B5 — verification

- **Jest:** fake exchange with scripted responses (accept-then-drop, timeout, 500,
  `NOT_FOUND`, duplicate-id acceptance, partial fill) — no network.
- **Testnet smoke (env-gated, skips without credentials):** place a resting limit
  far from mark, query it by client order id, cancel with polling confirmation —
  the Phase 0 flow, now driven through the engine's own client.
- **Gates:** `format:check`, `lint`, `build`, `CI=true npm test`.

**Acceptance:** a bot configured with `exchange: "lighter"` + testnet env resolves
its market, places a resting order, reports `STATE_CHANGED → RUNNING`, and
survives an engine restart with slot state intact; duplicate placement never
creates a second live order.

---

## 3. Workstream C — DB redesign, Option B, staged in three PRs (≈3.5 days)

Design and rationale: [DATA_MODEL.md](DATA_MODEL.md) §4-§6. Test users only, so
each PR is a clean cut for its own slice: no dual-write, re-seed test accounts.

### C1 — identity: username handle + `user_identities` (≈1 day) — ✅ **landed**

**Revised during execution** (recorded in [DATA_MODEL.md](DATA_MODEL.md) §9 D2/D3):
email + password login stays exactly as it was; `username` is an *additive*
handle, not a login credential yet, and email verification is a later phase.
This removed the `TokenPayload` swap, the login-form rewrite, and the
`email: string | null` ripple from the slice.

- `011_identity_core.sql`: add `users.username` (+ unique index on
  `LOWER(username)`), `display_name`, `avatar_url`; create `user_identities`
  (DATA_MODEL §4.2 columns, `UNIQUE (provider, identifier)`); backfill one
  `password` identity per existing user (identifier = lowercased email) and a
  username derived from the email local part (de-duplicated with a numeric
  suffix). **`users.email` / `password_hash` keep `NOT NULL`** — dropping them
  is only needed for wallet-only users and moves to the D4 (wallet login)
  phase.
- Code: `auth.service.pure.ts` (`register(email, password, username?)` — the
  handle is validated, rejected when taken, or derived from the email local
  part with the backfill's numeric-suffix rule), `user-repository.adapter.ts`
  (`findByUsername`, user + password-identity insert in one CTE statement,
  `upsertEmailIdentity`), validators (`commonSchemas.username`), `/api/auth/register`
  passes the optional handle through, profile email edit mirrors an `email`
  identity row, `getAuthenticatedUserData` / `/auth/me` / profile responses
  carry `username`, plus the auth/user Jest suites. **Login, `TokenPayload`,
  and the auth middleware are untouched.**
- Frontend: Register gains an optional Username field; **Login is unchanged**;
  profile page and header show the handle.
- **Legacy tables stay** (`kodiak_credentials`, `wallet_addresses`) so level logic
  is untouched in this PR.
- **Acceptance:** register with and without a username; login/logout/profile
  round-trip by email; a legacy test user keeps logging in after the username
  backfill; gates green.

### C2 — wallets + exchange accounts (≈1.5 days)

- `012_wallets_exchange_accounts.sql`: create `wallets` (chain-aware, many per
  user, one primary) and `exchange_accounts` (generic venue/environment,
  encrypted credential envelope, status, meta); backfill from `wallet_addresses`
  and `kodiak_credentials`; drop both legacy tables.
- Per-exchange **adapters** own credential validation and payload shape — the
  Orderly rules move out of `kodiak-connection.service.ts`, a Lighter adapter is
  added (`accountIndex`, `apiKeyIndex`, `privateKey`, `env`).
- New `ExchangeAccountService` (connect / verify / list / revoke / disconnect per
  account) + a single `UserLevelService` computing
  `BASIC → REGISTERED → VERIFIED` from wallets/accounts (replacing the ad-hoc join
  in `getAuthenticatedUserData`).
- Frontend: Settings lists all accounts with per-account verify/disconnect;
  wallet widget handles several wallets.
- **Acceptance:** one user holds two Lighter testnet accounts + two wallets on
  different chains; revoking one account does **not** drop the user's level while
  another verified account remains; all actions audited per account.

### C3 — bot → account binding + data-table generalisation

C3 is deliberately split into two PRs: the two halves have different risk
profiles (an engine-adjacent credential swap vs. a wide reader migration) and
different revert costs, so each must be independently releasable and revertible.

#### C3a — bot → account binding (✅ landed)

- `013_bot_account_binding.sql`: nullable `bot_instances.exchange_account_id`
  (`ON DELETE RESTRICT`) backfilled to each owner's earliest ACTIVE account
  (kodiak preferred); creates `exchange_positions` / `exchange_balances` **empty**
  and drops nothing. `NOT NULL` and the legacy drops were deferred to C3b on
  purpose — the backfill leaves `NULL` for bots whose owner has no ACTIVE
  account yet — and landed in `014_drop_legacy_kodiak.sql`.
- Code: `POST /api/bot/management/start` requires an owned **ACTIVE**
  `exchangeAccountId` (Joi + route + `createAndStart` defence in depth) and
  writes it on create;
  **`/credentials/:botId` swaps its data source to the bot's bound
  `exchange_accounts` row** and builds the per-venue envelope (kodiak +
  lighter) — the only engine-adjacent change, and it needs no engine edits (see
  Workstream A); `DELETE /api/accounts/:id` answers 409 while bots are bound
  (FK RESTRICT); the frontend picks the account (and notional size) before
  starting.
- **Acceptance:** the same strategy started on two different accounts runs two
  bots, and each engine credential fetch receives its own account's envelope;
  an unbound legacy bot gets 409 instead of trading the wrong account; revoking
  an account with bound bots is refused with a clear 409.
- **Status (2026-09-26):** the backend side is in place and unit-tested, but the
  acceptance run still cannot be performed from the UI: the frontend calls
  `/api/bot/{instances,start,stop,emergency-stop}` while the management routes are
  mounted under `/management` (`bots/index.ts:21`), so all four 404 (observed four
  times in `http-2026-09-26.log`, `11:14:25-32`). Decision: repoint the frontend
  and correct the docs instead of aliasing the routes (see
  [PROJECT_REVIEW_GAP_ANALYSIS.md](PROJECT_REVIEW_GAP_ANALYSIS.md) L1). The
  Dashboard also pins the portfolio to a **kodiak** account (L2), so a bot bound
  to a Lighter account would not even be visible until that lands.

#### C3b — positions/balances generalisation (✅ landed)

- **Readers moved** onto `exchange_positions` / `exchange_balances`:
  `position-repository.adapter` and `balance-repository.adapter` now join
  `exchange_accounts` for ownership (the `balances` table they used to read
  never existed), and `schema-validation-middleware`'s balance/position
  validators point at the new tables.
- **Venue sync** (`exchange-snapshot.adapter`): every successful
  authenticated venue read in `kodiak/private-data` replaces that account's
  rows — `exchange_positions` / `exchange_balances` fill up per account from
  live traffic (the legacy writer was a no-op, so all four `kodiak_*` tables
  were empty; nothing needed migrating).
- **Account-scoped display:** `GET /api/market/{positions,balance,trades}`
  accept `?exchangeAccountId=` (owned + kodiak + ACTIVE, else 400/404/409);
  cache keys carry the id, so two accounts of one user never serve each
  other's rows. The frontend picker on the Dashboard pins positions, trades
  and the app-global balance widget to the selected account.
- **`014_drop_legacy_kodiak.sql`:** re-runs the backfill, makes
  `bot_instances.exchange_account_id` `NOT NULL` (a guard refuses while any
  bot is unbound), and drops `kodiak_accounts` / `kodiak_positions` /
  `kodiak_balances` / `kodiak_statistics`. `backend/scripts/drop-tables.ts`
  (the missing `db:drop` target) now exists.
- **Gate:** `grep -rn 'kodiak_positions\|kodiak_balances' backend/src`
  returns **no hits** (was: `position-repository.adapter`,
  `schema-validation-middleware`).
- **Acceptance:** positions and balances display per account (Dashboard
  picker → `?exchangeAccountId=`); two accounts holding the same symbol both
  display correctly (`UNIQUE(exchange_account_id, symbol)`); ledger row 8
  closes.

---

## 4. Interlocks and ordering rules

| Rule                                                             | Why                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A lands before B's `BotManager` wiring                           | the factory must exist before a second venue is registered                            |
| B1 (`ExchangeClient` extension) lands before B3/B4               | the strategy must be typed against the interface before another implementation exists |
| B must not read `bot_instances` or credential columns directly   | keeps C3 a data-source swap                                                           |
| C1 → C2 → C3, one PR each, in that order                         | each slice is independently releasable and revertible                                 |
| C2 depends on nothing in B; C3 depends on B and A                | C can start any time after A if Lighter work is paused                                |
| Ledger rows updated in the same commit as the code they describe | CONTRIBUTING rule                                                                     |

## 5. Risks and mitigations

| Risk                                                          | Mitigation                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Baking Lighter fields into the Orderly credential shape       | Guardrail 1 + the A slice landing first                                                                              |
| `grid.ts` staying coupled to `OrderlyClient`                  | B4 is an explicit deliverable; the fake-exchange tests only compile if the strategy is interface-typed               |
| Two symbol conventions (`PERP_BTC_USDC` vs `ETH`)             | Adapter-owned `market-map.ts`; unknown symbol ⇒ `CommandError`, never a guessed market                               |
| Client-order-id formats differ (string ≤36 vs int64)          | `client-order-id.ts` exposes one derivation per representation, both unit-tested for stability across restarts       |
| Eventually-consistent cancel/query (verified in Phase 0)      | Poll with bounded retries in the client; the reconciler treats mid-flight results as `UNRESOLVED`, never as "absent" |
| Sidecar downtime                                              | `UNREACHABLE` ⇒ slot freeze; health probe + OPERATIONS runbook entry                                                 |
| C1 breaks many auth suites at once                            | Slice is self-contained (legacy exchange tables untouched); run the suite and update expectations in the same PR     |
| Dropping vendor tables in C3 while something still reads them | Grep gate + integration suite before the drop; the drop is its own statement at the end of the migration             |

## 6. Estimates

| Step | Scope                                               | Estimate |
| ---- | --------------------------------------------------- | -------- |
| A    | credential-contract slice                           | 0.5 d    |
| B    | Lighter adapter + interface + signer wiring + tests | 2-3 d    |
| C1   | identity (username login, identities)               | 1 d      |
| C2   | wallets + exchange accounts (+ adapters, UI)        | 1.5 d    |
| C3   | bot → account binding + data tables                 | 1 d      |

## 7. Definition of done (per step)

1. Code, tests, and docs updated in the same commit; all four gates green
   (`format:check`, `lint`, `build`, `CI=true npm test`).
2. Phase-0-verified exchange facts encoded (not re-derived from documentation).
3. No exchange name outside its adapter; no vendor name in a new schema object.
4. Ledger row in `PROJECT_REVIEW_GAP_ANALYSIS.md` §4 moved to ✅ with the commit
   reference, and `OPERATIONS.md` runbooks updated when behaviour changes
   (sidecar down, account revoked, credential source swap).
