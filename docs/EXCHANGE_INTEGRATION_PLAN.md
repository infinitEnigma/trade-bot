# Exchange Integration & Data Model — Execution Plan

**Status:** A, B and C executed — **C1 (identity), C2 (wallets + exchange accounts) and C3 (bot→account binding + per-account data tables) landed**; **D (bot account sessions) and E (agent participation) are designed and not implemented** (§D, §E).
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
C3. bot→account + data tables  (1 d)    ── PR 3 of 3  (engine gets a real account) ✅ landed
        │
D. bot account sessions        (2-3 d)  ── bot = one exchange account, N strategies  ⬜ designed
        │
E. agent participation         (1.5-2 d)── advisor → coordinator → executor, engine stays the only executor  ⬜ designed
```

A and B are **engine-side**; C is **backend/DB**; D changes the schema _and_ the
engine runtime; E is a new backend read/command surface with delegated grants. C3 is
the only step that changes what A's contract is fed from — the engine must not need
edits then. D simplifies that further: the account session is the credential unit, so
one fetch serves every run inside it.

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

The accounting track added one more **optional** member: `getFeeRates?()` →
`ExchangeFeeRates` (venue-reported account maker/taker rates). Optional
because only a venue that publishes an account fee tier can answer it — an
absent method means "unknown", never "fee-free" (decision N6a in
`PROJECT_REVIEW_GAP_ANALYSIS.md`).

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

Two further venue rules were pinned live on 2026-09-30 (M1, evidence
`.git/gatelogs/prod/27-p4-m1-live-fix2.log`, logged in the M1 row of
`docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md`):

- **`client_order_index` ≤ 281474976710655 (2^48 − 1).** A larger index is
  refused by `create-order` ("ClientOrderIndex should not be larger than
  281474976710655") and 400s `accountOrders?client_order_indexes=` (`20001
  invalid param : invalid client order index`) — hence
  `LIGHTER_CLIENT_ORDER_INDEX_MOD = 2 ** 48` in `client-order-id.ts`.
- **`time_in_force: 0` (IOC) requires `order_expiry: 0`** ("OrderExpiry is
  invalid" otherwise), while GTT requires a positive ms timestamp. The engine's
  panic flatten is a MARKET → IOC limit, and the sidecar normalises the expiry
  per TIF (`SignerService._resolve_expiry`).

Fee sourcing (accounting track, added 2026-10-02): `fees.ts` maps the account
tier reported by `GET /api/v1/accountLimits` (auth) onto the published rates —
Standard 0 / 0, Plus 0.005% both sides, Premium 0.0040% maker / 0.0280% taker
(undiscounted; the LIT-stake discount is not applied, so the number is an upper
bound). No Lighter REST tape carries a per-fill fee and market metadata reads
`0.0000` everywhere (decision N6a), so `LighterClient.getFeeRates()`
(TTL-cached, fails loudly) is the engine's only fee source.

Booking (N6 core, added 2026-10-02) — how the grid uses those rates:

- A fill's fee is `executedPrice × quantity × takerRate`. The **taker** rate is
  used because the venue never reports whether a fill was maker or taker, and
  the taker rate is the upper bound of the two (overstating a fee understates
  profit, the safe direction). A rate that cannot be sourced leaves the fill's
  `fee` *and* `pnl` absent — never a made-up `0`.
- Realised PnL is booked per leg so the Phase-4 ledger invariant
  `SUM(bot_trade_fills.pnl) == bot_instances.total_pnl` stays exact: an entry
  BUY books `0 - fee` (its spread is unrealised until the exit) and the closing
  SELL books `(sellExec − entryExec) × quantity - fee`.
- The exit is priced one grid step above the level (`levels[i+1].price`, or one
  spacing above the top line) or `takeProfitPercent` above the **executed**
  entry when the strategy configures a take profit; an exit that would price at
  or below the entry is never armed (the level is left unarmed and logged).
- `PositionReport.pnl` is realised PnL net of fees; `unrealizedPnl` marks the
  open inventory at the ticker price. Both are stored (`bot_positions.pnl`,
  `unrealized_pnl` — migration `017_accounting_pnl_split.sql`).
- Exit legs are **reduce-only** (added 2026-10-02): `ExchangeOrderRequest`
  (and the adapter-side `OrderRequest`) carries `reduceOnly`, Orderly's
  documented `reduce_only` is mapped (`payload.ts`), and Lighter forwards it
  through the signing sidecar (which already accepted it). The grid sets it
  `true` on the SELL leg via `OrderReconciliationService.ensureSlotOrder`, so a
  stale sell can never open a short. Ordinary orders omit the key entirely, so
  entry placements keep the exact pre-N6 wire body.

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
email + password login stays exactly as it was; `username` is an _additive_
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
- **Acceptance:** a bot binds to exactly one owned **ACTIVE**
  `exchange_accounts` row and `/credentials/:botId` issues **that row's own**
  envelope (kodiak or lighter) — the property C3a establishes is per-bot credential
  identity, not concurrency. The same strategy traded on two accounts therefore
  produces two bots, each carrying its own account's envelope; they are created
  **sequentially** today, because a bot _is_ a running strategy and only one bot per
  strategy may be active at a time (`findActiveBotForStrategy` → 409). Trading
  several strategies for one account concurrently is the account-session model in
  §D. Negatives: a foreign or non-ACTIVE account is refused (404/400), and revoking
  an account with bots bound is refused with a clear 409 (`boundBots`). An _unbound_
  bot cannot exist: migration `014` made `bot_instances.exchange_account_id`
  `NOT NULL` and its guard refuses to run while any bot is unbound, so the pre-C3a
  "unbound legacy bot" is a historical state rather than a reachable one (the
  `/credentials` 409 for it remains as defence in depth).
- **Status (2026-09-27):** the blockers recorded on 2026-09-26 are all resolved — L1
  (the frontend called `/api/bot/{instances,start,stop,emergency-stop}` while the
  routes are mounted under `/management`, so all four 404'd), L2 (the Dashboard
  pinned the portfolio to a kodiak account) and L11 (the portfolio endpoints were
  kodiak-only, so a connected Lighter account rendered empty). The acceptance run
  and its evidence are recorded in
  [PROJECT_REVIEW_GAP_ANALYSIS.md](PROJECT_REVIEW_GAP_ANALYSIS.md) §4.

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

## D. Bot account sessions — bot = account, N strategies (design; not implemented)

**Goal:** the unit of execution becomes the **exchange account**, not the strategy:
one bot per `(user, exchange_accounts)` row, running **N strategies** at once.
Schema, rationale and the decision record: [DATA_MODEL.md](DATA_MODEL.md) §4.4 and
its §9.

Why this axis: the account already owns everything account-shaped — the credential
envelope (C3a), the position/balance rows and the venue sync (C3b), the exchange
connection, and the order-reconciliation state the N3/N4 work has to own. Today a
second strategy on the same account means a second bot, a second credential fetch
and a second reconciler pointed at the same account. Collapsing that is cheaper,
and it is also the shape agents need (§E).

### D1 — schema (`015_bot_account_sessions.sql`)

| Change                | Detail                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot_instances`       | drop `strategy_id`; the session identity is `(user_id, exchange_account_id)`; partial unique index `bot_instances_one_live_per_account` on `exchange_account_id` `WHERE actual_state IN ('STARTING','RUNNING')`                 |
| `strategy_runs` (new) | `(bot_id, strategy_id, config, config_version, notional_amount, state, last_error_code)` exactly as sketched in DATA_MODEL §4.4, with `UNIQUE(bot_id, strategy_id)` plus a partial unique index (`strategy_id` in one live run) |
| Backfill              | one run per existing bot (1:1 today) carrying its `strategy_id` and notional; test users only, so a clean cut like C1-C3b                                                                                                       |
| Guard                 | refuse the migration while any bot's `strategy_id` belongs to another user, mirroring the `014` guard style                                                                                                                     |

