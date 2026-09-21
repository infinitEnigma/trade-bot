# Architecture

**How the platform works today.**

| Question                            | Document                                                         |
| ----------------------------------- | ---------------------------------------------------------------- |
| What is the system?                 | [README](../README.md)                                           |
| How does it work?                   | this document                                                    |
| How do we run and recover it?       | [OPERATIONS.md](OPERATIONS.md)                                   |
| How did we get here / what remains? | [PROJECT_REVIEW_GAP_ANALYSIS.md](PROJECT_REVIEW_GAP_ANALYSIS.md) |

---

## 1. Topology

Five independently deployable pieces: a React SPA, an Express backend, an
independent trading engine, PostgreSQL, and Redis.

```
┌───────────────┐  REST + Socket.IO  ┌────────────────────────┐
│   Frontend    │◀──────────────────▶│        Backend         │
│  React + Vite │                    │  Express · lifecycle   │
└───────────────┘                    │  auth · market · bots  │
                                     └───┬────────────┬───────┘
                                         │            │
                            PostgreSQL ◀─┘            └─▶ Redis
                        (lifecycle, audit,               (control plane,
                         credentials, wallet)             cache, dedup)
                                                            │
                                            Redis Streams   │
                                      commands ▼   ▲ events  │
                                     ┌──────────────────────┴─┐
                                     │         Engine         │
                                     │  BotManager            │
                                     │  StrategyRunner        │
                                     │  GridTradingStrategy   │
                                     │  OrderlyClient         │
                                     └───────────┬────────────┘
                                                 │ REST (signed)
                                                 ▼
                                      Exchange (Orderly/Kodiak)
```

| Component  | Responsibility                                                                                |
| ---------- | --------------------------------------------------------------------------------------------- |
| Frontend   | Dashboard, strategy/bot configuration, auth and wallet UX                                     |
| Backend    | REST API, auth/tiers, lifecycle state ownership, credential vault, engine supervision         |
| Engine     | Strategy execution, order placement/cancellation, per-bot grid slot state, event reporting    |
| PostgreSQL | Bot lifecycle + audit trail, command tracking, engine registry, credentials, wallet addresses |
| Redis      | Command/event streams, dedup markers, cache, engine registry liveness keys                    |

The backend is the **only** component that serves the frontend and the **only**
one that owns lifecycle state. The engine is deliberately exchange-agnostic: its
core (`application/`, `protocol/`, `domain/`, `strategies/`) never imports an
exchange SDK — exchange code lives behind the `ExchangeClient` interface.

---

## 2. Control plane (Backend ⇄ Engine)

Both processes coordinate over Redis Streams using consumer groups with manual
acknowledgement. The engine selects Redis logical database `1`.

| Direction        | Stream                     | Consumer group   | Consumer           | Producer                   |
| ---------------- | -------------------------- | ---------------- | ------------------ | -------------------------- |
| Backend → Engine | `tradebot:engine:commands` | `engine-workers` | `engine-consumer`  | backend command dispatcher |
| Engine → Backend | `tradebot:engine:events`   | `backend-group`  | `backend-consumer` | engine event publisher     |

**Commands:** `BOT_START`, `BOT_STOP` (plus engine-level control commands).
**Events:** `COMMAND_ACCEPTED`, `COMMAND_FAILED`, `STATE_CHANGED`,
`ENGINE_REGISTER`, `ENGINE_HEARTBEAT`.

Envelopes carry `messageId` (deduplication), `correlationId` (trace a command
through its lifecycle), `engineId` + `engineEpoch` (authority), and a timestamp.

### Delivery guarantees

| Property                 | Implementation                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delivery                 | At-least-once; stream entries are never deleted on read                                                                                                |
| Acknowledgement          | Manual `XACK` only after the handler resolves                                                                                                          |
| Crash recovery           | `XAUTOCLAIM` for pending entries idle beyond `PENDING_RECOVERY_MIN_IDLE_MS` (default 60s)                                                              |
| Older-Redis fallback     | When `XAUTOCLAIM` is unavailable (Redis < 6.2), falls back to `XPENDING` + `XCLAIM` with a client-side idle filter                                     |
| Deduplication            | Durable `SET NX EX` marker per `{scope}:{messageId}` (24h TTL) plus an in-memory cache. Marker writes **fail open** — double-processing beats dropping |
| Poison-message detection | `XPENDING` scan counts redeliveries; entries at or over the threshold are logged for operators                                                         |
| Staleness rejection      | Events from a non-authoritative engine or a superseded epoch are ignored                                                                               |

**Failure semantics differ by cause on the engine side:** business failures are
published as `COMMAND_FAILED` and the message is acked; transient infrastructure
failures stay pending so the recovery pass retries them.

