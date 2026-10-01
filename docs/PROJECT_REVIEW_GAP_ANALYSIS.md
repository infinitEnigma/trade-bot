# Project Review & Gap Analysis

**How did we get here, and what remains?**

| Question                            | Document                           |
| ----------------------------------- | ---------------------------------- |
| What is the system?                 | [README](../README.md)             |
| How does it work?                   | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How do we run and recover it?       | [OPERATIONS.md](OPERATIONS.md)     |
| How did we get here / what remains? | this document                      |

This document tracks external reviews of the repository, verifies each claim
against the code (not against the READMEs), records the findings the reviews
missed, and maintains the remediation ledger. Historical review material stays
untracked under `docs/archived/`.

---

## 1. Latest review — 2026-09-20 (independent reviewer)

**Repository state reviewed:** `main` @ `c149711`, 268 commits, no open PRs,
4 closed PRs.

**Reviewer's summary:** the project moved from "distributed trading bot with
several reliability gaps" to "reasonably well-structured trading platform with a
functioning control plane and substantially improved engine reliability, but not
yet a fully durable trading system". The reviewer explicitly recommends **stopping
broad architectural refactoring** and instead exercising the system with
failure-injection/integration tests.

### Ratings

| Area                      |    Rating |
| ------------------------- | --------: |
| Repository structure      |    8.5/10 |
| Backend layering          |      8/10 |
| Backend ↔ Engine protocol |    8.5/10 |
| Lifecycle management      |    8.5/10 |
| Engine architecture       |      8/10 |
| Strategy execution        |      8/10 |
| Order idempotency         |    8.5/10 |
| Restart/recovery          |      7/10 |
| Trading-state durability  |    6.5/10 |
| Observability/operations  |      7/10 |
| Documentation             |      7/10 |
| **Overall**               | **~8/10** |

### Priority matrix (as reviewed)

| Priority | Item                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔴 P0    | Formalise exchange ↔ local order reconciliation (timeout after accept, crash mid-submit, missing/corrupt snapshot, orphan orders, partial fills, cancellation ambiguity) |
| 🟠 P1    | Move durable trading state (orders, fills, positions, trade events) toward PostgreSQL                                                                                    |
| 🟠 P1    | Atomic snapshot persistence (tmp + fsync + rename, versioned files, checksum)                                                                                            |
| 🟡 P2    | Durable event outbox (backend → external consumers)                                                                                                                      |
| 🟡 P2    | Documentation cleanup (this change)                                                                                                                                      |
| 🟢 P3    | Further abstraction — explicitly **not recommended yet**                                                                                                                 |

### Reviewer's suggested next abstraction

Introduce an explicit `OrderReconciliationService` inside the engine so the
strategy stops owning failure semantics:

```
GridStrategy  →  OrderManager  →  OrderReconciliationService  →  Exchange
(what should     (how orders      (what actually exists
 exist)           are represented   at the exchange)
                  locally)
```

---

## 2. Verification of the 2026-09-20 review against the code

Verified on 2026-09-20 against `main` @ `c149711` by reading the sources named
in the evidence column; the engine suite was re-run green (3 suites / 19 tests).

| #   | Reviewer claim                                                 | Verdict                           | Evidence                                                                                                                                                              |
| --- | -------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Architecture stabilized; stop refactoring                      | ✅ Confirmed                      | `engine/src/application/bot-manager.ts`, `strategy-runner.ts`; layered `protocol/` `domain/` `infrastructure/`                                                        |
| 2   | Lifecycle system is the strongest area                         | ✅ Confirmed                      | `backend/src/core/bots/lifecycle-reconciliation.service.ts`, `bot-lifecycle.service.ts`, migrations `007`, `008`                                                      |
| 3   | Redis Streams protocol is the strongest subsystem              | ✅ Confirmed (better than stated) | `engine/src/infrastructure/redis/streams.ts`: `XAUTOCLAIM` **plus** `XPENDING`/`XCLAIM` fallback, dedup `SET NX EX`, poison scan                                      |
| 4   | Engine decomposed into application/protocol/domain layers      | ✅ Confirmed                      | directory layout; `engine/src/index.ts` is bootstrap-only                                                                                                             |
| 5   | "Order idempotency is now a real property"                     | ⚠️ **Overstated**                 | Deterministic ID + get-before-create exist, but the create-order payload never carries `client_order_id` and the key exceeds the exchange's length limit — see N1, N2 |
| 6   | Persistent grid snapshot closed a major hole                   | ⚠️ Partially                      | `infrastructure/state/grid-state.ts`, `domain/grid-snapshot.ts`; no cross-check against exchange orders — see N4                                                      |
| 7   | Exchange↔local reconciliation is the biggest remaining problem | ✅ Confirmed, with concrete gaps  | Two unhandled branches in `strategies/grid.ts` — see N3, N5                                                                                                           |
| 8   | Snapshot durability should be upgraded                         | ✅ Confirmed verbatim             | `grid-state.ts` writes with plain `writeFile` — no temp/fsync/rename, no checksum                                                                                     |
| 9   | Accounting is separate from trading state                      | ✅ Confirmed — and understated    | The durable write path exists but is unreachable — see N7                                                                                                             |
| 10  | Frontend is not the priority                                   | ✅ Accepted                       | not disputed                                                                                                                                                          |
| 11  | `shared` should stay contracts-only                            | ✅ Reasonable                     | deferred (P2)                                                                                                                                                         |
| 12  | README mixes review history into product docs                  | ✅ Confirmed, plus extra drift    | see N8, N9                                                                                                                                                            |
| 13  | Add failure-injection / integration tests                      | ✅ Agreed                         | engine tests mock the exchange client entirely today                                                                                                                  |

### Verification of the 2026-09-27 review (commit `f40f02a`)

Verified 2026-09-27 against `main` @ `f40f02a` (the `feat/db-redesign-c-identity`
merge; engine-spawn fix `a811c77` on top) by reading the sources named in the
evidence column. Findings the same day's live start/stop test added are L18–L19
in §3.

| #   | Reviewer claim                                                                                                    | Verdict                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 P0 — dual lifecycle authority: `interfaces/http/bots/engine.ts` writes bot state outside `BotLifecycleService` | ✅ Confirmed → ✅ Done 2026-09-30 | `/heartbeat` (`engine.ts:99`), `/report-trade` (`:330`), `/bot-error` (`:534`), `/bot-recovery` (`:579`) UPDATE `bot_instances` directly (`:356`, `:550`, `:595`), yet a repo grep finds **zero callers in `engine/`** — liveness flows via `ENGINE_HEARTBEAT` events → `engine-registry.service.ts:222`. Remove or route through the lifecycle service (execution-integrity batch). **Verifier's note (2026-09-30):** the same verification pass found a newly discovered, service-level twin — `BotManagementService.createAndStartBot`/`.stopBot` (plus private `generateBotId`) flipped `bot_instances.status` directly (no CAS, no `bot_lifecycle_events` trail, no engine command) with zero callers outside their own tests; deleted in `8af8fc8`, recorded as L26. **HTTP side (this claim):** the four dead routes `/heartbeat`, `/report-trade`, `/bot-error`, `/bot-recovery` deleted 2026-09-30 (`engine.ts` 727→444 lines, file header rewritten, the heartbeat/report-trade test suites dropped) — liveness is `ENGINE_HEARTBEAT` events, bot-state writes stay with `BotLifecycleService` |
| 2   | 🟠 P1 — credential issuance is not idempotent (check-then-insert)                                                 | ✅ Confirmed                                       | `engine.ts:220-224` SELECTs the `CREDENTIALS_ISSUED` marker, `:303-307` INSERTs it; no unique constraint on `bot_lifecycle_events(bot_id, event_type, correlation_id)` (plain insert at `bot-lifecycle.repository.ts:99`), so two concurrent engine fetches can both pass the check                                                                                                 |
| 3   | 🟠 P1 — the `report-trade` write path is weak                                                                     | ✅ Confirmed → ✅ Done 2026-09-30 (route deleted; N7 event-path half remains)                          | raw `INSERT INTO trades` taking `userId`/`strategyId` from the request body (`engine.ts:356`), `UPDATE bot_instances … WHERE strategy_id` (strategy-, not bot-scoped), no unique `trades(order_id)`; still zero engine callers; **route deleted 2026-09-30** (it took `userId`/`strategyId` from the body, keyed `bot_instances` by `strategy_id`, and had no idempotency key) — the one remaining trade-write path is the Phase 4 `TRADE_EXECUTED` event ingest                                                                                                                                                      |
| 4   | 🟠 P1 — position/balance readers are user-scoped, not account-scoped                                              | ✅ Confirmed, partly mitigated by C3b              | `position-repository.adapter.ts:58-62` documents the userId-only interface answering with the "most recently updated row"; account-keyed reads exist only via the portfolio routes / `exchange-snapshot.adapter`                                                                                                                                                                    |
| 5   | Account binding + lifecycle validation on start/stop                                                              | ✅ Confirmed                                       | `bot-lifecycle.service.ts` `start`/`stop`/`createAndStart`: ownership checks, owned + `ACTIVE` account binding, desired/actual CAS transitions                                                                                                                                                                                                                                      |
| 6   | Migration `014_drop_legacy_kodiak.sql` guards the legacy drop                                                     | ✅ Confirmed                                       | idempotent backfill → `RAISE EXCEPTION` while any bot is still unbound (`014:41-55`) → `SET NOT NULL`; the drops are gated by grep/empty/FK checks documented in the header                                                                                                                                                                                                         |
| 7   | Credential endpoint flow (`GET /credentials/:botId`, at-most-once marker)                                         | ✅ Confirmed                                       | `engine.ts:184` behind `botEngineAuth` (bot-scoped API key); the marker race is claim 2                                                                                                                                                                                                                                                                                             |
| 8   | Credentials are write-only in the API contract                                                                    | ✅ Confirmed                                       | `shared/src/types/accounts.ts:46-49` — responses never include them                                                                                                                                                                                                                                                                                                                 |
| 9   | Account snapshot replace semantics                                                                                | ✅ Confirmed                                       | `exchange-snapshot.adapter.ts:44-101`: `DELETE` + bulk `INSERT … ON CONFLICT` inside one `transaction`; an empty venue report clears the snapshot                                                                                                                                                                                                                                   |
| 10  | 🟡 P2 — `kodiak_status` in `user_trading_summary`                                                                 | ✅ Confirmed; dead column                          | migration `012_wallets_exchange_accounts.sql:138` recomputes it from `exchange_accounts`; a repo grep finds no code consumer                                                                                                                                                                                                                                                        |

The reviewer's recommended next PR — execution-integrity hardening (heartbeat
authority → credential idempotency → trade idempotency → bot-scoped stats →
account-scoped position/balance) — is queued **after** L18/L19; see §4 and §6.

---

## 3. Findings the 2026-09-20 review missed

All line references are from `main` @ `c149711`. None of these are speculative —
each was read directly in the source.

### N1 — 🔴 P0: the create-order request does not match the exchange contract

> **Resolved (2026-09-21):** `exchanges/kodiak/payload.ts` maps the camelCase
> request onto the documented snake_case body and `createOrder` signs and sends
> exactly that serialized body; a wire test
> (`__tests__/client.wire.test.ts`, local `node:http` stub) asserts the exact
> JSON keys and verifies the signature over the wire body with an independent
> Ed25519 implementation. See ledger rows 0–1.

`OrderlyClient.createOrder()` signs and POSTs the caller's `OrderRequest`
**verbatim, in camelCase**:

```ts
// engine/src/exchanges/kodiak/client.ts
const path = "/v1/order";
const headers = await this.signRequest("POST", path, request);
const response = await this.client.post(path, request, { headers });
```

```ts
// engine/src/strategies/grid.ts (placeBuyOrder / placeSellOrder)
const order: OrderRequest = {
  symbol: this.config.symbol,
  orderType: "LIMIT",
  side: "BUY",
  orderPrice: level.price,
  orderQuantity: this.config.orderQuantity,
  clientOrderId,
};
```

Orderly's contract — per the API reference the repo itself keeps at
`docs/archived/ORDERLY/ORDERLY_API_RESTful.md` — is **snake_case**:
`order_type`, `order_price`, `order_quantity`, `client_order_id`. No `.ts` file in
the repository ever emits those keys for a request; the only snake_case usage is
_reading_ responses (`client.ts`, `r.client_order_id`).

**Impact:** one of two bad outcomes, both fatal to the current safety story —
either the exchange rejects the order (missing required `order_type` /
`order_quantity`, i.e. no trading at all), or the unknown camelCase fields are
ignored and the order is placed **without `client_order_id`**, voiding the
duplicate-rejection guarantee that the whole idempotency story rests on.

**Why tests do not catch it:** `engine/src/strategies/__tests__/grid.test.ts`
mocks the exchange client with `jest.fn()`, so no wire payload is ever asserted.

### N2 — 🔴 P0: `client_order_id` exceeds the exchange's length limit

> **Resolved (2026-09-21):** `utils/client-order-id.ts` derives
> `<botKey>-<level(base36)>-<B|S>` (≤36 chars, alphanumerics + non-leading
> hyphen only) from `(botId, levelIndex, side)` — deterministic across
> restarts, unit-tested against the contract guard. See ledger row 1.

`ORDERLY_API_RESTful.md` documents `client_order_id` as _"36 length, accepts
hyphen but cannot be the first character"_. `generateClientOrderId` returns
`` `${botId}:${levelIndex}:${side}` `` where `botId` is a UUID (36 chars), so the
produced key is ~44–46 characters and contains `:`, which is not a documented
allowed character. Even after N1 is fixed, the deterministic key would be
rejected.

### N3 — 🔴 P0: a missing exchange order permanently blocks a grid slot

`grid.ts` polls each live order and swallows every failure:

```ts
} catch {
  // Order may not exist anymore
}
```

The slot's `buyOrderId` / `sellOrderId` is **never cleared**, so the level can
never be re-armed. A 404 (order gone/cancelled externally) is indistinguishable
from a transient network error. This is exactly the reviewer's "local order exists
but exchange order doesn't" case — it is not implemented.

### N4 — 🔴 P0: restart has no exchange cross-check (orphan/duplicate blind spot)

`initialize()` trusts the snapshot, and otherwise silently rebuilds the grid from
the current price. Nothing lists the symbol's open orders and compares them with
the restored levels. After a missing/corrupt snapshot, a config change, or fills
that happened while the engine was down, previously live orders become **orphans**
that nothing adopts, cancels, or reports.

Compounding detail: slot identity is **index-keyed** while prices are
**baseline-derived**. After a restart with a new baseline, `bot-1:0:BUY` — an
order live at the _old_ index-0 price — is adopted into the _new_ level 0 at a
_different_ price, so local state attributes an order to the wrong price level.

### N5 — 🟠 P1: cancellation ambiguity is reported as `STOPPED`

