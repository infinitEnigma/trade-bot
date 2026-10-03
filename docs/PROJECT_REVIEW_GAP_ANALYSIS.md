# Project Review & Gap Analysis

**How did we get here, and what remains?**

| Question                            | Document                           |
| ----------------------------------- | ---------------------------------- |
| What is the system?                 | [README](../README.md)             |
| How does it work?                   | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How do we run and recover it?       | [OPERATIONS.md](OPERATIONS.md)     |
| How did we get here / what remains? | this document                      |

This document tracks external reviews of the repository, verifies each claim
against the code (not against the READMEs), and maintains the remediation
ledger for **what is still open**. Closed findings (the N-series, L1-L30, the
M1 emergency-stop row, and the full 2026-09-20 / 2026-09-27 review cycles) live
in the archived copy
[`docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md`](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md).
Historical review material stays untracked under `docs/archived/`.

**Current focus: engine trading-path hardening** (Phases 0/2/3 in section 4) —
the control plane is strong; exchange↔local reconciliation and durable
financial state are the remaining gaps.

---

## 1. Latest review — 2026-10-01 (independent reviewer)

**Repository state reviewed:** the `main` revision of this document at
`624e599` (2026-09-30); verified below against `cc8da7c` (2026-10-01).

**Reviewer's summary:** the project is now *"a fairly mature distributed
trading control plane with increasingly credible live execution, but still
missing the durable exchange/local reconciliation and financial-ledger layer
required for a robust trading system."* Architecture is no longer the main
concern; remaining risk concentrates in **trading-state authority,
reconciliation, accounting, and a few legacy HTTP paths** (the latter have
since been removed — see section 2).

The reviewer explicitly recommends **stopping architectural expansion** and
making the next milestone:

```text
Strategy intent → OrderManager → Order Reconciliation → Exchange
                        ↓
              orders + fills → PostgreSQL ledger → positions / PnL
```

### Maturity by layer (as reviewed)

| Layer              | Assessment                                                                              |
| ------------------ | --------------------------------------------------------------------------------------- |
| 🟢 Control plane   | Strong — Redis Streams, ACK, epochs, CAS lifecycle, emergency stop, timeout supervision  |
| 🟡 Execution plane | Functional but incomplete — real Lighter testnet fills, no formal reconciliation state machine |
| 🔴 Financial state | Immature — fills, PnL, fees, positions, restart recovery                                 |

### Reviewer's priority list (reconciled with the code in section 2)

| Priority | Work                                          | Status @ `cc8da7c`                            |
| -------- | --------------------------------------------- | --------------------------------------------- |
| 🔴 P0    | `OrderManager` + `OrderReconciliationService` | **Open** (section 4, Phase 2)                 |
| 🔴 P0    | Snapshot atomicity/corruption handling        | **Open** (section 4, Phase 3)                 |
| 🔴 P0    | Live testnet duplicate-order proof            | **Open** (section 4, Phase 0, code-side done) |
| 🟠 P1    | Durable order/fill ledger                     | ✅ **Done** `5d1cef9` (section 4, Phase 4)     |
| 🟠 P1    | Credential issuance DB idempotency            | ✅ **Done post-review** (`77506bf`) — see section 2 |
| 🟠 P1    | Correct trade reporting / bot-scoped stats    | ✅ **Done** `5d1cef9` (section 4, Phase 4, N7)  |
| 🟠 P1    | Account-scoped position/balance domain APIs   | **Partially done** (section 4)                |
| 🟠 P1    | Accounting/PnL correctness                    | **Core done + `reduce_only` + position reconciliation** (section 4, Phase 5, N6) — partial fills **in progress**: Phase 4 parts 1–2 landed 2026-10-03 (`6381110`, `efa6c5c`) |
| 🟡 P2    | Failure-injection harness                     | **Open** (section 4, Phase 6)                 |
| 🟡 P2    | Remove legacy engine HTTP writers             | ✅ **Done post-review** (`132fbd1`, `cc8da7c`) — see section 2 |
| 🟡 P2    | Split `shared` package                        | **Defer** (section 4)                         |

### Reviewer's recommended PR sequencing

1. **PR 1 — Exchange reconciliation:** `OrderManager` +
   `OrderReconciliationService` + grid integration + startup reconciliation +
   `NOT_FOUND` vs `UNREACHABLE` + confirmed cancellation.
2. **PR 2 — Durable order/fill state:** orders, fills, execution identity,
   idempotent persistence, trade projections.
3. **PR 3 — Accounting:** partial fills, fees, realized PnL, `reduce_only`,
   position reconciliation.
4. **PR 4 — Failure injection:** only after the above abstractions exist
   (accept→network loss, timeout, 500/404, duplicate, partial fill, cancel
   ambiguity, engine crash, Redis restart, snapshot corruption).

The full review text as received is archived at
[`docs/archived/reviews/2026-10-01_external_review_raw.md`](archived/reviews/2026-10-01_external_review_raw.md).