### D2 — backend

| File                                                 | Change                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/bots/lifecycle/bot-lifecycle.repository.ts`    | `findActiveBotForStrategy` → `findLiveSessionForAccount`; `insertBotInstance` drops `strategyId`; `strategy_runs` attach/detach/state accessors                     |
| `core/bots/lifecycle/bot-command-dispatcher.ts`      | `START_BOT` becomes the session command; new `START_STRATEGY` / `STOP_STRATEGY` carry `runId`                                                                       |
| `core/bots/bot-lifecycle.service.ts`                 | `createAndStart(userId, exchangeAccountId, runs[])`, plus `startStrategy` / `stopStrategy` per run; session state stays CAS-guarded                                 |
| `core/bots/lifecycle/strategy-active-sync.ts`        | deleted — `strategies.active` becomes derived ("has a live run") and the four call sites go with it                                                                 |
| `interfaces/http/bots/management.ts`                 | `POST /start { exchangeAccountId, runs: [{ strategyId, notionalAmount }] }`, `POST /runs`, `DELETE /runs/:runId`; `GET /instances` returns sessions with their runs |
| `interfaces/http/bots/engine.ts`                     | unchanged — the envelope is already issued per bound account                                                                                                        |
| `interfaces/http/trading/market-portfolio.routes.ts` | unchanged — the readers are already account-keyed (C3b)                                                                                                             |

### D3 — engine

| File                                            | Change                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `shared/src/types/engine-contract.ts`           | `START_STRATEGY` / `STOP_STRATEGY` commands; `BotStatus.runs[]`; `START_BOT` no longer carries `strategyId` |
| `engine/src/domain/bot-runtime.ts`              | `runs: Map<runId, { strategyId, strategy, stopTick }>` instead of a single `strategy`                       |
| `engine/src/application/bot-manager.ts`         | one credential fetch and one exchange client per session; a runtime, runner and snapshot per run            |
| `engine/src/application/strategy-runner.ts`     | unchanged apart from being keyed by `runId`                                                                 |
| `engine/src/infrastructure/state/grid-state.ts` | snapshot path `<botId>/<runId>.json`, with a read fallback for the legacy `<botId>.json`                    |

### D4 — frontend

- Strategies: "Start" becomes **attach to a session** — pick the account once,
  attach/detach strategies, per-run size; the badge follows the run state.
- Bots: the account session becomes first-class (one card per account with its
  runs, aggregate PnL and per-run state).
- `getBotForStrategy` / `useBotLifecycle` (today `bot.strategy_id === …`) resolve
  through runs.

**Acceptance:** two strategies attached to one account session run concurrently
through a single credential fetch and a single exchange connection; detaching one
leaves the other running; the same strategy cannot be attached to two live sessions
(409); a second session on the same account is refused (409, partial unique index);
`strategies.active` reflects run state with no write path; two runs' grid snapshots
stay independent across an engine restart.

**Estimate:** 2-3 days, staged D1 schema → D2 backend → D3 engine runtime → D4 UI,
each independently releasable as C1-C3 were.

---

## E. Agent participation — advisor → coordinator → executor (design; not implemented)

**Goal:** let external agents (LLM-driven or otherwise) participate in trading
**without ever touching the order path**. Three escalating stages, each a separate
capability, so a user can adopt one and ignore the next. Nothing here is a new
abstraction over the engine: an agent's actions are the commands a user can already
issue, gated by a grant and audited.

| Stage           | Capability                                                                                    | Acts how                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Advisor**     | read one account session: positions, balances, runs, PnL, fills and the lifecycle event trail | writes `agent_proposals` only — inert until the user approves                                               |
| **Coordinator** | the above plus attach/detach strategies and set run sizing **within user-approved bounds**    | issues `START_STRATEGY` / `STOP_STRATEGY` through `BotLifecycleService`, audit-stamped with its agent id    |
| **Executor**    | —                                                                                             | the engine _is_ the executor: an agent never signs, never holds credentials and never sends a venue request |

### E1 — identity, delegation, audit

| File                                    | Change                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/index.ts`                   | `UserRole` gains `AGENT_ADVISOR` / `AGENT_COORDINATOR`, ranked below `QUALIFIED_ALPHA`                                                                                                                                                                                                                                                          |
| `016_agent_participation.sql` (planned) | `agents (id, owner_user_id, name, kind, status)`, `agent_grants (agent_id, user_id, exchange_account_id, capability, max_notional, expires_at, revoked_at)`, `agent_proposals (id, agent_id, bot_id, payload JSONB, status, decided_by, decided_at)`, `agent_actions (id, agent_id, grant_id, action, payload JSONB, result JSONB, created_at)` |
| `interfaces/http/agents/*.ts` (new)     | service-token auth in the style of `botEngineAuth`; every route resolves a **grant** and refuses without one                                                                                                                                                                                                                                    |
| audit                                   | every agent action is recorded like `bot_lifecycle_events`, carrying `agent_id` and the user it acted for                                                                                                                                                                                                                                       |