`GridTradingStrategy.stop()` swallows every `cancelOrder` failure, and the
lifecycle coordinator then publishes `STATE_CHANGED → STOPPED`. The backend shows
`actual_state = STOPPED` while live orders may still rest on the exchange.

---

### N6 — 🟠 P1: the grid's profit logic is not meaningful

- Sell legs are placed at **`level.price`** — the same price as the buy that
  filled — so there is zero spread before fees and rebates.
- PnL is derived from the **mark price at check time**, not the executed price,
  and ignores fees: `(this.currentPrice - level.price) * orderQuantity`.
- Sell legs are never marked `reduce_only` (the domain model has the field and the
  exchange supports it), so a stale sell can open a short instead of closing the
  grid leg.
- Fill handling is the boolean `filled` flag on a level: no position/quantity
  accounting and no `PARTIALLY_FILLED` branch.

### N7 — 🟠 P1: the durable trade ledger exists but is unreachable (and would fail if called)

- `POST /api/bot/engine/report-trade` inserts into `trades` and increments
  `bot_instances.total_trades/total_pnl`, but **no engine code ever calls it**.
- The backend's `TRADE_EXECUTED` / `POSITION_UPDATED` / `PERFORMANCE_SNAPSHOT`
  handlers only log; the engine never publishes them.
- Engine-side `trades[]`, `totalPnl`, `totalTrades` live in memory and are absent
  from the grid snapshot, so all accounting is lost on restart.
- If the endpoint were called today it would break: `trades.status` has a CHECK
  constraint (`PENDING | FILLED | PARTIAL | CANCELLED | REJECTED`) while engine
  statuses include `OPEN` / `SUBMITTED` / `FULLY_FILLED`; the `UPDATE
bot_instances ... WHERE strategy_id = $2` touches **every bot sharing the
  strategy**; and there is no idempotency key, so a retried report double-counts.

### N8 — 🟡 P2: engine runtime configuration is missing from `.env.example`

`.env.example` documented only `BOT_ENGINE_API_KEY` for the engine.
`ENGINE_ID`, `ENGINE_STATE_FILE`, `GRID_SNAPSHOT_DIR`,
`ENGINE_HEARTBEAT_INTERVAL_MS` and the `PENDING_*` knobs were code-only.
_(Addressed in this documentation pass — see §4.)_

### N9 — 🟡 P2: documentation drift (self-contradicting README)

- The README's **Architecture Ratings** table published the _previous_ review's
  numbers (`Overall ~7/10`, `Documentation 4/10`) while the same file claimed the
  newer assessment — two contradictory scorecards in one document.
- The "Recently Fixed" table pointed at `engine/kodiak/src/index.ts` and
  `engine/kodiak/src/strategies/grid.ts`, **paths that no longer exist** (the
  earlier gap analysis already flagged this as a review error).
- The README described `docs/` as documented while `.gitignore` ignored all of it
  (0 tracked files).
- `engine/README.md` and `backend/README.md` carried Node badges (25.x /
  `>=25.0.0`) that contradict `engines: ^24.15.0`; the engine README also described
  `BotManager` as embedded in `index.ts` after it moved to `application/`.
- The README documented `npm start` and a root-level `npm run db:status`, neither
  of which existed at the root (`prod`, `db:migrate`, `db:seed` only).

---

### Findings from the 2026-09-26 runtime flow audit (L1–L10)

The two manual runs of 2026-09-26 (07:56 and 11:09) were audited against
`logs/{app,http,error}-2026-09-26*.log`, the source, and read-only DB queries.
The audit re-confirmed the C2/C3 storage surface and produced the items below.
Everything here is reproduced from evidence — file:line references, log
timestamps, and `exchange_accounts` / `audit_logs` rows — not inferred.

**Regression baseline (do not lose these):** `error-*.log` stayed empty for the
whole run; timestamps carry real milliseconds (`…HH:mm:ss.SSS`); 63/63 requests
had their own `correlationId`; account-scoped reads (`?exchangeAccountId=`)
returned 200; the password-worker heartbeat / shutdown noise is gone; and the
deliberate concurrent-refresh short-circuit no longer writes to `error-*.log`.

#### L1 — 🔴 P0: the frontend's bot-management calls 404 — the routes live under `/management`

`GET /api/bot/instances` returned **404 four times** (`11:14:25.406`,
`11:14:26.455`, `11:14:28.500`, `11:14:32.547`), immediately after
`POST /api/strategies` created `test-grid-1` (`201`, `11:14:24.969`). The
frontend (`frontend/src/infrastructure/api/trading.ts:61,89,100,107`) calls
`/api/bot/{instances,start,stop,emergency-stop}`, but
`backend/src/interfaces/http/bots/index.ts:21` mounts the management router at
`/management`, so the served paths are `/api/bot/management/{…}` — which is what
the backend's own tests use (`tests/unit/controllers/bots.controller.test.ts:260`
etc.). `backend/README.md:216-218`, `docs/OPERATIONS.md:104,190`, the
`bots/management.ts` docblocks and `frontend/README.md` repeat the shorter
(non-existent) paths.

Impact: the dashboard cannot list bots, so **the C3a "start a bot on an explicit
account" acceptance test cannot be exercised from the UI at all**.

Decision (2026-09-26, owner): **repoint the frontend** to
`/api/bot/management/*` and correct the docs, rather than aliasing the routes at
`/api/bot`. An alias would graft `management.ts`'s duplicate `GET /engine/status`
(`bots/management.ts:680`) onto `/api/bot/engine/status`, shadowing the real
engine route in `bots/engine.ts` (mounted at `/engine`) — a collision hazard for
one saved string change. That duplicate endpoint should be retired in the same
pass, leaving exactly one URL per operation.

#### L2 — 🔴 P0: the Dashboard pins the portfolio to a Kodiak account, hiding the Lighter one

`POST /api/accounts/connect` did create and live-verify a Lighter account:
`exchange_accounts` holds `72c483bc-… | user e9ed3301 | lighter | testnet |
ACTIVE | account_ref 404 | created 11:12:53.744`, and `audit_logs` holds
`EXCHANGE_ACCOUNT_CONNECTED {exchange: lighter, accountId: 72c483bc…}` at
`11:12:57.232`. The same user also owns `49401abd-… | kodiak | mainnet | ACTIVE`
(created 2026-02-09). Yet **every** post-connect read is scoped to the kodiak
account (`/api/market/{positions,trades,balance}?exchangeAccountId=49401abd…`,
with Kodiak-served payloads in the app log), because
`frontend/src/features/dashboard/pages/Dashboard.tsx:185-191` filters
`account.exchange === "kodiak" && status === "ACTIVE"` before choosing the
portfolio account.

Impact: a newly connected venue account is invisible in the UI (the exact
inconsistency reported after the run); with a Lighter-only user the id resolves
to `""`, producing unscoped market reads whose account is decided by the
backend.

Decision (2026-09-26, owner): **venue-agnostic account selection with a
switcher** — list all ACTIVE accounts, default deterministically (not
"kodiak first"), and keep the app-global balance widget in sync.

#### L3 — 🔴 P0: the HTTP logger mounts _after_ `/api/auth`, and the server listens before the stack is ready

Boot timeline (`app-2026-09-26.log`): `/api` activity tracker `11:09:43.300` →
`/api/auth` mounted ~`.42x` (`auth-routes-registration` completed `.427`) →
**`contextMiddleware` + `httpLogger` at `.429`** → user/market/bot/wallet/
security/health routers. Yet **"🚀 Server running on port 3000" is `.306`** — 265 ms
before route registration finished. `ExpressConfig.createApp()`
(`backend/src/server/express-config.ts:266-279`) fires the async `configure()`
without awaiting it, and `configureLogging` (`:244-258`) contains two
`await import()` calls, so its two `app.use()` calls land at non-deterministic
positions relative to `MiddlewareConfig.configure()` and `RouteConfig.register()`
in `index.ts`.

Evidence: `POST /api/auth/register` (`11:11:13.325`) appears in the activity
tracker with the **boot-time ambient** correlation id and
`operationDuration: 90354`, while the auth service logs a _different, fresh_ pair
(`req_122ea5e86b221362` / `rid_31752aeb`) — i.e. `contextMiddleware` ran but
`httpLogger` never did. No `/api/auth/*` request appears among the 63 logged
requests: `login`, `refresh`, `csrf-token` and `check-admin-qualification` are
all absent from `http-*.log`.

Impact: auth traffic cannot be correlated by the OPERATIONS §5 runbooks; auth
error bodies (`createErrorResponse(…, getCorrelationId())`) can echo a stale
ambient id; a fast client can hit a 404/partial stack during the ~270 ms window;
and the split can land on other route groups on another boot.

#### L4 — 🔴 P0: `ExchangeAccountService` is built without its logger, so connect/verify/revoke are unauditable

`service-factory.ts:363-407` constructs the service with six dependencies and
**no `logger`** — exactly the list the runtime prints
(`Exchange Account Service created with dependencies
['exchangeAccountRepository','encryption','verifyConnectivity','userLevel','auditLogRepository','boundBots']`),
whereas the DI container does pass `logger: this.loggerService`
(`dependency-injection.container.ts:389+`). `core/user/exchange-account.service.ts`
logs through `this.deps.logger?.info(…)`, so the optional chain silently drops
`"Exchange account connected"` — **grep count 0** in the run, although the
account row and the audit row prove success — and equally drops the failure paths
(`"Account envelope encryption failed"`, `"Failed to audit account connect"`).

Impact: the whole C2 account surface, _including failures_, is invisible in logs.
The DB audit still works (`EXCHANGE_ACCOUNT_CONNECTED`), so this is a log blind
spot rather than data loss. The two wirings (factory vs DI) drifting silently is
itself the defect to remove.

#### L5 — 🟠 P1: Lighter verification is silent while Kodiak narrates itself

A Kodiak connect is traceable (`Request queued for Kodiak API {endpoint:
accountInfo}` from `kodiak-queue`), but the successful Lighter connect produced
**zero** log lines — `lighter` does not appear anywhere in either log file. The
verify did run and pass: `createVerifyConnectivity`
(`core/user/verify-connectivity.ts:48`) delegates Lighter to
`LighterAccountVerifier.verify()`, which fails closed when `LIGHTER_SIDECAR_URL`
is unset, and the account reached `ACTIVE` with `verified_at` set. The verifier
accepts a `LighterVerifierLogger`, but nothing is logged on the success path and
no line names the venue.

Impact: "did the Lighter connect reach the sidecar, how long did it take, why did
it fail" is unanswerable from logs; the venue survives only in the DB audit row.

Fixed (2026-09-28): the dead `LighterVerifierLogger` is now wired in through the
verifier's deps bag, and every exit of `verify()` is narrated —
`Lighter credentials verified` (with `exchange`, `environment`, `accountIndex`,
`apiKeyIndex`, `accountLookupMs`, `keyOwnershipMs`) or
`Lighter verification failed - account lookup|key ownership` (same venue fields
plus `step`, `durationMs` and the bounded venue reason); the fail-closed
"sidecar not configured" path logs at `warn` too. `ExchangeAccountService` now
logs `Exchange account verification started|completed|failed` around
`verifyConnectivity` for both `connectAccount` and `verifyAccount` (with
`exchange`/`environment`/`durationMs`), enriches `Exchange account connected`
with the venue and `verificationMs`, adds the missing success line to a
re-verify (`Exchange account verified`), and the Kodiak probe carries
`exchange: "kodiak"` + `durationMs` for symmetry. No credentials or private keys
are passed to any log line (asserted in the tests). Pinned by 4
`lighter-verifier` L5 cases, 2 `exchange-account.service` cases (venue fields,
outcome, and a no-secret-material assertion) and the `masking`/`verify-connectivity`
suites staying green.

#### L6 — 🟠 P1: a duplicate registration logs the user's email at `warn`

`11:11:13.331 "User registration attempt"` and `11:11:13.338 "Registration failed

- email already exists"`(component`logger-adapter`) carry
`email: john.doe@example.com`, `username: john_doe`; `audit_logs`has the matching`USER_REGISTRATION_FAILED`row. The browser flow was login → dashboard and the
user was authenticated as`e9ed3301`18 s later, so this was a stray/abandoned
register submission (no frontend code auto-registers —`frontend/src/infrastructure/api/auth.ts:69`is only called from the Register page). Benign, but an expected duplicate is
logged at`warn`with PII, and because`/api/auth/*` is not HTTP-logged (L3) the
  submission is invisible outside that one line.

Decision: log at `info` with a masked email, keep the audit event, and return a
distinct error code so the UI can offer "log in instead".

Fixed (2026-09-28): `shared/src/types/errors.ts` gains
`ErrorCodes.EMAIL_ALREADY_REGISTERED` + `EmailAlreadyRegisteredError` (409, with
`hint: "log in instead"`); `AuthService.register` now logs
`Registration skipped - email already registered` at `info` and returns
`code: EMAIL_ALREADY_REGISTERED` (also on the race-window catch branch, and both
result shapes carry `code` through `convertToLegacyFormat`); the register route
maps that code to the conflict error and keeps `ValidationError`/400 for every
other failure. Log hygiene went wider than the finding: every log site that used
to emit a raw address in `auth.service.pure.ts` (attempt/failure/success for
register **and** login) and in `interfaces/http/auth/index.ts` now uses the new
`maskEmail` helper (`backend/src/shared/utils/masking.ts`), while `logAuditEvent`
rows and API responses keep the real address. Pinned by 5 `masking` cases, the
updated duplicate-registration service test (info + masked + code + audit keeps
the real address), a new attempt-log masking test, the login-path masking
assertion, and a controller case asserting 409 +
`code: EMAIL_ALREADY_REGISTERED` + `hint`.

#### L7 — 🟠 P1: one response was logged under a sibling request's correlationId

`req_bbe7e0a41c8dbfa0` (`GET /api/market/balance`, `11:11:32.820`) has **two**
response lines; the second carries the _trades_ URL and its `8137ms` duration
(`11:11:41.314`). `req_84dd05e15d188409`
(`GET /api/market/trades?limit=50&exchangeAccountId=49401abd…`, `11:11:33.177`)
has a request line and **no** response line. Both requests were concurrent and
serialized through the shared Kodiak queue. Cause: `runWithContext` →
`setRequestContext` uses `AsyncLocalStorage.enterWith()`, so a shared async chain
can carry the wrong request's store by the time `res.end` resolves the context.

Impact: 1 of 63 response lines mis-correlates — and the runbook's "grep the
correlationId" then finds no response at all for the affected request. Fix:
capture `correlationId`/`requestId` in the middleware closure and pass them
explicitly on the response line; longer term stop relying on `enterWith`.