---

## 2. Verification of the 2026-10-01 review against the code

Every claim re-checked at `cc8da7c`. Rows 9-11 are claims the review itself
flagged as possibly stale ("last ~24h not included") — they were fixed between
the review and this incorporation.

| # | Review claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Engine could not boot under documented Node config; fixed to CommonJS/node resolution, `prod:engine` verified live | ✅ Confirmed | L17 — ledger ✅ Done; Redis consumption + heartbeats observed live |
| 2 | Redis command protocol substantially healthier (`BOT_START`/`BOT_STOP`/`BOT_EMERGENCY_STOP` guards, dedicated consumer tests, `BOT_STOP` emits `COMMAND_ACCEPTED`), live-verified | ✅ Confirmed | L18 ✅ Done 2026-09-28; `command-consumer.test.ts`; epoch fix below |
| 3 | Epoch mismatch (`“19” !== 19`) rejected every runtime event; now `normalizeEpoch()`/`epochsMatch()`, fail-closed | ✅ Confirmed | `engine-registry.service.ts`; live run showed 0 `ENGINE_NO_RESPONSE`, 0 epoch errors |
| 4 | Lighter adapter progressed (market resolution, placement, client-index, retrieval, cancel confirm, testnet fills, real fill round-trip) | ✅ Confirmed | L20/L23 ✅ Done; live 4 orders placed + filled, 0 frozen slots, `0.004 BTC` in portfolio |
| 5 | Frontend bot-ID bug fixed (`id: bot.id`, `strategy_id` kept separately); compat fallback remains | ✅ Confirmed | L19 ✅ Done 2026-09-29; fallback still at `useBotLifecycle.ts:187,253` (section 3 residue) |
| 6 | Emergency stop is a real control-plane operation (CAS → command → strategy stop → cancel → flatten → STOPPED), live 20/20 with venue-verified flat | ✅ Confirmed | M1 ✅ Done (archived cycle doc); venue rules `client_order_index ≤ 2^48−1` and IOC `order_expiry: 0` pinned live |
| 7 | Poison/retry handling better: retryable `CommandError`s, capped deliveries, ACK-and-drop, PEL cleared live | ✅ Confirmed | L22 ✅ Done; L28 durable Redis dedup ✅ Done (`53105ef`) |
| 8 | Logging/context work improved (HTTP response ids in closure, background `ALS.run()` scopes, account-verification logs without secrets) | ✅ Confirmed | L7/L8/L5 ✅ Done |
| 9 | `report-trade` endpoint still accepts `userId`/`strategyId` and updates all bots sharing the strategy | ❌ **Stale — fixed post-review** | Route deleted in `132fbd1` (zero engine callers; durable path = Phase 4 `TRADE_EXECUTED` event ingest) |
| 10 | Credential issuance not DB-safe (check-then-insert race) | ❌ **Stale — fixed post-review** | `77506bf`: partial unique index `015_credentials_issued_unique.sql` + `ON CONFLICT DO NOTHING` → 409 |
| 11 | Legacy HTTP writers (`/heartbeat`, `/report-trade`, `/bot-error`, `/bot-recovery`, `/engine-status`) still present | ❌ **Stale — fixed post-review** | Deleted in `132fbd1` + `cc8da7c`; liveness now comes from `EngineRegistryService.getEngineLiveness()` |
| 12 | `OrderReconciliationService` still the most important missing abstraction (state machine `INTENDED → … → SAFE_TO_RECREATE`) | ✅ **Resolved post-review** | Implemented 2026-10-01 (`d746c4c`): `OrderManager` + `OrderReconciliationService` + `domain/order-state.ts` — section 4, Phase 2 |
| 13 | Snapshot durability insufficient (no tmp+fsync+rename, no checksum; snapshot ≠ exchange truth) | ✅ **Resolved post-review** | Implemented 2026-10-01 (`d5aa842`): `durable-write.ts` + checksum + level validation; missing vs corrupt distinguished — section 4, Phase 3 |
| 14 | Trade idempotency + bot-scoped statistics still missing | ✅ **Resolved 2026-10-02** | Phase 4: idempotent `bot_trade_fills(…)` unique key + `bot_instances` totals keyed by `bot_id` — N7 record below |
| 15 | `position-repository` userId-only interface answers with the most recently updated row | ✅ Confirmed open | `position-repository.adapter.ts:60` documents the heuristic — section 4 (account-scoped domain APIs) |
| 16 | Frontend still carries `bot.id === botId` \|\| `bot.strategy_id === botId` compatibility logic (residue: `strategy ≈ bot`) | ✅ Confirmed | `useBotLifecycle.ts:187,253` — section 3 residue |

---
## 3. Findings (open only)