### E2 — read surface (advisor)

Wraps what C3b/C3 already produces: `GET /api/market/{positions,balance,trades}?exchangeAccountId=`,
session/run state, the lifecycle trail, and (once ledger row 4 lands) fills. The
agent reads the **account-scoped** view, which is why §D is a prerequisite — an
advisor's unit of reasoning is the session, not a strategy in isolation.

### E3 — proposal and approval flow

`agent_proposals` do nothing until a user approves them; the approval is recorded in
`agent_actions` and executed through the same lifecycle service a human command
uses. A coordinator's unattended actions are bounded by `agent_grants`
(`capability`, `max_notional`, `expires_at`) and refused once the grant is revoked.

**Guardrails (extends §0):** credentials never leave the backend — agents see
aggregates, never envelopes; no agent writes `bot_instances` / `strategy_runs`
directly, only through `BotLifecycleService`; every capability is scoped to one
account and expires.

**Acceptance:** an advisor token reads one granted account's session and cannot read
another account's; a proposal has no effect until approved; a coordinator grant with
`max_notional: 500` cannot attach a run sized 5000 (403 + audit row); revoking the
grant denies the next call immediately; no agent credential or envelope ever appears
in a log.

**Estimate:** 1.5-2 days for E1-E3 (advisor + proposal/approval), with coordinator
capabilities on top.