Fixed (2026-09-28): `httpLogger` captures `correlationId` **and** `requestId`
(the latter from the context `contextMiddleware` already minted, else minted)
into its closure and passes both explicitly on the `"HTTP response"` line. This
wins over the ambient store because `ContextAwareLogger.getContextInfo()` merges
per-call meta last, so a reply can no longer be attributed to a concurrent
request. `operationDuration` still derives from the async store (L8/L9 own the
background-scope work; dropping `enterWith` altogether is the longer-term fix).
Pinned by 3 `middleware.logger` cases, including a regression case that swaps the
ambient ids for a sibling's between the request and `res.end` and asserts the
response line keeps the captured pair.

#### L8 — 🟡 P2: the boot-time ambient context leaks into every background logger

`index.ts:70-73` called `setRequestContext({correlationId: generateCorrelationId(), …})`
at module load. **551** app-log lines shared `req_e841cdadb3b38e34` /
`rid_0198decd` for the whole run with `operationDuration` up to **352 897 ms**,
including all 347 `Consumer group read returned no messages (idle timeout)` lines,
DB-pool events, WebSocket handshake lines and the shutdown lines. One line still
reported `correlationId:"unknown"` (the first redis init).

Impact: background logs carry a fake request id and meaningless durations, and no
subsystem is greppable by correlation. Fix: drop the boot-wide
`setRequestContext`; give each background subsystem a stable scope
(`background:redis-consumer`, `background:db-pool`, …).

Fix (2026-09-29, done): the boot-wide `setRequestContext` is gone
(`index.ts` imports only `runWithBackgroundContext` now). `context.ts` adds
stable per-subsystem scopes — `getBackgroundContext(subsystem)` mints one
`bg_<subsystem>_<8hex>` correlation id per process (cached, so
`operationDuration` measures time-since-scope-start) and
`runWithBackgroundContext()` enters it via `ALS.run` only. Covered: DB pool
init/events/metrics interval (`background:db-pool`), Redis connect/event
callbacks (`background:redis`), Socket.IO engine callbacks
(`background:websocket`), password-pool warmup/health/listeners
(`background:password-pool`). `runWithContext` no longer calls `enterWith`
before `run` (the L7 sibling-bleed root cause). Pinned by
`tests/unit/context.background.test.ts` (stable ids, no ambient inheritance,
no `enterWith` leak).

#### L9 — 🟡 P2: long-lived objects keep the context of the request that created them

The password pool's shutdown lines carried `req_c96f47a09aef7d` with
`operationDuration: 235321` — the _login_ request that first hashed a password.
Its interval/terminate callbacks stayed in that ALS scope for the process lifetime.
Same class as L8; construct such pools eagerly at boot (or inside a background
context) instead of lazily inside a request.

Fix (2026-09-29, done): `index.ts` eagerly warms the pool via the new
`ensurePasswordWorkerPool()` (no-op in test env) before `listen()`; the
constructor, health-check interval, all worker `message/error/exit/online`
listeners and `performHealthCheck` run inside the stable
`background:password-pool` scope, so pool lines carry `bg_password-pool_*`
even if the lazy fallback fires inside a request. DB `startMetricsInterval`
moved behind `startPoolMetrics()` in the same `db-pool` scope, stopped via
`stopPoolMetrics()` at shutdown. Lazy getters kept for adapters/tests.
Covered by `context.background.test.ts` + `password-worker.test.ts`.

#### L10 — 🟡 P2: the shutdown tail is unobservable and Phase 1 takes ~9.7 s

`SIGINT` `11:15:26.150-152` → `Phase 1: Stopping new connections` → **9.7 s** →
`HTTP server closed 11:15:35.868`, which was the last line in the file (same second
as its mtime). Missing: `Engine protocol listener stopped`, Phases 2–4,
`Graceful shutdown completed successfully`, and even the 30 s-timeout warning
(`index.ts:552-573, 576-636`). Redis idle polling stopped exactly at `35.868`, so
the process was still alive then — but nothing distinguished "completed, tail
truncated" from "hung, then killed".

Fix: log each stop with a duration, bound Phase 1
(`closeIdleConnections()`/`closeAllConnections()` plus a timeout), and flush the
logger before `process.exit(0)` — or drop the explicit exit and let the event loop
drain.

Fix (2026-09-29, done): `stopServer()` now drops idle keep-alive sockets
immediately (`closeIdleConnections`), force-closes the rest after 5 s
(`closeAllConnections`), and bounds the whole stop at 10 s with a warning;
`httpServer.keepAliveTimeout = 5 s` so Phase 1 no longer waits ~9.7 s.
`gracefulShutdown` runs every stop through `timedShutdownStep()` —
`stop-socketio` (`io.close()` added), `stop-http`, `stop-engine-listeners`,
`disconnect-redis`, `stop-db-metrics`, `shutdown-password-pool` (folded into
the main sequence instead of racing it via separate SIG handlers),
`close-db-pool` — each logging `{ step, durationMs }`, plus a Phase 1 summary
line. New `flushLogs()` (`logger.service.ts`, bounded 3 s) is awaited after
the `completed successfully` line, on the error path, and before the 30 s
forced-exit path, so the tail survives `process.exit`. Shutdown itself runs
under no ambient request context (L8 boot removal).

#### L11 — 🔴 P0: the portfolio endpoints were Kodiak-only, so a connected Lighter account showed no data

Observed in the 2026-09-26 flow test (the L2 follow-up): the user connected a
Lighter account (`72c483bc…`), the Dashboard selected it, and balance / positions /
trades were **empty** even though the account held funds and had traded. The
Kodiak account (`49401abd…`) rendered normally.

Three layers contributed, each hiding the next:

1. `market-portfolio.routes.ts` hardwired `kodiakIntegrationService` and answered
   **400** for every non-`kodiak` id (`"only available for Kodiak accounts"`);
   the app log carries **zero** Lighter venue traffic, so the request never left
   the backend.
2. The frontend converted that 400 into `{ success: true, data: null }`, so the
   failure surfaced as an empty widget rather than an error.
3. The positions/trades queries were gated on `isKodiakPortfolioSelected`, so for
   a Lighter selection they were never issued at all (empty _by design_).

L2 made account _selection_ venue-agnostic but left portfolio _reads_ Kodiak-only —
the two shipped inconsistently.

Fix: venue-dispatch the three handlers (`scope.exchange === "lighter"` → the new
Lighter portfolio reader, else `kodiakIntegrationService`), add the Lighter reader
(sidecar `auth-token` → authenticated `GET /api/v1/account` / `/api/v1/trades`,
normalized to the shapes the Dashboard already consumes, with best-effort C3b
snapshot writes), and drop the frontend venue gate + the 400→success masking.

#### L12 — 🟠 P1: `strategies.active` was write-once FALSE, so every strategy read "Inactive" forever

The 2026-09-26 flow test showed two user-created strategies — one from an earlier
test, one fresh — both rendered **Inactive**, and creating a strategy never started
anything.

`toggleStrategy` existed on both `StrategyService` and the repository adapter but
**had no caller**: no HTTP route, no UI control, and the bot lifecycle never touched
it. Rows were created inactive and the badge was structurally stuck regardless of
what the bot did — and `active` was actually stored as **NULL**, not `FALSE`: the
create path passed an omitted field straight into the INSERT and bypassed the
column's default (L16, found and fixed while preparing the acceptance run). Separately, the create flow had
no transition into "running": "start" is starting a _bot_ bound to the strategy
(C3a), and nothing offered that right after creation.

Fix: a `syncStrategyActive(strategyId, active)` helper called from the places that
actually start/stop execution (start dispatched, engine reports `RUNNING` → `true`;
stop dispatched, emergency stop, engine reports `STOPPED`/`ERROR`, command failure
or timeout-terminal → `false`), every flip best-effort so a badge failure never
fails the lifecycle op; plus a post-create "Start now?" prompt on the Strategies
page that reuses the existing bot start flow; plus removing the duplicate
`UserProgressCard` (it belongs on the Dashboard).

#### L13 — 🟡 P2: the Lighter signer sidecar was manual-only and absent from the dev stack

`npm run dev` started backend + frontend + engine but not the signer sidecar, and
OPERATIONS §5.7 only described manually restarting it. Yet the sidecar is required
for three separate flows — engine order signing, Settings connect/verify, and the
Dashboard portfolio reads of a Lighter account (L11) — including flows that run
when no strategy is running at all.

Because the sidecar is stateless (no credentials at rest; every request carries its
own `account_index` / `api_key_index` / `private_key`) it needs exactly **one**
instance, not one per strategy.

Fix: `scripts/dev-sidecar.sh` (venv bootstrap + `.env` load so `SIDECAR_AUTH_TOKEN`
matches) exposed as `npm run dev:sidecar` and folded into the root `npm run dev`;
OPERATIONS §5.7 documents the shared-singleton model and what depends on it.

**Verified 2026-09-27 — the loader could not work at all in this environment.** The
repo `.env` is authored with CRLF line endings, and the loader sourced it under
`set -e`: a bare `\r` line is a command-not-found that aborts the script (exit 127)
before uvicorn ever starts. The second half was worse and silent — a sourced
`SIDECAR_AUTH_TOKEN=…\r` never matches the value Node's dotenv loads (dotenv strips
CRLF, `source` does not), so had it started, every Lighter call would have been
rejected as unauthorised. The loader now strips CR before sourcing and when deriving
the port. `curl http://127.0.0.1:8790/health` → `{"status":"ok","service":"lighter-signer"}`.

#### L14 — 🟡 P2: the frontend reconnects in a loop after `WS_AUTH_FAILED`

The flow-test logs show repeated `WS_AUTH_FAILED` followed by Socket.IO protocol
warnings, i.e. the client keeps retrying with a token the server rejects instead of
stopping and re-authenticating. Low impact for a manual test (data still arrives
over REST), but it spams the logs and obscures real errors.

Fix (deferred): on `WS_AUTH_FAILED`, stop the reconnect timer and refresh the
session/token once before retrying.

**Done 2026-09-29.** The one refresh now happens over the cookie path, not
`POST /api/auth/refresh`: that route reads `req.body.refreshToken`, which the
browser cannot supply because the refresh cookie is `httpOnly` (the app never
calls it — login and refresh are cookie-driven). Instead
`frontend/src/infrastructure/api/session-refresh.ts` spends a single
`GET /api/auth/me`, which makes the backend auth middleware rotate the access
cookie itself when it sees an expired access token beside a valid refresh cookie
(`auth.middleware.ts` → `finalizeRefreshedSession()`). Success → the handshake
is retried immediately; failure → one `auth:session-expired` so the HTTP
client's `/login` redirect takes over. Bounded to one refresh per episode
(`authRecoveryAttempted`, reset by a successful connect or an explicit
disconnect), single-flight against the refresh itself (`authRecoveryPromise`)
and against `connectPromise`, and the transient `INTERNAL_ERROR` path is
untouched (no refresh, retries as before). Pinned by 4 new cases in
`frontend/src/test/unit/infrastructure/websocket-client.test.ts` (10 total).

#### L15 — 🟡 P2: the balance widget has no error channel, so a failed read is indistinguishable from a zero balance

`market-portfolio.routes.ts` answers **400** with a reason when a venue read fails
(e.g. the signer sidecar is down, or no verified credentials exist), but the client
discards it twice over: `kodiakApi.getKodiakBalance` maps **400 and 403** to
`{ success: true, data: null, message: "Kodiak account not connected" }`, and
`globalBalanceManager.refreshBalance` only takes the `success && data` branch —
everything else is a bare `console.warn` and the last known value is kept.

Net effect (before the fix): with the sidecar down, a Lighter account's balance
silently rendered as nothing (or stale) with no error anywhere in the UI,
while the positions/trades cards — which go through react-query, not the
balance manager — did surface their error. The 400 branch also no longer
meant what it was written for (L11 removed the "wrong venue" 400), so the
mask hid only genuine failures.

Fix (2026-09-29, done): the error channel exists end to end —
`kodiakApi.getKodiakBalance` throws `toBalanceError()` (server reason,
venue-neutral `Balance unavailable: …`, no secrets — the server already
sanitises) instead of masking 400/403; `globalBalanceManager` keeps
`lastBalanceError`, fans failures to per-subscriber `onError` callbacks
without touching the last good value, and clears the error on the next
successful read; `useBalance` exposes `error` and nulls the stale balance
on failure; the Dashboard Portfolio block and the Strategies balance block
render "Balance unavailable" with the reason instead of $0/stale.
Pinned by `kodiakApi.test.ts` (400 → rejects with the server reason) and
`shared/balance-manager.test.ts` (throw + `success:false` fan-out, cleared
on next success).

#### L16 — 🟡 P2: `strategies.active` was inserted as NULL, bypassing the column default

Found while preparing the C3a/C3b acceptance run: both existing strategy rows held
`active = NULL`, and a fresh create produced the same. Cause:
`strategySchema` (Joi, `interfaces/http/trading/strategies.ts`) has no `active` key,
so the validated value has none either, while
`strategy-repository.adapter.createStrategy` listed `active` explicitly in the
INSERT — `strategy.active` is `undefined` at runtime, node-postgres sends that as
NULL, and the column's `DEFAULT FALSE` therefore never applied.

Impact: nothing looked broken (NULL is falsy, so the badge still read "Inactive"),
but the shared `Strategy.active: boolean` contract was false for those reads and any
`WHERE active = false` filter would have missed every row — which is exactly the
predicate a "my inactive strategies" view would use.

Fix: resolve the flag in the adapter (`strategy.active ?? false`) for both the INSERT
and the returned strategy, plus a regression test asserting that an omitted `active`
persists `false`. The two existing rows keep NULL and self-correct on the next
start/stop; no backfill is needed.

#### L17 — 🔴 P0: the engine process could not start at all (and never had, in this environment)

Found while preparing the C3a acceptance run — which needs a live engine to consume
`START_BOT`. Both documented start paths fail on Node 24:

- `npm run dev:engine` (`ts-node-dev --respawn --transpile-only src/index.ts`) and
  `npm run prod:engine` (`node dist/index.js`) →
  `Cannot find module '…/infrastructure/redis/streams' … at node:internal/modules/esm/resolve`
- `node dist/index.js` also reports `[MODULE_TYPELESS_PACKAGE_JSON] … Reparsing as ES
module because module syntax was detected`.

Cause: `engine/tsconfig.json` combined `module: ES2022` with
`moduleResolution: bundler` in a package that has no `"type": "module"`. tsc
therefore emitted ESM syntax with **extensionless** relative specifiers
(`from "./infrastructure/redis/streams"`), which Node's ESM resolver rejects. The
test suites kept passing because ts-jest resolves those specifiers itself — this was
a _load_ failure, invisible to type-checking and to unit tests.

Evidence it had never run: no `.engine-state.json` and no `.grid-snapshots/` anywhere
on the host, consistent with `bot_instances` being empty. Every "engine" line in the
audit logs is backend-side protocol bookkeeping, not engine output.