Closed findings — the N-series resolution notes and every `#### L…` narrative
(L1–L30), plus the M1 emergency-stop record and the 2026-09-26/27 flow-audit
evidence — are preserved verbatim in
[`docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md`](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md).
Only findings that applied to the code at `cc8da7c` are listed here. N3/N4/N5
were resolved 2026-10-01 (Phase 2, `d746c4c`) and are kept as short records;
N7 resolved 2026-10-02 (Phase 4); G1 (Gate 1) resolved 2026-10-02 (§4 row
2b); **N6's core settled 2026-10-02** (executed-price PnL, fee booking, exit
pricing) and **`reduce_only` exits landed 2026-10-02** (§4 row 5), leaving
per-fill `PARTIALLY_FILLED` and venue position reconciliation open — the
reconciliation landed 2026-10-02 (`938e230`), and the partial-fill deferral
**ended 2026-10-03 with Gate 4** (`.git/gatelogs/live/gate4-report.md`): a
genuine partial was observed — partially-filled resting orders report status
`open` with `filled_base_amount > 0`, the cumulative quantity is monotonic,
and the order rows carry **no per-trade id**, so the Phase-4 fill identity is
a cumulative-qty segment keyed on `client_order_index`. R1/R2 remain open.

### G1 — ✅ Resolved (2026-10-02): stale deterministic-id history books phantom fills

Gate 1 report §3.1: cycle N+1's `ensureSlotOrder` pre-submit lookup
(`queryOrderByClientOrderId`) found the **terminal history row of cycle N's**
spent `(bot, level, side)` id — `active: NOT_FOUND → history: FOUND_FILLED` —
and booked a fill without any submission: bogus mark-to-market PnL, flipped
`filled` flags, and no way to place a real order for that slot while the
history row persisted (all five clean sells that window were first-time ids;
level 5, whose id had history, never submitted).

**Fix (§4 row 2b):** slot id generations. `OrderManager.markFilled` spends
the slot's id (side generation bump), the next cycle derives a fresh id whose
venue history cannot contain the spent row; generation 0 renders byte-identical
to the legacy format so live handles keep resolving, and legacy (pre-generation)
snapshots seed handle-less sides at generation 1 on restore.

### N3 — ✅ Resolved (`d746c4c`): a missing exchange order permanently blocks a grid slot

`grid.ts` polls each live order and swallows every failure:

```ts
} catch {
  // Order may not exist anymore
}
```

The slot's `buyOrderId` / `sellOrderId` is **never cleared**, so the level can
never be re-armed. A 404 (order gone/cancelled externally) is indistinguishable
from a transient network error — exactly the reviewer's "local order exists but
exchange order doesn't" case. **Owned by Phase 2** (`OrderManager` state machine
with `NOT_FOUND → SAFE_TO_RECREATE`).

### N4 — ✅ Resolved (`d746c4c`): restart has no exchange cross-check (orphan/duplicate blind spot)

`initialize()` trusts the snapshot, and otherwise silently rebuilds the grid
from the current price. Nothing lists the symbol's open orders and compares
them with the restored levels. After a missing/corrupt snapshot, a config
change, or fills that happened while the engine was down, previously live
orders become **orphans** that nothing adopts, cancels, or reports.

Compounding detail: slot identity is **index-keyed** while prices are
**baseline-derived**. After a restart with a new baseline, `bot-1:0:BUY` — an
order live at the _old_ index-0 price — is adopted into the _new_ level 0 at a
_different_ price, so local state attributes an order to the wrong price level.
**Owned by Phase 2 (startup reconciliation) + Phase 3 (snapshot durability).**

### N5 — ✅ Resolved (`d746c4c`): cancellation ambiguity was reported as `STOPPED`

`GridTradingStrategy.stop()` swallows every `cancelOrder` failure, and the
lifecycle coordinator then publishes `STATE_CHANGED → STOPPED`. The backend
shows `actual_state = STOPPED` while live orders may still rest on the
exchange. **Owned by Phase 2** (confirmed cancellation).

### N6 — 🟠 P1: the grid's profit logic is not meaningful

Original findings (repository state `cc8da7c`, 2026-10-01):

- Sell legs were placed at **`level.price`** — the same price as the buy that
  filled — so there was zero spread before fees and rebates.
- PnL was derived from the **mark price at check time**, not the executed price,
  and ignored fees: `(this.currentPrice - level.price) * orderQuantity`.
- Sell legs are never marked `reduce_only` (the domain model has the field and
  the exchange supports it), so a stale sell can open a short instead of
  closing the grid leg.
- Fill handling is the boolean `filled` flag on a level: no position/quantity
  accounting and no `PARTIALLY_FILLED` branch.

**Owned by Phase 5 (accounting correctness).**

**N6 core settled 2026-10-02** (`8495254`; executed-price accounting, fees,
exit pricing):