---

## 4. Interlocks and ordering rules

| Rule                                                             | Why                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A lands before B's `BotManager` wiring                           | the factory must exist before a second venue is registered                                                                                     |
| B1 (`ExchangeClient` extension) lands before B3/B4               | the strategy must be typed against the interface before another implementation exists                                                          |
| B must not read `bot_instances` or credential columns directly   | keeps C3 a data-source swap                                                                                                                    |
| C1 → C2 → C3, one PR each, in that order                         | each slice is independently releasable and revertible                                                                                          |
| C2 depends on nothing in B; C3 depends on B and A                | C can start any time after A if Lighter work is paused                                                                                         |
| Ledger rows updated in the same commit as the code they describe | CONTRIBUTING rule                                                                                                                              |
| D lands before E (agents)                                        | an agent's unit of reasoning is the account session, not a strategy — building E on the bot-per-strategy axis would only need re-scoping later |
| D lands after C3 but before the N3/N4 reconciliation work        | reconciliation state becomes per account, so the session should own it — otherwise the reconciler is built twice                               |
| E must not add venue or engine paths                             | an agent action is an existing lifecycle command behind a grant; the engine keeps its single control plane                                     |

## 5. Risks and mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baking Lighter fields into the Orderly credential shape                                    | Guardrail 1 + the A slice landing first                                                                                                                                                                                 |
| `grid.ts` staying coupled to `OrderlyClient`                                               | B4 is an explicit deliverable; the fake-exchange tests only compile if the strategy is interface-typed                                                                                                                  |
| Two symbol conventions (`PERP_BTC_USDC` vs `ETH`)                                          | Adapter-owned `market-map.ts`; unknown symbol ⇒ `CommandError`, never a guessed market                                                                                                                                  |
| Client-order-id formats differ (string ≤36 vs int64)                                       | `client-order-id.ts` exposes one derivation per representation, both unit-tested for stability across restarts                                                                                                          |
| Eventually-consistent cancel/query (verified in Phase 0)                                   | Poll with bounded retries in the client; the reconciler treats mid-flight results as `UNRESOLVED`, never as "absent"                                                                                                    |
| Sidecar downtime                                                                           | `UNREACHABLE` ⇒ slot freeze; health probe + OPERATIONS runbook entry                                                                                                                                                    |
| C1 breaks many auth suites at once                                                         | Slice is self-contained (legacy exchange tables untouched); run the suite and update expectations in the same PR                                                                                                        |
| Dropping vendor tables in C3 while something still reads them                              | Grep gate + integration suite before the drop; the drop is its own statement at the end of the migration                                                                                                                |
| Drops `bot_instances.strategy_id` while readers still use it                               | Grep gate (`strategy_id` in backend + engine + frontend) plus the suites before the drop; staged D1→D2 so the drop is its own statement, as with the `014` table drops                                                  |
| `<botId>.json` snapshots orphaned by the `<botId>/<runId>.json` layout                     | D3 reads the legacy path as a fallback during the transition and the fallback is removed in its own commit with a note in OPERATIONS                                                                                    |
| One live session per account blocks a legitimate use case (e.g. a hedge across strategies) | The session, not the account, owns the cap: extra exposure is expressed as another run inside the same session, never as a second session on one account                                                                |
| Agent capability creep (an advisor quietly becoming an executor)                           | Separate roles with explicit, expiring grants; no agent code path reaches the signer or an exchange client; every action lands in `agent_actions`                                                                       |
| A workspace's build output is never _loaded_, so a config change ships broken (L17)        | Every acceptance run starts each process with its documented command (`npm run prod`, `npm run prod:engine`, the sidecar) before any UI check, so a load failure surfaces in minutes rather than at the first bot start |