Fix: align the engine with the backend's proven configuration — `module: commonjs`,
`moduleResolution: node`, plus `baseUrl`/`paths` for `@trade-bot/shared`'s
declarations (the package exposes its types through an `exports` map that plain `node`
resolution cannot read, which the backend already works around the same way). Verified:
`npm run prod:engine` boots the process — Redis connected, consumer group created,
identity `kodiak-engine-ae3a82ee` + heartbeat, "Listening for commands". The one
ESM-only production dependency (`@noble/ed25519`, used by the Kodiak client) loads
under Node 24's `require(esm)`, checked directly. `npm run build` is unaffected; the
engine suite stays green.

#### L18 — 🔴 P0: the engine silently ACKs `BOT_START`/`BOT_STOP` — dispatch uses legacy guards (the `ENGINE_NO_RESPONSE` root cause)

Found in the 2026-09-27 `npm run prod:all` start/stop test. Start returns 202,
the command reaches `tradebot:engine:commands` and is consumed (XPENDING → 0),
but no engine log line follows; after ~135 s the backend logs
`Lifecycle command timed out … timeoutReason: ENGINE_NO_RESPONSE` and the bot
lands in `actual_state = ERROR` (2026-09-27 20:39:33, bot `c7147374`,
`app-2026-09-27.log:2678`).

Cause: backend and engine disagree about the command type.

- The dispatcher publishes protocol envelopes with `type: "BOT_START"` /
  `"BOT_STOP"` (`backend/src/core/bots/lifecycle/bot-command-dispatcher.ts:39,61`).
- `command-consumer.ts:93` validates with the **protocol** `isBotCommand`
  (`shared/src/protocol/bot-command.ts:119`), which accepts `BOT_START` — so
  the message is not rejected as malformed.
- The dispatch branches, however, use the **legacy** guards `isStartBotCommand`
  / `isStopBotCommand` (`engine/src/protocol/command-consumer.ts:133,149` →
  `shared/src/types/engine-contract.ts:331,346`), which require the flat
  pre-protocol shape `type === "START_BOT"` / `"STOP_BOT"` with `engineId`,
  `timestamp`, `credentials`. A protocol envelope can never match.
- `handleCommand` therefore falls through every branch, returns, and
  `processMessage` ACKs the command (`command-consumer.ts:107-109`) — no
  `COMMAND_ACCEPTED`, no `handleStart`, no error. The grep shows this consumer
  is the last remaining user of the legacy guards.

Fix (2026-09-28): switched the two branches to the protocol
`isBotStartCommand`/`isBotStopCommand` (`shared/src/protocol/bot-command.ts:128,138`),
dropped the legacy imports, added a `logger.warn` on the remaining fall-through
(a `BOT_*` envelope whose payload fails its guards was previously invisible),
and exported `processMessage` for tests. Added the engine's first consumer
suite — `engine/src/protocol/__tests__/command-consumer.test.ts` (6 cases:
`BOT_START` → `publishAccepted` + `handleStart` + ACK; `BOT_STOP` →
`handleStop` + ACK; duplicate `messageId` dispatched once; legacy flat
`START_BOT` and unknown type → ACK without dispatch; `BOT_STATUS_REQUEST` →
no start/stop dispatch). Rebuilt `engine/dist`.

Live verification (2026-09-28, `npm run prod` + `prod:engine`, CSRF cookie +
minted access token for the existing test user): Start → **202** and the
engine _dispatches_ (was: zero output, silent ACK) — it fetched credentials
over `GET /api/bot/engine/credentials/:botId`, which exposed a fourth-layer
defect fixed in the same change: the fetcher sent `correlationId` only as an
`x-correlation-id` **header** while the route validates `req.query.correlationId`
(`backend/src/interfaces/http/bots/engine.ts:190-196` → 400 "correlationId
required", despite both READMEs documenting `?correlationId=…`). With
`params: { correlationId }` added (`engine/src/protocol/credential-fetcher.ts`,
pinned by `credential-fetcher.test.ts`), credentials are issued live
(`Engine credentials issued`, bot `fbfeb3fc`) and the subsequent failure
reaches the backend as `COMMAND_FAILED / INIT_FAILED` instead of silence.
Stop → **202** with the engine logging `Bot not found for stop` — the stop
branch dispatches too. `ENGINE_NO_RESPONSE` no longer describes "the engine
ignored the command". Start then stopped at the next layer — L20 (venue symbol
mismatch), which blocked exchange init. **L20 is fixed (2026-09-28)** and its
live re-test moved the failure one layer deeper: the symbol gate now rejects a
non-venue symbol before dispatch (400, no bot row), and a valid Lighter symbol
(`BTC`) reaches engine strategy init (`Grid strategy initialized`,
`baselinePrice: 82605.2`). The remaining start blocker is **L23** (the Lighter
order-query path 400s on a contract client-order id, freezing every slot until
the backend's 30 s command timeout turns the start into ERROR) — surfaced by
that same re-test, together with the still-open L21 and L22.

#### L19 — 🟠 P1: Stop returns 404 "Bot not found" — the bot-instances cache stores `strategy_id` as `id`

Same test, 2026-09-27 20:41:06: `POST /api/bot/management/stop` → **404**
(`logs/http-2026-09-27.log:367-368`; error thrown at
`bot-lifecycle.service.ts:529-534`), although the bot row exists and is owned
by the caller.

Cause: the frontend discards the real bot id at read time. The shared
`["bot-instances"]` cache maps each row with `id: bot.strategy_id`
(`frontend/src/features/bots/hooks/useBotLifecycle.ts:125`; the same mapping in
`strategyService.ts:166`) — a legacy "one strategy ⇒ one bot" convention kept
alive by the `bot.id === botId || bot.strategy_id === botId` fallbacks
(`useBotLifecycle.ts:181,247`). `BotControls.tsx:338` then sends
`stopBot(bot!.id)`, i.e. `{"botId": "<strategy uuid>"}` — the logged 48-byte
body is exactly `{"botId":"<36-char uuid>"}` (strategy `735ad508…` ≠ bot
`c7147374…`) — and `findBot(<strategy uuid>)` returns null → 404. The emergency
stop (`BotControls.tsx:357`) is broken the same way.

Fix: map `id: bot.id` (keep `strategy_id`), audit every `bot.id` consumer, and
pin the contract with a frontend test asserting the stop payload equals the
`id` returned by `/api/bot/management/instances`.

#### L20 — 🟠 P1: Start cannot reach `RUNNING` on Lighter — the strategy symbol `PERP_BTC_USDC` is not a Lighter market (found by L18's live re-test, 2026-09-28)

With L18 + the fetcher fix in place the engine completes `publishAccepted` →
`fetchCredentials`, then fails during exchange init:
`Unknown Lighter market for symbol "PERP_BTC_USDC" (no guessed market)`
(`engine/src/exchanges/lighter/market-map.ts:38`, via `resolveLighterMarket`)
→ `COMMAND_FAILED / INIT_FAILED` → bot → ERROR (`logs/app-2026-09-28.log`,
bot `fbfeb3fc`, correlation `11283029`, 08:08:07).

The venue is reachable and strict by design ("never a guessed market"):
`GET https://testnet.zklighter.elliot.ai/api/v1/orderBooks` lists `BTC`,
`SOL`, `ETH`, `ETH/USDC`, `LIT/USDC` — no `PERP_BTC_USDC`. That symbol is a
Kodiak/Orderly-era name the strategy carried from creation
(`strategies.config.symbol`, strategy `735ad508`), and nothing validates
`config.symbol` against the bound account's venue — so any Lighter-bound bot
created from this strategy can never initialize.

Fix (next issue): make the symbol venue-aware — filter/validate the symbol
catalog against the account's venue at strategy creation and/or start (fail
fast with a user-facing reason, not a generic engine failure), and pin with a
test: a Lighter start carrying a non-Lighter symbol is rejected before the
engine is dispatched.

**Fixed 2026-09-28.** The gate sits where the venue first becomes known — the
bound account exists only at start — in
`backend/src/infrastructure/external/venue-symbols.ts`:
`listVenueSymbols(exchange, environment)` reads the live catalog (Lighter:
`{lighterBaseUrl}/api/v1/orderBooks` → `order_books[].symbol`; Kodiak/Orderly:
`{KODIAK_API_URL | https://api.orderly.org}/v1/public/futures` →
`data.rows[].symbol`) and `assertSymbolSupported` resolves the strategy's
symbol case-insensitively, throwing `VenueSymbolError` (400) with the supported
list when unlisted. It is called from `createAndStart` between the
one-active-bot 409 and the row insert, so a rejection happens **before** any
state change or `BOT_START` dispatch; `management.ts`'s start route now passes
`400`/`409` messages through (previously only 404 did). Design choices that
keep the engine authoritative: **fail-open** — an unreachable catalog or an
unmapped venue returns `null` and the start proceeds (the engine's own market
resolution still rejects); no caching, no new dependency (`fetch`). The
frontend's `StrategyForm` symbol list became the union of both venues' markets
(strategy creation stays venue-agnostic — the account is chosen at start), and
the toast already renders `response.data.error`.

Pinned by `backend/tests/unit/venue-symbols.test.ts` (9 cases: both catalogs,
unknown venue, fetch failure, non-2xx, bad shape, case-insensitive resolve,
unlisted → 400, fail-open), `bot-lifecycle.service.test.ts` (3 cases: unlisted
→ 400 **with no `INSERT INTO bot_instances`**, listed → created + dispatched,
catalog unavailable → fail-open) and a controller case asserting the 400
message reaches the response body.

Live re-test (2026-09-28, `npm run prod:all`, minted JWT):
`POST /api/bot/management/start` for strategy `735ad508` (`PERP_BTC_USDC`) +
Lighter account `72c483bc` → **400**
`Symbol "PERP_BTC_USDC" is not listed on lighter (testnet). Supported symbols: BTC, ETH, ETH/USDC, LIT/USDC, SOL. Edit the strategy's symbol and start again.`
with `bot_instances` unchanged (3 → 3). A second run with a `BTC` strategy
(`51799e52`, created through the API) → **202** (bot `2b39da69`), engine
`Credentials fetched for bot … exchange: lighter` → `Grid strategy initialized
{symbol: BTC}` → `Grid strategy bot started`.

#### L21 — 🟠 P1: `COMMAND_FAILED` does not resolve the tracked lifecycle command — the sweeper still logs `ENGINE_NO_RESPONSE` for an engine that answered

Live, 2026-09-28: the backend received and logged the engine's
`COMMAND_FAILED / INIT_FAILED` for correlation `11283029` at `08:08:07.603`
(`Command failed in engine …`), yet at `08:08:40.841` the **same**
correlationId logged `Lifecycle command timed out … timeoutReason:
ENGINE_NO_RESPONSE`. An answered failure is labeled "engine never responded"
— the failure event did not clear the `PENDING` command row (same class of
problem as the dead `engine.ts` lifecycle writers in §2), or the timeout
reason ignores an observed response. Fix as part of the execution-integrity
batch: one authority resolves command rows (accept / fail / timeout), covered
by a test asserting a `COMMAND_FAILED`-resolved command never times out.

**Refined 2026-09-28 (L23's live re-test).** The accepted path fails the same
way, so the missing resolution is not failure-specific: for start correlation
`368e042d` the engine called `publishAccepted` (published `10:03:28.095` to
`tradebot:engine:commands`) and went on to place and fill orders, yet the
backend logged `Lifecycle command timed out … timeoutReason:
ENGINE_NO_RESPONSE` at `10:03:59` for that same correlationId and moved the bot
to ERROR. Two distinct defects hide behind "the engine never responded": the
accepted/failed events do not resolve the tracked command row (this item), and
the sweeper's timeout does not stop the engine-side runner (L24).

**Fix (2026-09-28).** Root cause found and fixed on both sides:

- **The epoch comparison was type-strict.** `engine_registry.epoch` is `BIGINT`
  (migration 009), so node-postgres returns it as the **string** `"19"` while the
  engine publishes `engineEpoch` as a JSON **number** `19`.
  `EngineRegistryService.assertAuthoritative` compared the two with `!==`, so
  every runtime event — `COMMAND_ACCEPTED`, `COMMAND_FAILED`, `STATE_CHANGED` —
  was rejected as an "epoch mismatch". That single defect explains why the
  accepted _and_ the failed path both left the tracked command `PENDING` and why
  a healthy engine that had answered was reported as `ENGINE_NO_RESPONSE`. Fixed
  with `normalizeEpoch()`/`epochsMatch()` (`engine-registry.service.ts`): both
  sides are normalised to a safe integer and the check stays fail-closed (absent
  or unparsable ⇒ no match); the mismatch log now records `registeredEpochType`.
- **A rejected runtime event is no longer a silent drop.** The gate in
  `BotEventProcessor.isAuthoritativeRuntimeEvent()` is fail-closed and logs at
  `error` level with the event's command context (`type`, `correlationId`,
  `botId`, `commandType`, `engineId`, `engineEpoch`) — dropping an accept is
  exactly what leaves a command to be timed out, so it must be visible.
- **The engine ACKs stops too.** `engine/src/protocol/command-consumer.ts`
  published no accept for `BOT_STOP`, so even a _successful_ stop was burned as
  `COMMAND_NEVER_DELIVERED`/`STOP_INCOMPLETE`; the stop branch now
  `publishAccepted`s before `handleStop()`, exactly like `BOT_START`.