- **Exit pricing.** A filled level's sell is priced one grid step above its
  line (`levels[i+1].price`, or one spacing above the top line at the top
  level), or `takeProfitPercent` above the **executed** entry when the bot
  configures a take profit (`config.takeProfit` → `takeProfitPercent`) — never
  at `level.price`. If neither geometry can price strictly above the entry (a
  degenerate grid whose spacing rounds to zero at the symbol's price scale) the
  level is left **unarmed** with a logged reason, rather than placing a
  guaranteed-loss exit.
- **Executed prices.** `SlotOutcome.FILLED` carries `executedPrice`
  (`getOrder` → Orderly's `average_executed_price`, Lighter's order price;
  `queryOrderByClientOrderId` → the listed row's price), and the grid persists
  the executed entry per level (`GridLevel.entryPrice` /
  `GridSnapshotLevel.entryPrice`, so a restart re-derives the exit from the
  real entry).
- **Realised PnL + fees.** A BUY books `0 - fee` (its spread stays unrealised
  until the paired exit); the closing SELL books
  `(sellExec − entryExec) × quantity − fee`. That keeps the Phase-4 invariant
  `SUM(bot_trade_fills.pnl) == bot_instances.total_pnl` exact while counting
  each leg's fee exactly once. The venue never says whether a fill was maker or
  taker, so the **taker** rate (the upper bound) prices the fee; an
  unsourceable rate omits `fee` *and* `pnl` — never a made-up `0`.
- **Position split.** `PositionReport.pnl` is realised PnL net of fees and
  `unrealizedPnl` marks the open inventory at the ticker price; the backend
  stores both (`bot_positions.unrealized_pnl`, migration
  `017_accounting_pnl_split.sql`).

**`reduce_only` exits landed 2026-10-02.** `ExchangeOrderRequest.reduceOnly`
(and the adapter-side `OrderRequest.reduceOnly`) is forwarded by both adapters —
Orderly emits the documented `reduce_only` key (`POST /v1/order`, default false;
nothing is added for ordinary orders) and Lighter passes it through the signing
sidecar, which already accepted it — and the grid sets it `true` on every exit
leg (`OrderReconciliationService.ensureSlotOrder(..., reduceOnly)`), so a stale
sell can no longer open a short.

**Position reconciliation landed 2026-10-02.** The grid periodically
cross-checks its own position (`buildPositionReport`) against the venue's
`exchange.getPositions()` — throttled, and seeded at `start()` so the first read
is one interval after start, never on the first tick. Drift beyond half an order
is logged and the `POSITION_UPDATED` then reports the **venue** quantity/entry
(realised `pnl` stays the ledger-derived local number); the local levels are
deliberately not rewritten by a single read. A failed read is logged and
skipped, never failing a tick.

**Still open under Phase 5:** per-fill `PARTIALLY_FILLED` accounting —
**unblocked by Gate 4 (2026-10-03, `.git/gatelogs/live/gate4-report.md`)**:
the venue observation landed (partial resting orders report status `open` with
`filled_base_amount` cumulative and monotonic `[0.0074, 0.0074, 0.0374]`; no
per-trade id field exists; `order_id` mutates across fills), fixing the fill
identity to a **cumulative-qty segment keyed on `client_order_index`**.
Implementation (Phase 4) is **in progress** — the identity/domain layer
(`6381110`) and the `OrderManager` delta/generation accounting (`efa6c5c`)
landed 2026-10-03; the observation paths, grid wiring and tests/docs remain
(`docs/instructions/phase4-partial-fills-plan.md`).

**Phase-5 prerequisite — fee sourcing (N6a, settled 2026-10-02).** PnL "from
executed price with fees" needs a fee number, and the venue exposes no per-fill
fee: `/api/v1/trades` returns the same key set publicly and authenticated
(`account_index`, `order_index`, `client_id` filters all 200) with **no**
`maker_fee`/`taker_fee`, even though the L1 `Trade` event carries `tf`/`mf`;
`orderBookDetails.maker_fee`/`taker_fee` read `0.0000` for all 237 mainnet
markets (a placeholder). The only account-scoped fee signal is the
authenticated `GET /api/v1/accountLimits`: `user_tier`/`user_tier_name`
(`"standard"` for the testnet account), `current_{maker,taker}_fee_tick`
(`0` there — the tick→rate scale is undocumented and uncalibratable while no
fee is charged) and `effective_lit_stakes`. **Decision:** source the *rate*
from the venue-reported tier through the published schedule (Standard 0/0,
Plus 0.005% both sides, Premium 0.0040%/0.0280% undiscounted) and let the
engine book `notional × rate` per fill — even though the venue is zero-fee
today, so a tier change (or a non-zero-fee venue) books correctly without new
plumbing. Landed as Phase-1 code: `ExchangeFeeRates` +
`ExchangeClient.getFeeRates?()` in `engine/src/domain/exchange.ts` and
`LighterClient.getFeeRates()` (TTL-cached, fails loudly, never defaults a
rate) over the pure mapper `engine/src/exchanges/lighter/fees.ts`. Provenance
(`tier`, `venueReported`, `exact`, `basis`) rides on the returned rates so the
ledger can record where a number came from; an unmapped tier falls back to the
**worst** published rate with `venueReported: false` rather than inventing a
zero. The grid consumes it as `notional × takerRate` per fill (N6 core above):
the taker rate is the upper bound because the venue never reports the fill's
role, and a rate that cannot be sourced leaves the row's `fee`/`pnl` absent
instead of asserting a zero.

### N7 — ✅ Resolved (`5d1cef9`, 2026-10-02): the durable trade ledger is now reachable

Phase 4 landed: the engine publishes the ledger event family
(`ORDER_INTENT` / `TRADE_EXECUTED` / `POSITION_UPDATED` /
`PERFORMANCE_SNAPSHOT`, `shared/src/protocol/engine-ledger.ts`), the backend
ingests it fail-closed through `TradeLedgerService` into an idempotent
`bot_trade_fills` ledger (unique `(bot_id, client_order_id,
exchange_order_id, fill_id)`, migration `016_durable_trading_ledger.sql`),
`trades.status` is narrowed on ingest (`FULLY_FILLED → FILLED`,
`PARTIALLY_FILLED → PARTIAL`), and `bot_instances` totals increment by
`bot_id` only when a ledger row was actually inserted — so `total_pnl`
reconciles with `SUM(bot_trade_fills.pnl)`. Intent-before-create is enforced
(a slot whose intent cannot be persisted does not place). Original narrative
preserved in the
[archived cycle document](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md).

### R1 — 🟡 P2: frontend bot/strategy identity residue

The bot-ID mapping is fixed (`id: bot.id`), but the compatibility fallback
`bot.id === botId || bot.strategy_id === botId` is still live at
`useBotLifecycle.ts:187,253`. It preserves the old `strategy ≈ bot` mental
model (new architecture: one strategy → N bot instances). Not a bug today;
remove once no caller passes a strategy id.

### R2 — 🟡 P2: userId-only position lookup heuristic

`position-repository.adapter.ts:60` documents that `getPosition(userId, symbol)`
answers with **the most recently updated row** when multiple accounts hold the
same symbol. Account-scoped portfolio reads (`?exchangeAccountId=`) bypass this,
but the interface must not be used for trading/risk decisions until it becomes
`getPosition(accountId, symbol)` with user-level aggregation separate.

---

## 4. Remediation ledger (open items only)

Sequencing rationale: Phase 1 must precede Phase 2 (building reconciliation on
top of a request that never carries `client_order_id` would be built on sand);
Phase 3 protects the state Phase 2 depends on; Phases 4–5 make the outputs
trustworthy; Phase 6 locks it in. Closed rows (phases 1, 8, 9; ledger L1–L30;
M1) are in the archived cycle document. **Phase 2 (`d746c4c`) and Phase 3
(`d5aa842`) closed 2026-10-01; Phase 4 closed 2026-10-02** — see the rows
below.

| Phase | Priority | Item | Status |
| ----- | -------- | ---- | ------ |
| 0 | 🔴 P0 | **Prove the P0s before changing code.** Verify N1/N2 against the Orderly testnet (place a LIMIT with a `client_order_id`, then resubmit the same key and record the rejection); add a zero-client-id Orderly smoke test to the suite that runs on every PR. | 🔶 code-side done (`client.wire.test.ts`); **live proof done 2026-10-01 on Lighter testnet** (`.git/gatelogs/live/gate0.log`): probe 12/12 (1 note), engine smoke pass, venue left clean. Live finding: Lighter **accepts** a reused `client_order_index` silently (`ACCEPTED_NO_VISIBLE_CHANGE` — no second order), so idempotency there is venue **dedup**, not a rejection; Orderly's rejection stays wire-test only (mainnet connectivity-only). |
| 2 | 🔴 P0 | **`OrderManager` + `OrderReconciliationService`** (reviewer's PR 1 — next milestone). Explicit order state machine (`INTENDED → SUBMITTING → UNKNOWN → OPEN / FILLED / NOT_FOUND(SAFE_TO_RECREATE) / EXCHANGE_UNAVAILABLE`); startup reconciliation (list venue orders, adopt/cancel/report orphans — N4); `NOT_FOUND` vs `UNREACHABLE` distinguished (N3); confirmed cancellation instead of swallowed errors (N5). | ✅ Done `d746c4c` — `order-manager.ts` + `order-reconciliation.service.ts` + `domain/order-state.ts`; the grid routes every slot write through the manager |
| 2b | 🟠 P1 | **G1 — stale deterministic-id history books phantom fills** (Gate 1 report §3.1, Phase 2 residual). The pre-submit lookup for a spent slot id found the venue's terminal history row → `FOUND_FILLED` → phantom `markFilled` + `recordTrade` (bogus PnL, flipped `filled` flags) and blocked re-placement while history persisted. Fix: slot id **generations** — `markFilled` spends the slot's id (gen bump), legacy snapshots seed handle-less sides at generation 1, generation-0 ids stay byte-identical so live handles keep resolving. | ✅ Done 2026-10-02 — `client-order-id.ts` (`generation` suffix, legacy-exact gen 0) + `OrderManager.idFor`/`markFilled` bump + `GridLevel`/`GridSnapshotLevel` `buyGen`/`sellGen` + `SlotOutcome.FILLED.clientOrderId`; regression suite `grid-g1.test.ts` |
| 3 | 🔴 P0 | **Snapshot durability** (reviewer's PR 1/2). Temp file → `fsync` → atomic rename; keep the previous snapshot; checksum + schema validation of level entries; distinguish "no snapshot" from "corrupt snapshot"; `snapshot ≠ exchange truth` stays explicit — reconciliation (Phase 2) is what makes the snapshot safe. | ✅ Done `d5aa842` — `durable-write.ts` (tmp → fsync → rename, keep `.prev`) + checksum + level-entry validation |
| 4 | 🟠 P1 | **Durable trading ledger** (reviewer's PR 2). Persist order/fill intent before create; wire `TRADE_EXECUTED` events to an idempotent DB write (unique `(bot_id, client_order_id, exchange_order_id, fill_id)`); fix the `trades.status` vocabulary; filter `bot_instances` updates by `bot_id`, not `strategy_id` (N7). | ✅ Done `5d1cef9` (2026-10-02) — migration `016_durable_trading_ledger.sql` (`bot_trade_fills` + `bot_order_intents` + `bot_positions` + `bot_performance_snapshots`); `shared/src/protocol/engine-ledger.ts` event family; engine `LedgerTradeReporter` (intent-before-create, fail-closed); backend `TradeLedgerService`/`TradeLedgerRepository` ingested via `BotEventProcessor` behind the authority check; legacy `engine:events` listener removed |
| 5 | 🟠 P1 | **Accounting correctness** (reviewer's PR 3; N6). Sell at the next level / take-profit, PnL from executed price with fees, `reduce_only` exits, position reconciliation from exchange positions, explicit `PARTIALLY_FILLED`. | 🔶 **N6 core done 2026-10-02** (`8495254`). Fee sourcing (N6a): rate from the venue-reported account tier, `notional × rate` per fill (`ExchangeClient.getFeeRates?()` + `LighterClient.getFeeRates()` + `fees.ts`). Executed-price accounting: exits price one grid step above the level (or `takeProfitPercent` above the **executed** entry) and are never armed at/below it; a BUY books `0 - fee` while the closing SELL books `(sellExec − entryExec) × qty − fee`, so `SUM(bot_trade_fills.pnl)` stays exact; `PositionReport.pnl` is realised and `unrealizedPnl` marks the open inventory (`bot_positions.unrealized_pnl`, migration `017`). `reduce_only` exits landed 2026-10-02 (`b303fe6`: `ExchangeOrderRequest.reduceOnly` + `OrderRequest.reduceOnly`; Orderly `reduce_only` mapped in `payload.ts`, Lighter forwarded through the sidecar; grid sets it on SELL); position reconciliation landed 2026-10-02 (`938e230`: throttled `exchange.getPositions()` cross-check, venue truth reported on drift). **Live Gate 3 PASS 2026-10-03** (Lighter testnet, `.git/gatelogs/live/gate3-report.md`): BUY 2670.82 → SELL 2673.49 round trip with `realizedPnl 0.0267` exact, sourced-zero fee, `SUM(bot_trade_fills.pnl) == bot_instances.total_pnl`, `reduce_only` visible on the venue order, Phase-5 drift check fired. **Gate 4 PASS 2026-10-03** (`.git/gatelogs/live/gate4-report.md`): genuine partial observed — status `open` + cumulative monotonic `filled_base_amount`, no trade id → identity = cumulative-qty segment. **In progress:** per-fill `PARTIALLY_FILLED` implementation (Phase 4) — parts 1–2 landed 2026-10-03 (`6381110` segment-aware fill ids + domain types, `efa6c5c` OrderManager delta accounting + manager suite); observation paths, grid and tests/docs pending |
| 6 | 🟡 P2 | **Failure-injection harness** (reviewer's PR 4). Fake exchange with scripted failures (accept-then-drop, timeout, 500, `NOT_FOUND`, duplicate-key rejection, partial fill) and a test matrix: crash at each step of create, Redis down/restart, restart with/without/corrupt snapshot, exchange-side orphans. | ⬜ open — only after Phases 2–4 exist |
| – | 🟠 P1 | **Account-scoped position/balance domain APIs.** Retire the userId-only most-recent-row heuristic (R2); `getPosition(accountId, symbol)` with user-level aggregation separate. (P2: drop the unconsumed `kodiak_status` column from `user_trading_summary`.) | ⬜ partially done — portfolio reads are account-scoped; the domain interface is not |
| – | 🟡 P2 | **Frontend identity residue.** Remove the `bot.strategy_id === botId` compatibility fallback once no caller passes a strategy id (R1). | ⬜ open |
| D | 🟠 P1 | **Bot account sessions.** The unit of execution becomes `(user, exchange_accounts)` with `strategy_runs` inside it: one credential fetch, one exchange connection and one reconciler per account — also the shape N3/N4 reconciliation needs. Designed, not implemented — [DATA_MODEL.md](DATA_MODEL.md) §4.4, [plan §D](EXCHANGE_INTEGRATION_PLAN.md). | ⬜ open |
| E | 🟡 P2 | **Agent participation.** Read-only API keys per exchange account, grants scoped to one account, proposals inert until approved, engine as the only executor. Designed, not implemented — [plan §E](EXCHANGE_INTEGRATION_PLAN.md). | ⬜ open |
| – | 🟡 P2 | **Split `shared` package.** `@trade-bot/shared` is a god package (protocol types, domain models, API contracts, error classes, logging types). Split by domain once the trading-path hardening above has landed. | ⬜ deliberately deferred |

---

## 5. History — previous review passes

| Pass | Repository state | Outcome |
| ---- | ---------------- | ------- |
| 2026-09-20 (independent reviewer) | `main` @ `c149711` | Ratings ~8/10; P0 = exchange↔local reconciliation; produced N1–N9 and Phases 0–7. **Full text + verification + all L/M findings:** [archived cycle document](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md). |
| 2026-09-27 (independent reviewer) | `f40f02a` | "Execution-integrity hardening" batch (dead `engine.ts` writers, credential idempotency, trade path) — all items ✅ Done 2026-09-30/10-01, see §2 rows 9–11. |
| 2026-09-26/27 flow audits | live runs | L1–L24 narratives — all ✅ Done; archived with the cycle document. |
| 2026-09-30 (M1 live gate) | `.git/gatelogs/prod/` | Emergency stop end-to-end, 20/20 live; two venue rules pinned. Ledger row M1 ✅ — archived. |
| 2026-10-01 (engine hardening) | `main` @ `d746c4c` | Reviewer's PR 1 landed: Phase 3 durable snapshots (`d5aa842`) + Phase 2 `OrderManager`/`OrderReconciliationService` (N3/N4/N5 closed). Live Lighter duplicate-order proof still deferred. |
| 2026-10-01 (live Gate 0) | `.git/gatelogs/live/` | Lighter testnet Phase-0 proof **green**: duplicate `client_order_index` accepted-silently (no second order), lost-response recovery PASS, engine smoke PASS, venue clean. Probe `cancel-order` step fixed — it had leaked the lost-response order (left the venue dirty). |
| 2026-10-01 (independent reviewer) | `624e599` → verified @ `cc8da7c` | **This document.** Architecture no longer the concern; focus = reconciliation + durable financial state. |
| 2026-10-02 (accounting core) | `main` @ `8495254` | N6 core landed: fee sourcing from the venue-reported tier (`af3da2c`), then executed-price exit pricing, fee-inclusive realised PnL with an unrealised split, and a persisted executed entry. `reduce_only` / per-fill `PARTIALLY_FILLED` / `getPositions()` reconciliation remain. |
| 2026-10-02 (accounting remainder) | `main` @ `938e230` | N6 remainder part 1: grid exits are `reduce_only` (`b303fe6`) and the grid cross-checks its position against `exchange.getPositions()` (`938e230`). Per-fill `PARTIALLY_FILLED` deferred pending a Lighter testnet observation. |
| 2026-10-03 (live Gate 3 accounting) | Lighter testnet @ `a843c95` — evidence `.git/gatelogs/live/gate3-report.md` | **Round trip PASS**: BUY 2670.82 → SELL 2673.49 (exit strictly above the executed entry), `realizedPnl 0.0267` exact, sourced-zero fee, `SUM(bot_trade_fills.pnl) == bot_instances.total_pnl` exact (7 rows / 7 fills), `reduce_only: true` seen on the resting SELL at the venue, Phase-5 drift check fired live, G1 recovery held (no phantom fills). §4 row 5 keeps only per-fill `PARTIALLY_FILLED` open. |
| 2026-10-03 (live Gate 4 partial-fill probe) | Lighter testnet @ `a843c95` — evidence `.git/gatelogs/live/gate4-report.md` + `gate4-partial.json` | **PASS — Phase 4 unblocked**: genuine partial observed (`filled 0.0074 / remaining 0.0300` resting ≥2.3 s, then `0.0374` filled); `filled_base_amount` cumulative and monotonic; raw status of a partial is **`open`** (not `partially_filled`); no per-trade id on order rows (`order_id` even mutates) → fill identity = **cumulative-qty segment keyed on `client_order_index`**. Venue rules pinned along the way (min size 0.01, `21733` accidental-price guard, STP-only self-trade, MM ladder re-quotes, `21104` nonce drift). Probe residue flattened with a `reduce_only` buy — venue ends flat, 0 orders. |
| 2026-10-03 (live Gate 2 snapshot durability) | Lighter testnet @ `a843c95` — evidence `.git/gatelogs/live/gate2-report.md` | **PASS (§7)**: SIGKILL → main snapshot corrupted → restart recovered via `.prev` (`Recovered grid snapshot from the previous version` + `initialized (restored from snapshot) restoredCount=6`), restored levels byte-equal the pre-kill `.prev`, venue `activeOrders` 1 → 1 with the same `client_order_id` (no duplicate placement). Ops findings: engine stream lives in **Redis DB 1**; manual `STARTING` is re-marked `UNKNOWN` by the reconcile in ~2.5 min, so the §3.5 CAS + XADD must be atomic; no boot-time bot adoption. |
| 2026-10-03 (live Gate 1-B order adoption) | Lighter testnet @ `a843c95` — evidence `.git/gatelogs/live/gate1b-report.md` | **PASS (§4)**: SIGKILL with a resting BUY (`client 4254758849`) → restart (epoch 44) → atomic §3.5 resume → `initialized (restored from snapshot) restoredCount=6`, **zero** submissions after restart, venue `activeOrders` 1 → 1 same `client_order_id` — clean adoption (silent by design; count equality is the evidence). Stale bot `4ba68e7b` stopped → `STOPPED/STOPPED`. |
| 2026-10-03 (live Gate 1-C vanish → re-place) | Lighter testnet @ `a843c95` — evidence `.git/gatelogs/live/gate1c-report.md` | **PASS (§5 / N3)**: venue cancel of `client 4254758849` → slot cleared (lookup `FOUND_CANCELED` → `SAFE_TO_RECREATE`) → re-placed at the first armed tick (`13:23:57`, same gen-0 id; §5.3's "next generation" expectation corrected — only `markFilled` bumps generations), venue count `1 → 0 → 1`. Transient `21104` did not freeze the slot (8 s retry). Bonuses: G1 live proof on a CANCELED history row (no phantom fill), and a ~3 h `ENETUNREACH` outage logged as a tick error without stopping the loop. |
| 2026-10-03 (live Gate 1-D clean stop) | Lighter testnet @ `a843c95` — evidence `.git/gatelogs/live/gate1d-report.md` | **PASS (§6 / N5)**: `POST /stop` with 1 resting order + `+0.05` long → `Grid strategy bot stopped {unresolved: 0}`, venue `activeOrders 1 → 0`, `force_stop_reason: null`, bot `STOPPED/STOPPED` in ~3 s, ledger ↔ venue agree (`bot_positions 0.05 == venue +0.05`; 5 fills / `sum(pnl) 0 == total_pnl`). With this the planned live gates are complete: **Gate 0 ✅ (2026-10-01), 1-B ✅, 1-C ✅, 1-D ✅, 2 ✅, 3 ✅, 4 ✅ (all 2026-10-03)**. |
| 2026-10-03 (Phase 4 parts 1–2) | `main` @ `efa6c5c` | Phase 4 implementation started: segment-aware fill ids + partial-fill domain types (`6381110`), then `OrderManager` delta/generation accounting with its own suite (`efa6c5c`). Whole-order fills keep the byte-identical legacy fill hash (A6); an id is spent only when the instance booked something (B1). Phases 3–5 (observation paths, grid, tests/docs) pending — `docs/instructions/phase4-partial-fills-plan.md`. |

Earlier passes (2026-01 … 2026-09-14 ratings, the first gap-analysis rounds)
are in `docs/archived/` (`PROJECT_REVIEW.md`, the original
`PROJECT_REVIEW_GAP_ANALYSIS.md`).

---

## 6. Still open

| Priority | Item | Where |
| -------- | ---- | ----- |
| 🟠 P1 | **PR-1 (engine trading-path P0s) fully closed** — Phase 0 live proof ✅ 2026-10-01, Phase 2 ✅ `d746c4c`, Phase 3 ✅ `d5aa842`. Durable order/fill ledger (Phase 4) ✅ 2026-10-02. G1 (stale-id phantom fills, Gate 1 §3.1) ✅ 2026-10-02 (§4 row 2b). Next: accounting correctness (Phase 5), bot account sessions (plan §D), account-scoped position domain APIs | §4 |
| 🟡 P2 | Failure-injection harness (Phase 6), agent participation (plan §E), frontend identity residue (R1), `shared` split (defer) | §4, §3 |

### How to keep this document honest

1. Update §4 (ledger status) in the same commit as the code change it records —
   stale docs are treated as bugs (`CONTRIBUTING.md`).
2. Add the verification row to §2 when a review claim is re-checked, and record
   the result even when it contradicts the review.
3. When a finding closes, move its narrative to the archived cycle document
   instead of deleting it, and leave only a one-line pointer here.
4. Keep the README free of review history: it answers "what is the system
   today", this document answers "how did we get here / what remains".