## 6. Estimates

| Step | Scope                                                    | Estimate |
| ---- | -------------------------------------------------------- | -------- |
| A    | credential-contract slice                                | 0.5 d    |
| B    | Lighter adapter + interface + signer wiring + tests      | 2-3 d    |
| C1   | identity (username login, identities)                    | 1 d      |
| C2   | wallets + exchange accounts (+ adapters, UI)             | 1.5 d    |
| C3   | bot → account binding + data tables                      | 1 d      |
| D    | bot account sessions (schema → backend → engine → UI)    | 2-3 d    |
| E    | agent participation (identity/grants + read + proposals) | 1.5-2 d  |

## 7. Definition of done (per step)

1. Code, tests, and docs updated in the same commit; all four gates green
   (`format:check`, `lint`, `build`, `CI=true npm test`).
2. Phase-0-verified exchange facts encoded (not re-derived from documentation).
3. No exchange name outside its adapter; no vendor name in a new schema object.
4. Ledger row in `PROJECT_REVIEW_GAP_ANALYSIS.md` §4 moved to ✅ with the commit
   reference, then moved to the archived cycle document once closed (the live
   §4 tracks open work only), and `OPERATIONS.md` runbooks updated when
   behaviour changes (sidecar down, account revoked, credential source swap).
5. Acceptance claims that depend on a live venue are recorded as a run (date,
   environment, evidence) rather than asserted — the D and E steps inherit the
   §4 batch-verification pattern.
6. Agent-facing work (E): every capability scoped to one account and expiring, every
   action audited, and no credential, envelope or venue request reachable from an
   agent payload.