Pinned by the new `backend/tests/unit/lifecycle-command-authority.test.ts`
(8 cases: a command the engine has not answered stays `PENDING` and is timed
out; `COMMAND_ACCEPTED` and `COMMAND_FAILED` each resolve the row so the sweep
never sees it; a `BOT_STOP` row resolves on the engine's accept), the epoch-skew
cases in `backend/tests/unit/engine-registry.service.test.ts` (a `BIGINT` string
matches the JSON number; a non-numeric/missing epoch never matches), and the
`BOT_STOP`-accept case in `engine/src/protocol/__tests__/command-consumer.test.ts`.

#### L22 — 🟡 P2: non-`CommandError` failures retry forever, and poison entries are logged but never ACKed

`processMessage`'s catch treats anything that is not a `CommandError` as
retryable → no ACK → `recoverPending` reclaims after 60 s. Business failures
surfaced as plain `Error`s therefore loop: the `UnknownMarketError` start
above re-delivered, and the stale `BOT_START` from the _previous_ bot
(`1790582472690-0`, for which the backend correctly answered 409 "not in a
startable state") re-delivered until `checkPendingInsight` flagged
`Poison commands detected {poisonIds: ["1790582472690-0"]}` — which only
**logs**; no code path ever ACKs a poison entry (`recoverPending` /
`checkPendingInsight` in `command-consumer.ts`). The market-map docblock even
promises "unknown symbols resolve to `CommandError`", but
`UnknownMarketError extends Error`. Fix: wrap business failures (unknown
market, backend 4xx responses) into non-retryable `CommandError`s at the
boundary, and ACK poison entries after the threshold (alert + drop).

#### L23 — 🟠 P1: the Lighter order query 400s on a contract client-order id, so every slot freezes and the start times out (found by L20's live re-test, 2026-09-28)

With L18–L20 in place the start reaches strategy init on Lighter and then never
acknowledges: bot `2b39da69` (strategy `51799e52`, symbol `BTC`) logged
`Grid strategy initialized` + `Grid strategy bot started` at `09:43:09`, then
repeated `Order slot frozen (exchange unreachable) … reason: lighter request
failed (GET /api/v1/accountOrders): Request failed with status code 400` for
every level until the backend's sweeper wrote
`last_error_code: COMMAND_TIMEOUT_ENGINE_NO_RESPONSE` at `09:43:43` → ERROR.

Cause: the grid reconciles a slot through
`exchange.queryOrderByClientOrderId(symbol, clientOrderId)`
(`engine/src/strategies/grid.ts:328,396,434`) with the **contract** client
order id (`3da8db5ad3e05e38ed3b8ec191bd78-03-B` — the Orderly-shaped id the
grid derives for idempotency). Orderly accepts any string id; Lighter's
implementation (`exchanges/lighter/client.ts:643`) instead treats its argument
as the venue's **numeric client order index** and forwards it verbatim as
`accountOrders?client_order_indexes=<value>` → a non-numeric value → **400**,
which the client maps to `UNREACHABLE` → the slot freezes (by design: "could not
ask" never reads as "absent") → no `STATE_CHANGED`/ACK is ever published → the
30 s command timeout fails the start. `placeOrder` (`client.ts:383`) and
`cancelOrder` (`client.ts:479`) already derive the numeric index with
`clientIndexFromString` (numeric strings pass through verbatim); the query path
doesn't, and its row comparison (`rowClientIndex(row) === clientOrderId`)
compares against the contract id too.

Fix (next issue): apply `clientIndexFromString` at the top of
`queryOrderByClientOrderId` and compare rows against the derived index (so both
the internal numeric-handle callers and the grid's contract ids work), then
re-run the live re-test and require a start to reach
`STATE_CHANGED → RUNNING`. Worth adding alongside: an explicit unit case per
call site (`place`/`cancel`/`query` receive the contract id and hit the same
index) and a look at whether the slot should distinguish "venue rejected the
query" from "venue unreachable".

**Fixed 2026-09-28.** `queryOrderByClientOrderId` now derives the venue index
once (`const index = String(clientIndexFromString(clientOrderId))`) and uses it
for the liveness listing, the `accountOrders?client_order_indexes=` param and
the row comparison, with a docblock recording both id conventions that reach
it. `createOrder`/`cancelOrder` already derived; numeric handles still pass
through verbatim, so the adapter's own callers are untouched. Pinned by two
cases in `engine/src/exchanges/lighter/__tests__/query-matrix.test.ts`:
"looks a contract client order id up under the index it was placed with"
(places with a contract id through a capturing signer, then requires the query
to ask the venue by that same number — and the venue stubs echo the param, so a
client that sent the contract id would find nothing) and "forwards a numeric
handle verbatim (no re-hash)".

Live re-test (2026-09-28 10:03, `prod:all`, minted JWT): strategy `51799e52`
(`BTC`) → **202** (bot `e56a3ad4`) → `Credentials fetched` →
`Grid strategy initialized {baselinePrice: 82735}` → **four real orders placed
and filled on Lighter testnet** (`Placed order BUY 82900.47 orderId
2481833915` … `Buy order filled price 83562.35`), **zero** `Order slot frozen`
lines (the 400 is gone), and the Lighter account's portfolio shows exactly the
filled `0.004 BTC` (= 4 × `orderQuantity` 0.001). Stop → **202** with
`Grid strategy bot stopped`.

The start still does not reach `RUNNING`, for a different reason: the engine
published the accept and traded while the backend timed the same correlationId
out (see the L21 refinement below) — and, new, it kept trading after the
timeout (L24).

#### L24 — 🔴 P0: a start that times out leaves the engine trading while the backend reports ERROR (found by L23's live re-test, 2026-09-28)

At `10:03:59` the backend's command sweep gave up on the `BOT_START`
(`COMMAND_TIMEOUT_ENGINE_NO_RESPONSE`) and set the bot to ERROR — while the
engine, which had accepted the same command, kept the grid **live**: orders
continued to be placed and filled (`Buy order filled … 10:04:05`, `10:04:10`)
and the engine's own heartbeat kept reporting the bot as active
(`Heartbeat inventory drift: engine reports active bot the backend does not
track as running`, logged repeatedly from `10:04:29`). Exposure only ended when
a manual `POST /api/bot/management/stop` was issued (`Grid strategy bot stopped`
at `10:06:26`) — the account held `0.004 BTC` of live grid fills in the
meantime.

A timeout is a _backend bookkeeping_ outcome, never evidence that the engine
stopped working, so the two sides must not diverge silently: the sweep (or the
terminal-error handler) must also command the engine to stop/suspend that bot —
or the engine must refuse to keep trading a bot the lifecycle authority has
declared ERROR — and the drift must surface as an alert, not a `warn` in the
log. Fix together with L21 (one authority for command/state resolution), pinned
by a test that a timed-out start leaves no engine-side runner alive, and
verified live by requiring positions/flat exposure after the timeout.

**Fix (2026-09-28).** The timeout sweep and the heartbeat-inventory reconciler
now _repair_ terminal drift instead of only logging it. `BotEventProcessor`
gained an injected `TerminalBotStopRepair` wired to
`BotLifecycleService.stopEngineRunnerForTerminalBot()` (injected, not imported —
`BotLifecycleService` owns command dispatch and must not depend on the
processor):

- Called from `sweepTimedOutCommands()` (`command-timeout:<TYPE>`) and from
  `reconcileHeartbeatInventory()` (`heartbeat-inventory-drift`) — the two sweeps
  that can declare a bot terminal while a healthy engine still holds it.
- Only a terminal `actual_state` (`ERROR`/`STOPPED`/`UNKNOWN`, the exported
  `TERMINAL_ACTUAL_STATES`) is repaired. `RUNNING`/`STARTING`/`STOPPING` are
  explicitly _not_ second-guessed: there the engine inventory is merely ahead of
  the backend — a race, not drift.
- The stop goes through the normal tracked dispatch path
  (record-before-publish), so the timeout sweeper supervises it like any other
  command, and it is bounded by the shared `MAX_STOP_REISSUES_PER_HOUR` (moved
  to `lifecycle/types.ts` so the reconciler and this repair cannot drift apart).
  Past the budget the attempt is refused and logged at `error` with the engine
  id — a dead engine must not be spammed. Each attempt is audited as
  `RECONCILE_STOP_REISSUED` / `RECONCILE_STOP_REISSUE_FAILED` with
  `source: "terminal-state-drift"`.
- Best-effort by contract (it is called from supervision sweeps): it never
  throws, and an unknown bot, no engine binding or an unwired repair is logged,
  not fatal.

Pinned by the same new suite: a timed-out start dispatches the engine-side stop
("no orphaned exposure"), heartbeat drift on a terminal bot stops the runner, the
hourly budget bounds the repair, and a mid-lifecycle bot is never stopped by
drift alone.

---

## 4. Remediation ledger

Sequencing rationale: Phase 1 must precede Phase 2 (building reconciliation on top
of a request that never carries `client_order_id` would be built on sand); Phase 3
protects the state Phase 2 depends on; Phases 4–5 make the outputs trustworthy;
Phases 6–7 lock it in.

| Phase | Priority | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | –        | **Prove the P0s before changing code.** Verify N1/N2 against the Orderly testnet (place a LIMIT with a `client_order_id`, then resubmit the same key and record the rejection); add a zero-new-dependency wire test (local `node:http` server as the client's `baseUrl`) asserting the exact JSON body keys, the signed string, and the duplicate-key rejection; record the real order-status vocabulary                                                                                                                                         | 🔶 code-side done (`client.wire.test.ts`: body keys, signature verified with an independent Ed25519 implementation, duplicate-key rejection; status vocabulary recorded in `payload.ts`); ⬜ live-testnet probe (place + duplicate-resubmit + rejection capture) still open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1     | 🔴 P0    | **Exchange call contract.** Add a pure `toOrderlyOrderPayload()` mapper (snake_case) and sign the same serialized body; replace the `{botId}:{levelIndex}:{side}` key with a ≤36-char allowed-character deterministic key                                                                                                                                                                                                                                                                                                                        | ✅ `exchanges/kodiak/payload.ts` (+ `isAcceptedOrderlyClientOrderId` guard) wired into `createOrder`; `utils/client-order-id.ts` generates `<botKey>-<level(base36)>-<B\|S>` ≤36 chars; wire + unit + grid tests updated; N1/N2 closed in code — final confirmation pending the row-0 testnet probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2     | 🔴 P0    | **`OrderManager` + `OrderReconciliationService`.** Explicit order state machine (`INTENDED → SUBMITTING → UNKNOWN → OPEN / FILLED / NOT_FOUND(SAFE_TO_RECREATE) / EXCHANGE_UNAVAILABLE`); startup reconciliation before the first tick; `NOT_FOUND` releases the slot; cancellation resolves only when confirmed; the strategy keeps "what should exist" while the manager owns failure semantics                                                                                                                                                | ⬜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3     | 🔴 P0    | **Snapshot durability.** Temp file → `fsync` → atomic rename; keep the previous snapshot; checksum + schema validation of level entries; distinguish "no snapshot" from "corrupt snapshot" (never silently rebuild a fresh grid while exchange orders exist)                                                                                                                                                                                                                                                                                     | ⬜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4     | 🟠 P1    | **Durable trading ledger.** Persist order/fill intent before create; wire the engine to report fills (event or idempotent endpoint); fix the `trades.status` vocabulary, the `strategy_id`-scoped `bot_instances` update, and add an idempotency key on `(bot_id, client_order_id, exchange_order_id, fill_id)`                                                                                                                                                                                                                                  | ⬜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5     | 🟠 P1    | **Accounting correctness (N6).** Sell at the next level / take-profit, PnL from executed price with fees, `reduce_only` exits, position reconciliation from exchange positions, explicit `PARTIALLY_FILLED` handling                                                                                                                                                                                                                                                                                                                             | ⬜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6     | 🟡 P2    | **Failure-injection harness.** Fake exchange with scripted failures (accept-then-drop, timeout, 500, `NOT_FOUND`, duplicate-key rejection, partial fill) and a test matrix: crash at each point around submission, Redis down/restart, restart with/without/corrupt snapshot, exchange-side orphans                                                                                                                                                                                                                                              | ⬜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7     | 🟡 P2    | **Documentation split and drift removal.** `README` = what the system is today; `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, this tracker; track `docs/*.md` while keeping `docs/archived/` and `docs/instructions/` untracked; fix badges, dead paths, and the stale ratings table; document engine env vars in `.env.example`                                                                                                                                                                                                                 | ✅ (this pass; N8/N9 closed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8     | 🔴 P0    | **Identity & accounts data model** — many wallets and many exchange accounts per user, username (nick) login instead of email, exchange-agnostic credential envelopes, and a bot → exchange-account binding so the engine knows which account to trade. Blocks multi-account trading: `/credentials/:botId` can only return one account today. Design: [DATA_MODEL.md](DATA_MODEL.md); staged PRs **C1** identity, **C2** wallets + exchange accounts, **C3a** bot→account binding, **C3b** data tables: [plan §3](EXCHANGE_INTEGRATION_PLAN.md) | ✅ **C1, C2, C3a and C3b landed** — `users.username` + `user_identities` (C1) and `wallets` + `exchange_accounts` + adapters + UI (C2, migration `012_wallets_exchange_accounts.sql`); legacy tables dropped; single `UserLevelService` authority; Settings multi-wallet and multi-venue accounts wired. **C3a** bot-account binding landed (migration `013_bot_account_binding.sql`): bots carry `exchange_account_id`, `/credentials/:botId` serves that bound account's envelope (kodiak + lighter), revoking an account with bots bound is refused (409), and the start flow requires an explicit account. **C3b** (positions/balances per account, then the `kodiak_*` drops) landed (migration `014_drop_legacy_kodiak.sql`): position/balance readers and schema validators moved onto `exchange_positions`/`exchange_balances` (ownership via `exchange_accounts` join), the venue sync (`exchange-snapshot.adapter`) repopulates them per account from live reads, `GET /api/market/{positions,balance,trades}` accept `?exchangeAccountId=` with account-keyed caches and the Dashboard picker pins display to the selected account, `bot_instances.exchange_account_id` is `NOT NULL`, and `kodiak_accounts`/`kodiak_positions`/`kodiak_balances`/`kodiak_statistics` are dropped (grep gate: zero `kodiak_positions\|kodiak_balances` hits under `backend/src`). Acceptance run and evidence: §4 batch verification (2026-09-27). Follow-ups designed: plan §D (bot account sessions) and §E (agent participation); live 2026-09-30 P4: foreign exchangeAccountId -> 404, revoke with live bot -> 409 boundBots, revoke with terminal history -> 200 with the stopped bot cleared (19-p4-l19-accounts.log) |
| 9     | 🔴 P0    | **Credential-contract slice (workstream A)** — `EngineCredentials` discriminated union in `shared`, backend `/credentials/:botId` returns `{ exchange, environment, accountRef, credentials }`, engine client factory selects by exchange. Stops the Orderly-shaped contract being baked further before Lighter lands: [plan §1](EXCHANGE_INTEGRATION_PLAN.md)                                                                                                                                                                                   | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 10    | 🔴 P0    | **Lighter engine adapter (workstream B)** — extend `ExchangeClient` (open-order listing, by-client-order-id lookup that separates NOT_FOUND from UNREACHABLE, confirming cancel, HTTP timeouts), `TransactionSigner` + sidecar client, `LighterClient` encoding the Phase-0-verified status/market/cancel semantics, strategy decoupled from `OrderlyClient`: [plan §2](EXCHANGE_INTEGRATION_PLAN.md)                                                                                                                                            | ✅ **B1-B5 complete** (B1 `ExchangeClient` extension + Kodiak timeouts, B2 `TransactionSigner` + sidecar client, B3 `LighterClient` with Phase-0 status/market/int64-id semantics, B4 strategy + BotRuntime on the `ExchangeClient` interface, factory routes lighter; B5 fake-exchange Jest matrix + env-gated testnet smoke **green 2026-09-22** — market resolve → resting order → query by client index → `getOrder` → polling-confirmed cancel, all through the engine's own client. B5 live findings also fixed and pinned by tests: human-unit row mapping (price/qty), OPEN-first row selection over multiple rows per index, active-listing-first liveness, client-index order handle for cancel/`getOrder`. Sidecar runbook: OPERATIONS §5.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| –     | 🟢 P3    | **Do not** add further abstraction beyond `OrderManager` / `OrderReconciliationService`; **do not** split the `shared` package yet; **no** frontend work                                                                                                                                                                                                                                                                                                                                                                                         | –                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Runtime-audit backlog — 2026-09-26 flow test (owner-scoped P0 batch)

Findings L1–L10 in §3 are tracked here; the phase table above covers the
engine/trading-path phases. P0 = what must land before the C2/C3 acceptance runs
can be repeated meaningfully.

| #   | Priority | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | 🔴 P0    | Repoint the frontend's bot calls to `/api/bot/management/*` (`trading.ts` + `tradingApi.test.ts`), correct `backend/README.md` / `OPERATIONS.md` / `management.ts` docblocks / `frontend/README.md`, retire the duplicate `GET /api/bot/management/engine/status`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L2  | 🔴 P0    | Venue-agnostic portfolio account selection + switcher (Dashboard, `BotControls`); no `exchange === "kodiak"` default; the app-global balance widget follows the selection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L3  | 🔴 P0    | Await Express configuration before `listen()`; mount `contextMiddleware` + `httpLogger` before any router (so `/api/auth` is covered); remove the listen-before-routes window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L4  | 🔴 P0    | Wire `logger` into the `ServiceFactory`'s `ExchangeAccountService` (or delegate to the DI instance) + a test asserting the dependency exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L5  | 🟠 P1    | Venue-aware connect/verify logging (`exchange`, `environment`, verifier step timings, outcome — never secrets), including the Lighter verifier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ Done (L5–L7 batch, 2026-09-28) — the dead `LighterVerifierLogger` is wired in and `verify()` narrates both steps (`Lighter credentials verified` / `Lighter verification failed - account lookup\|key ownership`, with `exchange`, `environment`, `accountIndex`/`apiKeyIndex`, `accountLookupMs`, `keyOwnershipMs`, bounded reason); `ExchangeAccountService` logs `Exchange account verification started\|completed\|failed` for connect **and** re-verify with `exchange`/`environment`/`durationMs`, `Exchange account connected\|verified` carry the venue, and the Kodiak probe gains `exchange` + `durationMs`. No credential material on any line (asserted). Pinned by 4 `lighter-verifier` L5 cases + 2 `exchange-account.service` cases |
| L6  | 🟠 P1    | Duplicate-registration log: `info` + masked email, plus a distinct error code for "email already registered"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Done (L5–L7 batch, 2026-09-28) — `ErrorCodes.EMAIL_ALREADY_REGISTERED` + `EmailAlreadyRegisteredError` (409, `hint: "log in instead"`); `register()` logs `Registration skipped - email already registered` at `info` and returns the code (incl. the race-window branch, mirrored through `convertToLegacyFormat`); the route maps the code to 409, other failures stay 400. Broader hygiene: all raw-email log sites in `auth.service.pure.ts` + `interfaces/http/auth/index.ts` now use `maskEmail` (`backend/src/shared/utils/masking.ts`), while audit rows and responses keep the real address. Pinned by 5 `masking` + updated/added service cases + a controller 409 case                                                                  |
| L7  | 🟠 P1    | Pass the request's `correlationId`/`requestId` explicitly when logging the HTTP response (stop resolving ALS at `res.end` time)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ Done (L5–L7 batch, 2026-09-28) — `httpLogger` captures both ids in its closure and passes them per-call on `"HTTP response"`; per-call meta wins in `ContextAwareLogger.getContextInfo()`, so the sibling-request mis-correlation is gone. `operationDuration` still comes from the async store (L8/L9). Pinned by 3 `middleware.logger` cases incl. an ambient-drift regression                                                                                                                                                                                                                                                                                                                                                                   |
| L8  | 🟡 P2    | Remove the boot-wide `setRequestContext`; give each background subsystem its own stable scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ Done (L8–L10 batch, 2026-09-29) — boot `setRequestContext` deleted from `index.ts`; `context.ts` adds cached `getBackgroundContext(subsystem)` (`bg_<subsystem>_<8hex>`) + `runWithBackgroundContext` (`ALS.run` only); `runWithContext` no longer `enterWith`s (L7 root cause). Scoped: `db-pool` (pool init/events/metrics), `redis`, `websocket` (Socket.IO engine), `password-pool`. Pinned by `tests/unit/context.background.test.ts` (3 cases); live 2026-09-30 P1: per-subsystem boot scopes observed in prod boot log (03-p1-boot-scopes.log) |
| L9  | 🟡 P2    | Construct long-lived pools eagerly so they stop inheriting a request context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Done (L8–L10 batch, 2026-09-29) — `index.ts` warms the pool via new `ensurePasswordWorkerPool()` before `listen()` (no-op in test env); pool ctor, health interval, all worker listeners run in `background:password-pool` scope; DB metrics behind `startPoolMetrics()`/`stopPoolMetrics()`. Lazy getters kept for adapters/tests. Pinned by `context.background.test.ts` + `password-worker.test.ts` (58 pass incl. logger suites); live 2026-09-30 P1: eager pools + warm line observed in prod boot log (03-p1-boot-scopes.log) |
| L10 | 🟡 P2    | Shutdown: per-stop durations, bounded Phase 1 (`closeIdleConnections`/`closeAllConnections`), flush logs before `process.exit(0)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ Done (L8–L10 batch, 2026-09-29) — `stopServer()` drops idle sockets now, force-closes after 5 s, bounds at 10 s; `keepAliveTimeout = 5 s`; `gracefulShutdown` runs `stop-socketio`/`stop-http`/`stop-engine-listeners`/`disconnect-redis`/`stop-db-metrics`/`shutdown-password-pool`/`close-db-pool` through `timedShutdownStep` (`{step,durationMs}` + Phase 1 summary); `flushLogs()` (bounded 3 s) awaited on success, error, and 30 s-timeout paths. `tsc --noEmit` clean, eslint clean; live 2026-09-30: full 4-phase shutdown trail, graceful completion 18 ms core, complete final-phase flush (08-l10-retest-result.log) |
| L11 | 🔴 P0    | Portfolio reads were Kodiak-only: venue-dispatch `/api/market/{positions,balance,trades}` + the Lighter portfolio reader (sidecar `auth-token`), drop the Dashboard venue gate on positions/trades (the balance-widget error channel is L15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L12 | 🟠 P1    | `strategies.active` write-once FALSE: `syncStrategyActive` on start/stop/emergency/terminal-error/timeout, post-create "Start now?" prompt, drop the duplicate `UserProgressCard` from Strategies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L13 | 🟡 P2    | Lighter signer sidecar: `scripts/dev-sidecar.sh` + `npm run dev:sidecar` folded into `npm run dev`; document the shared-singleton model and its three consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L14 | 🟡 P2    | WS client retries in a loop after `WS_AUTH_FAILED` (stop the timer, refresh the token once, then retry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ Done (L14, 2026-09-29) — one silent cookie-based session refresh (`GET /api/auth/me` via `session-refresh.ts`) before declaring the session dead; success retries the handshake at once, failure fires `auth:session-expired` once and never retries (previously ⬜ Open); live 2026-09-30 P2: Phase C expired+valid refresh -> 200 + full cookie rotation, Phase D dead refresh -> 401 -1002 + cookie clear, WS handshake -> WS_INVALID_TOKEN definitive (14-p2-l14-retest.log) |
| L15 | 🟡 P2    | Give the balance widget an error channel (`globalBalanceManager` → `useBalance` → UI) and drop the 400/403→"not connected" mask + venue-neutral message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ Done 2026-09-29 — error channel `getKodiakBalance` (throws `toBalanceError`, venue-neutral `Balance unavailable: …`) → `globalBalanceManager` (`lastBalanceError` + per-subscriber `onError`, cleared on next success) → `useBalance.error` → Dashboard + Strategies render "Balance unavailable" instead of $0/stale; pinned by `kodiakApi.test.ts` + `shared/balance-manager.test.ts`; live 2026-09-30 P3: sidecar down -> HTTP 400 with venue-neutral reason (never zero/stale), restore -> 200 with error cleared, deployed dist renders the unavailable state (15-p3-l15-balance.log) |
| L16 | 🟡 P2    | `strategies.active` was inserted as NULL (the Joi schema omits the key, the INSERT passed it explicitly, so the column default never applied): resolve to `false` in the adapter + regression test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L17 | 🔴 P0    | The engine process could not start (`module: ES2022` + `moduleResolution: bundler` in a typeless package → ESM emit with extensionless specifiers → `ERR_MODULE_NOT_FOUND`; ts-jest hid it): emit CommonJS like the backend, add the `@trade-bot/shared` `paths` entry, and prove it with `npm run prod:engine`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L18 | 🔴 P0    | Engine dispatch uses the legacy `isStartBotCommand`/`isStopBotCommand` guards (`shared/src/types/engine-contract.ts:331,346`), so protocol `BOT_START`/`BOT_STOP` envelopes fall through `handleCommand` and are silently ACKed → `ENGINE_NO_RESPONSE`: switch `engine/src/protocol/command-consumer.ts` to protocol `isBotStartCommand`/`isBotStopCommand`, add the first engine consumer test, rebuild `engine/dist` (+ in the same change, the credential fetcher's missing `?correlationId` query param found by the live re-test); live 2026-09-28: dispatch proven for both commands                                                                                                                                                                                     | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L19 | 🟠 P1    | Stop/emergency-stop 404: the `bot-instances` cache maps `id: bot.strategy_id` (`useBotLifecycle.ts:125`, `strategyService.ts:166`), so `/management/stop` receives the strategy UUID and `findBot` 404s: map `id: bot.id`, audit every `bot.id` consumer, pin with a frontend test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Done 2026-09-29 — the ["bot-instances"] cache maps `id: bot.id` (`bot_instances.id`) in both producers (`useBotLifecycle.ts`, `strategyService.getAllBotInstances()`), so stop/emergency-stop send the id `/api/bot/management/instances` returned and `findBot()` resolves it; audit: `useBotState(bot.id)` by id, `bot.stateChanged` patch on `bot.id === data.botId` (all backend emits already pass `bot.id`), Strategies/`useStrategies` lookups unchanged on `strategy_id`; pinned by 3 `useBotLifecycle.test.tsx` + 2 `BotControls` payload cases; live click-through re-run 2026-09-30 P4: stop with the list id -> 202 (strategy id -> 404 repro), emergency-stop -> 200 with no 404 (follow-through gap found, see M1), start -> RUNNING twice with 0 ENGINE_NO_RESPONSE, delete active -> 409 / terminal -> 200, bot.stateChanged emits bot.id (19-p4-l19-accounts.log)                                                                                                                                                       |
| L20 | 🟠 P1    | Start never reaches `RUNNING` on Lighter: `strategies.config.symbol` = `PERP_BTC_USDC` is not a Lighter market (venue lists `BTC`/`SOL`/`ETH`/`ETH/USDC`/`LIT/USDC`) → `UnknownMarketError` → `INIT_FAILED` → ERROR: venue-aware symbol validation/filtering at creation and/or start, fail fast with a user-facing reason, venue-aware start gate (`venue-symbols.ts`: live catalog per venue, case-insensitive resolve, **fail-open** when unavailable) called from `createAndStart` before the row insert, the start route passing `400`/`409` messages through, the union symbol list in `StrategyForm`; pinned by 9 `venue-symbols` + 3 service + 1 controller case; live 2026-09-28: non-venue symbol → **400** with no bot row, `BTC` → **202** to engine strategy init | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L21 | 🟠 P1    | `COMMAND_FAILED` does not resolve the tracked lifecycle command — the engine answered (`INIT_FAILED` logged at 08:08:07) yet the same correlationId timed out as `ENGINE_NO_RESPONSE` (`COMMAND_FAILED / INIT_FAILED` at 08:08:07 → timeout 08:08:40; and the **accepted** path 2026-09-28: accept published at 10:03:28, orders filled, still `ENGINE_NO_RESPONSE` at 10:03:59): one authority resolves command rows (accept/fail/timeout) + a test that a resolved command never times out                                                                                                                                                                                                                                                                                   | ✅ Done 2026-09-28 — root cause: a type-strict epoch check (`engine_registry.epoch` is `BIGINT`, so node-postgres returns `"19"` while the engine sends the JSON number `19`) rejected every accept/fail/state-change as "epoch mismatch"; `epochsMatch`/`normalizeEpoch` make the comparison type-agnostic and fail-closed, a rejected runtime event is now logged at `error` with its command context, and the engine also ACKs `BOT_STOP` — pinned by `lifecycle-command-authority.test.ts` (8 cases) + the epoch-skew cases                                                                                                                                                                                                                       |
| L22 | 🟡 P2    | Non-`CommandError` business failures (unknown market, backend 4xx) are retryable forever and poison entries are only logged, never ACKed: wrap them in non-retryable `CommandError` at the boundary + ACK past the poison threshold (alert + drop)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Done 2026-09-28 — the engine rethrows every failure it already reported to the backend (COMMAND_FAILED + STATE_CHANGED ERROR) as a non-retryable CommandError so the consumer ACKs it instead of redelivering, and both consumers alert-and-ACK a pending entry past PENDING_POISON_MAX_DELIVERIES through the new getPendingDeliveries() PEL lookup; pinned by 3 new command-consumer cases + the bot-manager wrap case                                                                                                                                                                                                                                                                                                                           |
| L23 | 🟠 P1    | Lighter's `queryOrderByClientOrderId` treats its argument as the venue's numeric client order index, but the grid passes the contract id (`grid.ts:328,396,434`) → `accountOrders?client_order_indexes=<string>` → **400** → `UNREACHABLE` → every slot frozen → no ACK → 30 s `COMMAND_TIMEOUT_ENGINE_NO_RESPONSE` → ERROR: derive the index with `clientIndexFromString` in the query path too (numeric handles stay verbatim), compare rows against it, and require a live start to reach `STATE_CHANGED → RUNNING`                                                                                                                                                                                                                                                         | ✅ Done — live 2026-09-28: orders placed + filled on Lighter, zero slot freezes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| L24 | 🔴 P0    | A timed-out `BOT_START` leaves the engine trading while the backend reports ERROR: after the 10:03:59 sweep wrote `COMMAND_TIMEOUT_ENGINE_NO_RESPONSE` the engine kept placing/filling orders and its heartbeat logged `Heartbeat inventory drift` repeatedly (exposure ended only on a manual stop, 10:06:26): the sweep/terminal-error handler must stop the engine-side runner (or the engine must not trade a bot declared ERROR), the drift must alert, pinned by a test that a timed-out start leaves no live runner                                                                                                                                                                                                                                                     | ✅ Done 2026-09-28 — the timeout sweep and the heartbeat-drift reconciler now dispatch a bounded, audited `BOT_STOP` (`RECONCILE_STOP_REISSUED`, `MAX_STOP_REISSUES_PER_HOUR`) through `BotLifecycleService.stopEngineRunnerForTerminalBot()` for terminal states only (`ERROR`/`STOPPED`/`UNKNOWN`; mid-lifecycle states are not second-guessed) — pinned by the same suite (no runner left behind after a timeout, budget enforced, mid-lifecycle untouched)                                                                                                                                                                                                                                                                                        |
| L25 | 🟠 P1    | A `COMMAND_FAILED` event for a bot that is already terminal is applied as a state transition and throws `Invalid bot state transition: STOPPED -> ERROR`, so the message is left unacked and redelivers forever (~60 s apart, no attempt cap, no ACK) — the events-stream twin of L22; observed 12× on 2026-09-28 14:11–14:22 and reproduced on demand at 20:29 (`XPENDING tradebot:engine:events backend-group` deliveries climbing)                                                                                                                                                                                                                                                                                                                                          | ✅ Done 2026-09-28 — handleCommandFailed no longer applies a failure as a transition when the bot cannot reach ERROR (STOPPED to ERROR is illegal): it records the failure as bookkeeping (command resolved FAILED, audit row with the unchanged state, no state-changed emit), and the events consumer caps any still-failing handler at PENDING_POISON_MAX_DELIVERIES (alert + ACK); pinned by the L25 case in lifecycle-command-authority.test.ts + 4 engine-protocol-poison cases                                                                                                                                                                                                                                                                 |
| M1  | 🔴 P1    | Emergency-stop never reaches the engine: the HTTP handler writes `status=FORCE_STOPPING` + an audit row and returns 200, but `EngineManagerService.sendEmergencyStopCommand` (the only `EMERGENCY_STOP` publisher, `engine-manager.service.pure.ts:678`) has **zero callers**, and the engine has no `EMERGENCY_STOP` handler at all — so the bot stays `actual_state=RUNNING` with the engine still trading, and nothing drives `FORCE_STOPPING → STOPPED`. Found live 2026-09-30 (P4, bot `6e02622e`, evidence `.git/gatelogs/prod/19-p4-l19-accounts.log`) | ✅ Code complete 2026-09-30 — the panic path is now a real, audited command: route → `BotLifecycleService.emergencyStop` (RUNNING-only 409, CAS `desired=STOPPED/actual=STOPPING`, `bot_lifecycle_events` trail, dispatch **before** returning **202**) → `EMERGENCY_STOP` on the live protocol → engine `handleEmergencyStop` (RUNNING→STOPPING → `strategy.stop()` + runner kill + deregister → orphan cancel via `listOpenOrders` → position flatten unless another bot shares the symbol → STOPPING→STOPPED). Row badge `FORCE_STOPPING` is written after the CAS and converged back to `STOPPED` by the engine's terminal `STATE_CHANGED`; the tracked command is timeout-supervised (`EMERGENCY_STOP` + STOPPING now classifies as `STOP_INCOMPLETE` → UNKNOWN + bounded stop repair instead of ERROR). Dead code deleted: `BotManagementService.emergencyStop` (row-flip stub) and `EngineManagerService.sendEmergencyStopCommand`; single-bot `bot ID required`/403-VERIFIED/503-control-plane gates mirror `/stop`. Unit-pinned by `bot-lifecycle.service.test.ts` (emergency suite + timeout classification), `command-consumer.test.ts` (dispatch + malformed-payload), `bot-manager-emergency.test.ts` (6 action/guard cases) — 3 backend + 3 engine suites green. **Live P4 re-test: PASS 2026-09-30** (`.git/gatelogs/prod/27-p4-m1-live-fix2.log`, 20/20 assertions, `failures=0`): 202 + `FORCE_STOPPING` badge → engine `STATE_CHANGED STOPPED`, `status=STOPPED` with no `FORCE_STOPPING` residue, tracked `EMERGENCY_STOP` command ACCEPTED, 409/400/404/403 negatives, terminal row deleted. The panic also **cleared real exposure** — `Emergency stop: position flatten order placed` (SELL 0.1 ETH, `status=FILLED`), venue-verified flat afterwards (account 123: position `0.0000`, 0 open orders; from 0.1 long). Two venue rules the first pass missed were found by re-running the gate and are now fixed and live-proven: **(A2)** `client_order_index` must be ≤ 281474976710655 (2^48 − 1) — the derived 2^62 index was refused ("ClientOrderIndex should not be larger than 281474976710655") and 400'd the follow-up history query (`d632f2`→`LIGHTER_CLIENT_ORDER_INDEX_MOD = 2 ** 48`, `client-order-id.ts`); **(A3)** an IOC create must carry `order_expiry: 0` ("OrderExpiry is invalid" otherwise) while the sidecar default is a positive GTT expiry (`SignerService._resolve_expiry` now resolves per TIF, `signer.py`). Diagnosability: 4xx failures now carry the venue's `{code,message}` body and a refusal is logged/surfaced with its cause (`Lighter create refused`), so "unreachable after refusal" can no longer hide the real reason. Coverage: engine full suite 131/131 (18 suites; +3 `client.test.ts`, `units.test.ts` bound pin), sidecar pytest 14/14 (+2 IOC/GTT expiry), engine+backend lint/prettier/tsc green; first pass (`25-p4-m1-live-fix.log`) is the pre-fix evidence of both errors |
| L26 | 🟠 P1    | Newly discovered 2026-09-30 while verifying §2 claim 1: `BotManagementService.createAndStartBot`/`.stopBot` (and the private `.generateBotId()`) were a service-level twin of the dead `engine.ts` HTTP writers — direct `bot_instances.status` flips with no compare-and-set, no `bot_lifecycle_events` trail and no command to the engine (so a DB row could read `RUNNING` while nothing traded); superseded by `BotLifecycleService.createAndStart()`/`.stop()` but still public and still carried in the controller test's service-provider mock | ✅ Done 2026-09-30 (`8af8fc8`, +13/−360) — both methods + `generateBotId` deleted, class header rewritten to the read-side responsibility (lifecycle writes belong to `BotLifecycleService`, mirroring the `emergencyStop` removal in `c9a5ce1`), 3 dead test suites + 2 stale mock entries dropped, DI contract unchanged; gates: `tsc --noEmit` clean, eslint clean on the touched files, backend unit 129/129 · 2447 green |


Batch verification (2026-09-28, `prod:all`, evidence `.git/gatelogs/L21L24/`):
**L21 verified** — start `ACCEPTED` in 172 ms / 557 ms on two epochs, `STARTING →
RUNNING` in 1.15 s, stop `ACCEPTED` in 786 ms / 934 ms, zero `ENGINE_NO_RESPONSE`
and zero epoch-mismatch lines; **L24 verified** — a `SIGSTOP`ped engine times a
start out exactly as designed (`ENGINE_NO_RESPONSE` → `ERROR`, repair skipped
with `bot has no engine binding`, and on resume the stale-generation gate + the
engine's 409 leave **no runner and no orders**), and the heartbeat-drift branch
audits `RECONCILE_STOP_REISSUED` ×2 (`source: terminal-state-drift`) with both
stops `ACCEPTED`, `UNKNOWN → STOPPED`, venue left with 0 active orders; **L5/L6/L7
verified live** (venue-aware verifier line with accountIndex/apiKeyIndex/step
timings and no credential material, 409 `EMAIL_ALREADY_REGISTERED` + `hint` with
`j***e@example.com` in the log, response lines repeating the request's
`correlationId`). New from that run: **L25** (terminal-state `COMMAND_FAILED`
poisons the events stream) plus two residues — `desired_state` stays `RUNNING`
after a drift repair while `status` is `STOPPED`, and a timed-out start is parked
in `actual: ERROR` forever with no clearing affordance.

Batch verification (2026-09-28, L22 + L25): unit-pinned rather than
live-replayed — `command-consumer.test.ts` (business failure ACKed without a
PEL round-trip, transient failure left pending under the cap, poison entry
ACKed at the cap), `bot-manager-credentials.test.ts` (a plain axios-style
failure reported to the backend is rethrown as a non-retryable
`CommandError`), `engine-protocol-poison.test.ts` (event consumer ACKs a
clean event, leaves a sub-threshold failure pending, drops one at the cap and
marks it processed, and fails open when the delivery counter cannot be read),
and `lifecycle-command-authority.test.ts` (COMMAND_FAILED for an
already-STOPPED bot resolves the row, keeps the state and writes the audit
row).

Live, 2026-09-29 (`prod:all`, engine epoch 26): **L22** — a real
`INIT_FAILED / 401` start left `XPENDING tradebot:engine:commands = 0` and
**zero** poison warnings for the session (the same shape spent 3.2 h / 42
deliveries in the PEL the day before); **L25** — a `COMMAND_FAILED` /
`BOT_NOT_FOUND` event for the STOPPED bot `22ca5ebb` injected with the real
envelope (`.git/gatelogs/L21L24/inject-l25-event.js`) produced
`Command failed for a bot past a failable state - recorded as bookkeeping`,
an audit row `COMMAND_FAILED STOPPED → STOPPED`, an unchanged bot row and an
immediate ACK, where pre-fix it was `Invalid bot state transition: STOPPED ->
ERROR` + unacked. Side finding: the same injection harness with a non-uuid
correlationId throws before the state check and was **capped by
`PENDING_POISON_MAX_DELIVERIES` live at exactly 10 deliveries**
(`Poison engine event ACKed and dropped after repeated redelivery`, 08:13:10,
after which the events PEL was 0) — the events-side drop path observed in
production behaviour, not just in a unit test.
Environment note: Lighter **testnet** now answers 401
`invalid auth: couldnt find account` for `account_index=404` (200 at
2026-09-28 20:58), so starts fail fast with `INIT_FAILED / 401` and place no
orders until the account is re-created.

Batch verification: re-run the manual flow (login → dashboard → settings → connect
Lighter → strategies → create grid strategy → start a bot on the Lighter account →
dashboard → SIGINT) and require — `GET /api/bot/instances` **200**; `POST
/api/bot/management/start` **202** with the account bound; the 409 negatives
(foreign account, unbound legacy bot, revoke-with-bound-bots); "Exchange account
connected" plus venue-aware Lighter lines present; zero mis-correlated response
lines; a fully-logged shutdown.

Batch verification (2026-09-27, L11–L13): with a connected Lighter account selected
on the Dashboard, require **non-empty** balance / positions / trades (i.e.
`GET /api/market/{balance,positions,trades}?exchangeAccountId=<lighter>` **200** and
`sidecar /v1/auth-token` **200**), and that a Kodiak selection still renders as
before; a freshly created strategy shows the **"Start now?"** prompt, and after a
start its badge reads **Active** and returns to **Inactive** after stop; no
`UserProgressCard` on the Strategies page; `npm run dev` brings up the sidecar.

Batch verification (2026-09-27, L18–L19): with `npm run prod:all`, Start must
yield `STATE_CHANGED → RUNNING` with no `ENGINE_NO_RESPONSE`, and Stop /
emergency stop from the Strategies card must return **202** with the request's
`botId` equal to the `id` returned by `GET /api/bot/management/instances`.
(2026-09-28 re-run: the L20 gate rejects a non-venue symbol with **400** and
dispatches a valid symbol to engine strategy init. Second re-run after L23:
Lighter orders are **placed and filled** with zero `Order slot frozen` lines and
the portfolio shows exactly the filled size. After L21/L24 (2026-09-28) the
remaining live assertion is that a start the engine answers reaches
`STATE_CHANGED → RUNNING` with no `ENGINE_NO_RESPONSE`, and that a timeout/ERROR
leaves no engine-side runner behind (a bounded, audited `RECONCILE_STOP_REISSUED`
must appear if the engine still held the bot).)

---

## 5. History — previous review passes

Earlier review material is preserved untracked under `docs/archived/`
(`PROJECT_REVIEW.md`, `PROJECT_REVIEW_GAP_ANALYSIS.md`, `CRITICAL_ISSUES.md`).
The archive below records the findings those passes resolved. It is reproduced as
written at the time, so file paths inside its tables refer to the pre-refactor
layout (`engine/kodiak/src/...` — those files now live under `engine/src/`; see
finding N9).

Status of the two items that were still open when this archive was written:

- **Docs not version-controlled** — ✅ resolved in this pass: `docs/*.md` is
  tracked; `docs/archived/` and `docs/instructions/` stay untracked.
- **Shared Package Scope** — ⬜ still open (P2, deliberately deferred; see §6).

### 5.1 Resolved findings archive (2026-09-14 → 2026-09-15)

<details>
<summary><strong>Resolved Issues Archive (2026-09)</strong></summary>

### ✅ Recently Fixed

| Issue                             | Fix                                                                                                                                                                                                       | Files Changed                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Overlapping Strategy Ticks**    | Replaced `setInterval()` with sequential tick loop using self-replacing `setTimeout`. Added single-flight guard (`tickRunning` flag) to skip interval if previous tick still executing.                   | `engine/kodiak/src/index.ts`           |
| **Trading Operation Idempotency** | Added deterministic `clientOrderId` generation using format `{botId}:{levelIndex}:{side}`. Same bot/level/side always produces the same ID, allowing exchange to detect duplicates on command redelivery. | `engine/kodiak/src/strategies/grid.ts` |

### 🔴 Critical (P0)

| Issue                              | Description                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reconciliation Worker Disabled** | ✅ Fixed: Replaced by a lifecycle-aware reconciler (`LifecycleReconciliationService`) that repairs desired/actual drift through `BotLifecycleService` only, with bounded stop-reissues, stuck-transition degradation to UNKNOWN, audit events, and CAS-safe transitions. The superseded `BotReconciliationWorker` has been deleted. |

### 🟠 High (P1)

| Issue                         | Description                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Redis Failure Semantics**   | ✅ Fixed: Bot start/stop endpoints now return 503 when Redis is unavailable. Health endpoint includes `controlPlane` status.                                                            |
| **Engine Monolithic Design**  | ✅ Fixed: The engine's `BotManager` is embedded in `index.ts`, handling command consumption, heartbeats, bot lifecycle, credential retrieval, and strategy scheduling in a single file. |
| **Command Timeout Semantics** | ✅ Fixed: Added timeout reason tracking with appropriate state transitions.                                                                                                             |

### 🟡 Medium (P2)

| Issue                        | Description                                                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Legacy Bot Status Models** | ✅ Fixed: Consolidated around canonical `BotActualState` from `@trade-bot/shared/src/protocol`. Removed duplicate enums and inline status strings.                                                                                            |
| **Shared Package Scope**     | `@trade-bot/shared` has become a god package containing protocol types, domain models, API contracts, error classes, and logging types. Should be split.                                                                                      |
| **Dead Code Cleanup**        | ✅ Fixed: Removed the dormant Orderly `market-stream` subsystem, the superseded `BotReconciliationWorker`, the `service-selector` rollout shim, unused WebSocket/DI getters, unused frontend `QuickActions`, and one-off Redis debug scripts. |

### 🔐 Security Review Findings (2026-09-15)

Findings from a security-focused code review, prioritized per severity:

#### 🔴 Critical (P0)

| Issue                                                             | Description                                                                                                                                                                                                                                                                                                                                               | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refresh tokens accepted as access tokens**                      | `JwtTokenAdapter.verifyToken()` fell back to verifying with `JWT_REFRESH_SECRET` after `JWT_SECRET` failed, and `validateToken()` (guarding every API route and WebSocket auth) used it. A stolen 30-day refresh token presented in the `Authorization` header produced a valid session, bypassing the 4h access-token TTL and refresh rotation entirely. | ✅ Fixed: Tokens now carry a `type` claim (`access`/`refresh`); verification is secret- and claim-strict per call site — the access path never accepts refresh tokens and vice versa. Note: previously issued tokens without the `type` claim are rejected; users must re-authenticate after deploy — handled gracefully: definitive refresh failures now return `401 { code: -1002 }` with session cookies cleared, and the frontend force-resets auth state and routes to `/login` instead of leaving the user stranded. (`jwt-token.adapter.ts`, `shared/types/infrastructure.ts`) |
| **Logout did not invalidate tokens**                              | The logout route had a TODO relying on natural expiry, and `invalidateUserTokens()` blacklisted nothing. The `jwt:blacklist:{hash}` cache keys existed but were never written or checked. Combined with the issue above, a logged-out refresh token remained a fully functional credential for 30 days.                                                   | ✅ Fixed: Logout now blacklists the presented refresh + access token hashes (TTL = remaining token lifetime), `refreshToken()` rejects blacklisted refresh tokens, and `validateToken()` rejects blacklisted access tokens. Blacklist lookups fail open during cache outages. (`auth.service.pure.ts`, `interfaces/http/auth/index.ts`)                                                                                                                                                                                                                                               |
| **Encryption key rotation was a no-op that corrupted versioning** | `rotateEncryptionKeys()` inserted the new key under the _old_ `CURRENT_KEY_VERSION`, computed the new version locally without persisting or applying it, and never re-encrypted existing credentials — risking PK conflicts and unrecoverable exchange credentials. `getVersionedKey()` also had no real version-3+ support.                              | ✅ Fixed: Rotation derives the next version from `MAX(version)` in `encryption_keys`, stores the new key wrapped under the master key (version-1 envelope), bumps the instance's current version, and re-encrypts all existing credentials (legacy non-versioned rows handled separately). Versions 1/2 keep their legacy master-key aliasing for backward compatibility. (`encryption.service.ts`)                                                                                                                                                                                   |

#### 🟠 High (P1)

| Issue                                                 | Description                                                                                                                                                    | Status                                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Engine API key compared with `!==`**                | `botEngineAuth` middleware used a non-constant-time string comparison.                                                                                         | ✅ Fixed: Uses `crypto.timingSafeEqual` on length-checked buffers. (`interfaces/http/bots/engine.ts`)                                                                                             |
| **`KeyManagementService` async init fire-and-forget** | Constructor kicked off async key derivation and rethrew inside `.catch()` — an unhandled promise rejection; callers could race against partial initialization. | ✅ Fixed: Derivation is tracked in an `initializationPromise`; `ensureInitialized()` awaits it and surfaces failures with retry support instead of swallowing them. (`key-management.service.ts`) |
| **Broken test suite**                                 | `database-migrate.test.ts` failed to compile (imported a deleted `src/database/migrate` module).                                                               | ✅ Fixed: Stale test removed (the module was replaced by the ledger-tracked `scripts/run-migrations.js` runner).                                                                                  |
| **Tests that cannot fail**                            | `workers.test.ts` wrapped assertions in `try { … } catch { }` / logged-and-ignored catches — tests passed even when assertions failed.                         | ✅ Fixed: Swallowing try/catch wrappers removed; assertions now propagate. Also removed a test `console.log` printing a token (`middleware.auth.test.ts`).                                        |

#### 🟡 Medium (P2) — remaining from the review

| Issue                                                                                              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **God files / duplicated auth logic**                                                              | `redis.service.ts` (1,385 lines), `kodiak-integration.service.ts` (1,184), `market.ts` (954) should be decomposed. `auth.middleware.ts` duplicated the refresh handling (~100 lines) and used a `require()` to dodge a circular DI import.                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Fixed: `redis.service.ts` is now a 532-line thin facade over `redis/` components (inline `TransactionRecoveryManager`/retry-types duplicate removed; atomic/cache/transaction methods delegated to `redis/operations                                                                                                                                                                                                                                                                                                                                                                                                                          | atomic-operations | cache-manager | metrics | transactions`; dual-client collapse into `RedisConnectionManager`; self-import fixed; legacy `getWithVersion`/`del`/`isHealthy`/`getCacheStats`/`atomicIncrementWithExpiry`semantics preserved and pinned by tests).`kodiak-integration.service.ts`split into`infrastructure/external/kodiak/` (`types`, `fetch-options`, `public-fetch`shared fetch path,`credentials-provider`backed by the repository adapter instead of raw SQL,`private-data`, `market-data`) with the service kept as a compatibility facade. `market.ts` split into per-domain route modules (`market-ticker | futures | portfolio | ws-url | tv  | klines | kline-history.routes.ts`) with shared `market-helpers.ts`/`market-cache.ts`(single`roundTo5Minutes`+ cache-key builder);`market.ts`is now a router composer. Auth middleware deduplicated into`finalizeRefreshedSession`/`respondToFailedRefresh`helpers with the`require()`dodge replaced by a lazy`serviceProvider`lookup, and extracted into`auth-error-codes.ts`/`auth-refresh-mutex.ts`/`auth-session-cookies.ts`/`auth-session-hydrator.ts`. |
| **Dead refresh token stranded users as BASIC (wallet signing broken in prod)**                     | After the strict-token deploy, browsers holding pre-hardening 30-day refresh cookies got `401` on `/api/user/verify-wallet` and `/profile` (settings silently reloaded showing BASIC), while the old `-1004` response gave clients no way to distinguish "transient" from "re-login required" — and the stale zustand `auth-storage` persisted the stale user across reloads.                                                                                                                                                                                                                                                                | ✅ Fixed: `respondToFailedRefresh()` now returns a definitive `401 { code: -1002 }` and clears all session cookies when the refresh token is definitively invalid/expired (`isDefinitiveRefreshFailure()`), leaving `-1004` for transient failures. Frontend `client.ts` gained `forceReauthentication()`: on `401+-1002` it clears the auth store **and** the persisted `auth-storage`, then redirects to `/login`; `useAuth.ts` listens for `auth:session-expired`/`auth:logout` events and resets state without relying on a page reload. (`auth.middleware.ts`, `auth-error-codes.ts`, `auth-session-cookies.ts`, `client.ts`, `useAuth.ts`) |
| **User level promotion invisible: profile cache served stale BASIC (no 200 after verify-wallet)**  | `user-profile.service.verifyWalletOwnership()` delegated the BASIC→REGISTERED promotion to the auth service (which invalidates only its own auth cache) but never invalidated the `user:profile:{userId}` Redis entry (TTL 300s). The unchanged profile body produced an identical ETag, so the follow-up `GET /profile` returned `304 Not Modified` and the UI kept showing BASIC with the sign option, even though the DB was already REGISTERED. `unlink-wallet` (which calls `authService.unlinkWallet` directly in the route) had the same hole on downgrade.                                                                           | ✅ Fixed: `verifyWalletOwnership()` invalidates the profile cache on success; `invalidateUserProfileCache()` made public and called from the `unlink-wallet` route after a successful downgrade. (`user-profile.service.ts`, `interfaces/http/users/profile.ts`)                                                                                                                                                                                                                                                                                                                                                                                 |
| **Kodiak connect: "connecting…" toast stuck, status showed connected despite failed verification** | Four stacked issues: (1) `generateKodiakSignature()` base58-decoded the raw secret including the `ed25519:` prefix and rejected hex (`0x…`) exports — signature always failed with `Non-base58 character`; (2) `connectKodiak()` stored credentials **before** verification and left them on failure, so `status` reported `connected: true, verified: false` — Settings showed "connected" while the user stayed REGISTERED; (3) failed connections were cached for 300s, blocking immediate retries with corrected keys; (4) `Settings.tsx` discarded the `SmartToast.loading` id (duration `Infinity`), so the toast was never dismissed. | ✅ Fixed: secret-key normalization (`ed25519:` prefix strip + hex/base58 detection) before decode; failed verification now rolls back stored credentials (all-or-nothing connect) and returns `verified: false` without level upgrade; only successful connections are cached; loading toast id captured and dismissed on settle. (`kodiak-integration.service.ts`, `kodiak-connection.service.ts`, `user-kodiak.service.ts`, `Settings.tsx`)                                                                                                                                                                                                    |
| **WebSocket auth retried a dead token forever**                                                    | On definitive auth failures (dead cookie, expired access token, deleted user) the WS client kept reconnecting on a ~10s loop (14+ identical failures observed in prod logs), hammering the server with handshakes that could never succeed.                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ Fixed: `setupAuthentication()` now classifies WS auth failures via `isDefinitiveWsAuthCode()` and passes `{ code, definitive: true }` through the Socket.IO handshake error `data`; the frontend `connect_error` handler stops the reconnect loop on `definitive`, dispatches a single `auth:session-expired` event (HTTP refresh / re-login flow takes over), and resets the flag on successful reconnect. Transient (internal) failures still retry normally. (`websocket/auth.ts`, `websocket.service.ts`, `frontend websocket/client.ts`)                                                                                                 |
| **Docs not version-controlled**                                                                    | `.gitignore` ignores all of `docs/`, so instructions and durable documentation are invisible to repo consumers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ⬜ Open (needs a decision on what to track)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Non-atomic Redis mutex release**                                                                 | Token-refresh mutex was released with plain `DEL` (no owner token), so an expired lock could be released by a non-owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ Fixed: Locks are acquired with a random owner token and released via a compare-and-delete Lua script (`eval(RELEASE_LOCK_SCRIPT, { keys, arguments })`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Hardcoded lightweight-endpoint paths**                                                           | The `/api/user/kodiak/*` path list was inlined 3× in `auth.middleware.ts`, breaking exchange-agnosticism.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ Fixed: Centralized in a `LIGHTWEIGHT_ENDPOINT_PREFIXES` constant with an `isLightweightEndpoint()` helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

</details>

### 5.2 Architecture ratings as recorded on 2026-09-14 (superseded by section 1)

| Area                      | Rating    |
| ------------------------- | --------- |
| Monorepo structure        | 8/10      |
| Backend architecture      | 7.5/10    |
| Frontend architecture     | 7.5/10    |
| Backend ↔ Engine protocol | 8/10      |
| Lifecycle model           | 8.5/10    |
| Engine reliability        | 7/10      |
| Trading execution         | 7/10      |
| Failure recovery          | 6.5/10    |
| Operational maturity      | 6/10      |
| Documentation             | 4/10      |
| **Overall**               | **~7/10** |

---

## 6. Still open

| Priority | Item                                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟠 P1    | **Shared Package Scope**                               | `@trade-bot/shared` is a god package (protocol types, domain models, API contracts, error classes, logging types). Split it by domain once the trading-path hardening above has landed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 🔴 P0    | **Phase 0–3 items**                                    | The engine trading-path work in §4 — verified against the exchange before anything else is built on top of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅ Done  | **2026-09-26 batch (L1–L4)**                           | Bot-route repoint, venue-agnostic portfolio selection, the Express boot-order race, and the unwired `ExchangeAccountService` logger — resolved; see §3 findings and the §4 backlog table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ✅ Done  | **2026-09-26/27 batch (L11–L13)**                      | Venue-dispatched portfolio reads + the Lighter reader, the `strategies.active` lifecycle sync + post-create start prompt, and the dev-stack signer sidecar — resolved; see §3 findings and §4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅ Done  | **2026-09-28 batch (L5–L7)**                           | Lighter/venue-aware connect+verify logging with step timings, registration-duplicate log hygiene (masked, `info`) + a distinct 409 code, and explicit `correlationId`/`requestId` on the HTTP response line — resolved; see §3 findings and §4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 🟡 P2    | **Remaining from the 2026-09-26 batch (L8–L10)**       | Ambient/background context leaks (`setRequestContext` at boot, eager pools) and shutdown observability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 🟡 P2    | **2026-09-27 batch (L14–L15)**                         | WS client reconnect loop after `WS_AUTH_FAILED`; and the balance widget's missing error channel (the 400/403→"not connected" mask now hides only genuine failures).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 🟠 P1    | **Bot account sessions (plan §D)**                     | The unit of execution becomes `(user, exchange_accounts)` with `strategy_runs` inside it: one credential fetch, one exchange connection and one reconciler per account, which is also the shape the L5–L10-adjacent reconciliation work (N3/N4) needs. Designed, not implemented — [DATA_MODEL.md](DATA_MODEL.md) §4.4, [plan §D](EXCHANGE_INTEGRATION_PLAN.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🟡 P2    | **Agent participation (plan §E)**                      | Advisor → coordinator → executor on delegated, expiring grants scoped to one account, with proposals inert until a user approves them and the engine as the only executor. Designed, not implemented — [plan §E](EXCHANGE_INTEGRATION_PLAN.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 🟠 P1    | **2026-09-27/28 test blockers (L19–L24)**              | L18 fixed 2026-09-28 (protocol dispatch guards + the credential fetcher's `?correlationId`; live re-test proves both commands dispatch), **L20 fixed 2026-09-28** (venue-aware start gate; non-venue symbol → **400** with no bot row) and **L23 fixed 2026-09-28** (the Lighter query derived the venue index; live: real orders placed + filled, zero freezes). Remaining: **L21 and L24 fixed 2026-09-28** — a type-strict epoch check (the `BIGINT` `engine_registry.epoch` came back from node-postgres as `"19"` while the engine sent the JSON number `19`) rejected every engine accept/failure, so every command was timed out as `ENGINE_NO_RESPONSE` and the engine was left trading a bot the backend had declared ERROR; the check is now normalised and fail-closed, the engine ACKs `BOT_STOP` as well, and a bot the authority has declared terminal is stopped on the engine side by a bounded, audited repair from the timeout sweep and the heartbeat-drift reconciler. What remains: **L19 stop 404** (the frontend cache keeps `strategy_id` as `id`), **L22 non-retryable failures loop / poison never ACKed** — see §3/§4. |
| 🟠 P1    | **Execution integrity (verified review of `f40f02a`)** | After L19/L22 (L21's command-row resolution landed 2026-09-28): retire or re-route the dead `engine.ts` lifecycle writers (✅ deleted 2026-09-30), credential idempotency (unique index + `ON CONFLICT`), trade idempotency + bot-scoped stats, account-scoped position/balance readers — verdicts in §2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### How to keep this document honest

1. Update §4 (ledger status) in the same commit as the code change it records —
   stale docs are treated as bugs (`CONTRIBUTING.md`).
2. Add the verification row to §2 when a review claim is re-checked, and record
   the result even when it contradicts the review.
3. Keep the README free of review history: it answers "what is the system today",
   this document answers "how did we get here / what remains".