---

## 3. Bot lifecycle model

The backend separates what the system _wants_ from what the engine _reports_:

```
desired_state: what the user/system wants (RUNNING | STOPPED)
actual_state:  what the engine reports (STOPPED | STARTING | RUNNING | STOPPING | ERROR | UNKNOWN)
```

```
STOPPED  ──START──▶ STARTING ──confirm──▶ RUNNING ──STOP──▶ STOPPING ──confirm──▶ STOPPED
STARTING ──failure──▶ ERROR | STOPPED
RUNNING  ──failure──▶ ERROR | UNKNOWN
STOPPING ──failure──▶ ERROR
UNKNOWN  ──reconnect──▶ RUNNING | STOPPED | ERROR
ERROR    ──retry──▶ STARTING | STOPPED
```

Every transition is applied with compare-and-set semantics
(`WHERE ... AND actual_state = $expected`), so concurrent requests cannot corrupt
state; a lost race returns 409.

### Ownership rule

`BotLifecycleService` is the only writer of lifecycle state:

```
        API routes ─┐
  Reconciler ───────┼──▶ BotLifecycleService ──┬──▶ BotLifecycleRepository (CAS + audit)
  Engine events ────┘                          ├──▶ BotCommandDispatcher   (command payloads + pending tracking)
                                               ├──▶ BotLifecycleNotifier   (Socket.IO bot.stateChanged)
                                               └──▶ BotEventProcessor      (engine events + supervision sweeps)
```

The reconciler repairs drift **through** the service; it never writes state
directly. Data-changing routes return `202 Accepted` rather than pretending the
transition already completed.

### Supervision mechanisms

| Mechanism                   | Behaviour                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command tracking + timeouts | Every dispatched command is recorded `PENDING`; a sweeper marks expired ones `TIMED_OUT` (`BOT_COMMAND_TIMEOUT_MS`, default 30s) and moves the bot to a terminal state                                                                    |
| Engine registry             | Engines register with a persistent `engineId` and a per-restart `epoch`; `RUNNING` bots are moved to `UNKNOWN` when the engine goes `OFFLINE`                                                                                             |
| Stale-generation rejection  | Events from a superseded engine or epoch are dropped, so a reconnected old process cannot rewrite current state                                                                                                                           |
| Reconciliation sweep        | Bounded, audited sweep (default every 60s, jittered): re-issues stop (max 3 per bot per hour), degrades stuck transitional states to `UNKNOWN`, and audits `desired=RUNNING` + `ERROR/UNKNOWN` as needing user action — never auto-starts |

---

## 4. Engine layering

`engine/src/index.ts` is a bootstrap: connect Redis → create the command consumer
group → load engine identity → construct `BotManager` → start the heartbeat →
enter the command loop. `SIGTERM`/`SIGINT` run a graceful shutdown that stops
every bot and publishes `STOPPED`.

```
engine/src/
├── index.ts                  # bootstrap: wiring, heartbeat, shutdown only
├── application/              # orchestration
│   ├── bot-manager.ts        # BOT_START/BOT_STOP: credential fetch, client, init, register
│   ├── strategy-runner.ts    # single-flight tick loop (skip, never queue)
│   └── lifecycle-coordinator.ts # ENGINE_REGISTER + ENGINE_HEARTBEAT, stopAll()
├── protocol/                 # Backend ⇄ Engine protocol
│   ├── command-consumer.ts   # read/claim/ack command loop
│   ├── event-publisher.ts    # event envelopes + bounded publish retry
│   └── credential-fetcher.ts # fetch decrypted credentials over the backend API
├── domain/                   # types + policies
│   ├── bot-runtime.ts        # runtime bot record (strategy, stopTick, client)
│   ├── engine-identity.ts    # persistent engineId + monotonic epoch
│   ├── exchange.ts           # ExchangeClient interface (extension point)
│   └── grid-snapshot.ts      # persisted grid slot state schema + version
├── exchanges/kodiak/client.ts # Orderly/Kodiak REST client (orders, queries)
├── strategies/grid.ts        # grid strategy: levels, ticks, order lifecycle
└── infrastructure/
    ├── redis/streams.ts      # streams, consumer groups, XAUTOCLAIM, dedup markers
    └── state/grid-state.ts   # snapshot load/save on disk
```

### The single-flight tick loop

Each running bot owns a `StrategyRunner`: a self-replacing `setTimeout` loop. If a
tick is still in flight when the interval elapses, the tick is **skipped** (and
re-armed) rather than queued, so two exchange round-trips can never overlap for
the same bot. Tick errors are reported through `onError` and do not stop the
loop; `stop()` clears the timer and prevents re-arming.

