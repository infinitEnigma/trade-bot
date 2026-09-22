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

## 4. Remediation ledger

Sequencing rationale: Phase 1 must precede Phase 2 (building reconciliation on top
of a request that never carries `client_order_id` would be built on sand); Phase 3
protects the state Phase 2 depends on; Phases 4–5 make the outputs trustworthy;
Phases 6–7 lock it in.

| Phase | Priority | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                                                                                                                                                                                                                                                                              |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | –        | **Prove the P0s before changing code.** Verify N1/N2 against the Orderly testnet (place a LIMIT with a `client_order_id`, then resubmit the same key and record the rejection); add a zero-new-dependency wire test (local `node:http` server as the client's `baseUrl`) asserting the exact JSON body keys, the signed string, and the duplicate-key rejection; record the real order-status vocabulary                                                                                                                         | 🔶 code-side done (`client.wire.test.ts`: body keys, signature verified with an independent Ed25519 implementation, duplicate-key rejection; status vocabulary recorded in `payload.ts`); ⬜ live-testnet probe (place + duplicate-resubmit + rejection capture) still open                         |
| 1     | 🔴 P0    | **Exchange call contract.** Add a pure `toOrderlyOrderPayload()` mapper (snake_case) and sign the same serialized body; replace the `{botId}:{levelIndex}:{side}` key with a ≤36-char allowed-character deterministic key                                                                                                                                                                                                                                                                                                        | ✅ `exchanges/kodiak/payload.ts` (+ `isAcceptedOrderlyClientOrderId` guard) wired into `createOrder`; `utils/client-order-id.ts` generates `<botKey>-<level(base36)>-<B\|S>` ≤36 chars; wire + unit + grid tests updated; N1/N2 closed in code — final confirmation pending the row-0 testnet probe |
| 2     | 🔴 P0    | **`OrderManager` + `OrderReconciliationService`.** Explicit order state machine (`INTENDED → SUBMITTING → UNKNOWN → OPEN / FILLED / NOT_FOUND(SAFE_TO_RECREATE) / EXCHANGE_UNAVAILABLE`); startup reconciliation before the first tick; `NOT_FOUND` releases the slot; cancellation resolves only when confirmed; the strategy keeps "what should exist" while the manager owns failure semantics                                                                                                                                | ⬜                                                                                                                                                                                                                                                                                                  |
| 3     | 🔴 P0    | **Snapshot durability.** Temp file → `fsync` → atomic rename; keep the previous snapshot; checksum + schema validation of level entries; distinguish "no snapshot" from "corrupt snapshot" (never silently rebuild a fresh grid while exchange orders exist)                                                                                                                                                                                                                                                                     | ⬜                                                                                                                                                                                                                                                                                                  |
| 4     | 🟠 P1    | **Durable trading ledger.** Persist order/fill intent before create; wire the engine to report fills (event or idempotent endpoint); fix the `trades.status` vocabulary, the `strategy_id`-scoped `bot_instances` update, and add an idempotency key on `(bot_id, client_order_id, exchange_order_id, fill_id)`                                                                                                                                                                                                                  | ⬜                                                                                                                                                                                                                                                                                                  |
| 5     | 🟠 P1    | **Accounting correctness (N6).** Sell at the next level / take-profit, PnL from executed price with fees, `reduce_only` exits, position reconciliation from exchange positions, explicit `PARTIALLY_FILLED` handling                                                                                                                                                                                                                                                                                                             | ⬜                                                                                                                                                                                                                                                                                                  |
| 6     | 🟡 P2    | **Failure-injection harness.** Fake exchange with scripted failures (accept-then-drop, timeout, 500, `NOT_FOUND`, duplicate-key rejection, partial fill) and a test matrix: crash at each point around submission, Redis down/restart, restart with/without/corrupt snapshot, exchange-side orphans                                                                                                                                                                                                                              | ⬜                                                                                                                                                                                                                                                                                                  |
| 7     | 🟡 P2    | **Documentation split and drift removal.** `README` = what the system is today; `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, this tracker; track `docs/*.md` while keeping `docs/archived/` and `docs/instructions/` untracked; fix badges, dead paths, and the stale ratings table; document engine env vars in `.env.example`                                                                                                                                                                                                 | ✅ (this pass; N8/N9 closed)                                                                                                                                                                                                                                                                        |
| 8     | 🔴 P0    | **Identity & accounts data model** — many wallets and many exchange accounts per user, username (nick) login instead of email, exchange-agnostic credential envelopes, and a bot → exchange-account binding so the engine knows which account to trade. Blocks multi-account trading: `/credentials/:botId` can only return one account today. Design: [DATA_MODEL.md](DATA_MODEL.md); staged PRs **C1** identity, **C2** wallets + exchange accounts, **C3** bot→account + data tables: [plan §3](EXCHANGE_INTEGRATION_PLAN.md) | ⬜                                                                                                                                                                                                                                                                                                  |
| 9     | 🔴 P0    | **Credential-contract slice (workstream A)** — `EngineCredentials` discriminated union in `shared`, backend `/credentials/:botId` returns `{ exchange, environment, accountRef, credentials }`, engine client factory selects by exchange. Stops the Orderly-shaped contract being baked further before Lighter lands: [plan §1](EXCHANGE_INTEGRATION_PLAN.md)                                                                                                                                                                   | ✅                                                                                                                                                                                                                                                                                                  |
| 10    | 🔴 P0    | **Lighter engine adapter (workstream B)** — extend `ExchangeClient` (open-order listing, by-client-order-id lookup that separates NOT_FOUND from UNREACHABLE, confirming cancel, HTTP timeouts), `TransactionSigner` + sidecar client, `LighterClient` encoding the Phase-0-verified status/market/cancel semantics, strategy decoupled from `OrderlyClient`: [plan §2](EXCHANGE_INTEGRATION_PLAN.md)                                                                                                                            | ⬜                                                                                                                                                                                                                                                                                                  |
| –     | 🟢 P3    | **Do not** add further abstraction beyond `OrderManager` / `OrderReconciliationService`; **do not** split the `shared` package yet; **no** frontend work                                                                                                                                                                                                                                                                                                                                                                         | –                                                                                                                                                                                                                                                                                                   |

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

| Priority | Item                     | Detail                                                                                                                                                                                  |
| -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟠 P1    | **Shared Package Scope** | `@trade-bot/shared` is a god package (protocol types, domain models, API contracts, error classes, logging types). Split it by domain once the trading-path hardening above has landed. |
| 🔴 P0    | **Phase 0–3 items**      | The engine trading-path work in §4 — verified against the exchange before anything else is built on top of it.                                                                          |

### How to keep this document honest

1. Update §4 (ledger status) in the same commit as the code change it records —
   stale docs are treated as bugs (`CONTRIBUTING.md`).
2. Add the verification row to §2 when a review claim is re-checked, and record
   the result even when it contradicts the review.
3. Keep the README free of review history: it answers "what is the system today",
   this document answers "how did we get here / what remains".