---

## 5. Strategy execution and order identity

The only strategy implemented today is the grid (`strategies/grid.ts`):

| Concern            | Behaviour                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Config             | `symbol`, `gridSize`, `gridRangePercent`, `orderQuantity` (resolved by `BotManager` from the strategy config)                               |
| Level construction | `gridSize + 1` prices evenly spaced across `±gridRangePercent/2` around a baseline price                                                    |
| Baseline           | Restored from the snapshot when present, otherwise the current mark price                                                                   |
| Slot state         | Per level: `price`, `buyOrderId`, `sellOrderId`, `filled`                                                                                   |
| Tick               | Fetch mark price → place buys below / sells above where no order exists → poll order status (5s per order) → persist the snapshot           |
| Order identity     | Deterministic `clientOrderId` = `{botId}:{levelIndex}:{side}`, so a redelivered command or a restart regenerates the same key               |
| Duplicate defence  | Get-before-create: list open orders for the symbol and adopt one matching the `clientOrderId`; on a create error, re-query before giving up |

**Currently uncovered transitions** (owned by the remediation plan; see
`PROJECT_REVIEW_GAP_ANALYSIS.md` §3): the create-order payload is not mapped to
the exchange's snake_case contract, the deterministic key exceeds the exchange's
36-character `client_order_id` limit, a `NOT_FOUND` order query leaves the slot
occupied forever, there is no startup cross-check of exchange orders against
restored slots, cancellation failures are swallowed while `STOPPED` is still
reported, and sell legs are placed at the buy price with mark-price PnL and no
`reduce_only`.

---

## 6. Data ownership

| Store       | Authoritative for                                                                         |
| ----------- | ----------------------------------------------------------------------------------------- |
| PostgreSQL  | Lifecycle state + audit, command tracking, engine registry, credentials, wallet addresses |
| Engine disk | Per-bot grid slot snapshot (operational cache)                                            |
| Redis       | Control-plane streams, dedup markers, engine liveness                                     |
| Exchange    | Live orders, fills, positions, balances — the ultimate source of truth                    |

There are therefore **three authorities** (backend database, engine snapshot,
exchange) and no single transaction spans them. Correctness depends on explicit
reconciliation rules; the rules that exist today, and the ones still missing, are
enumerated in `PROJECT_REVIEW_GAP_ANALYSIS.md` §3.

---

## 7. Cross-package contracts (`shared`)

`@trade-bot/shared` holds the protocol types (`protocol/`: `bot-state`,
`bot-command`, `bot-event`, `engine-lifecycle`), domain models, API DTOs, and
error classes used by backend, engine, and frontend.

**Rule:** `shared` is for **contracts**, not for implementation that more than one
package happens to import. Splitting the current package by domain is accepted
debt, deliberately deferred (P2).

---

## 8. Database migrations

| Migration                           | Adds                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `001_base_schema.sql`               | `users`, `kodiak_credentials`, `strategies`, `bot_instances`, `trades`, Kodiak account/position/balance/statistics tables, `audit_logs` |
| `002_initial_data.sql`              | Baseline indexes and reference data                                                                                                     |
| `002_user_roles.sql`                | `user_roles`                                                                                                                            |
| `003_safety_features.sql`           | Safety limits, audit + trade/position/statistics extensions                                                                             |
| `004_encryption_versioning.sql`     | `encryption_keys` (credential key rotation)                                                                                             |
| `005_performance_indexes.sql`       | Additional query indexes                                                                                                                |
| `006_fix_user_level_constraint.sql` | Aligns the user-level constraint with the access tiers                                                                                  |
| `007_bot_lifecycle.sql`             | `bot_lifecycle_events` (state-machine audit trail)                                                                                      |
| `008_bot_command_tracking.sql`      | `bot_commands` (pending / delivered / timeout tracking)                                                                                 |
| `009_engine_registry.sql`           | `engine_registry` (identity, epoch, heartbeat liveness)                                                                                 |
| `010_wallet_addresses.sql`          | `wallet_addresses` (wallet linking independent of exchange keys)                                                                        |

---

## 9. Extension points

**New exchange:** implement the `ExchangeClient` interface
(`engine/src/domain/exchange.ts`), add a client under
`engine/src/exchanges/<exchange>/`, and construct it in `BotManager` in place of
`createOrderlyClient(...)`. Nothing else in the engine core needs to change.

**New strategy:** add an implementation under `engine/src/strategies/`, expose it
through the strategy config resolved in `BotManager`, and drive it with a
`StrategyRunner` so the single-flight guarantee is preserved.

**New chain or network:** chain specifics belong to the exchange client; the core
stays chain-agnostic.
