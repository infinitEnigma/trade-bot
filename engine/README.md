# Trading Engine

**Exchange-Agnostic Trading Bot Engine for Automated Strategy Execution**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.15.0-brightgreen)](package.json)

---

## Overview

The trading engine is an independent, **exchange-agnostic** TypeScript service that executes automated trading strategies. It ships **Kodiak/Orderly** and **Lighter** connectors (Lighter signs through the `sidecar/lighter-signer` HTTP service, live-verified in Gate 3) and consumes commands from / publishes events to Redis Streams, coordinated by the backend.

> **Tick scheduling**: each running bot is driven by a single-flight tick loop — an
> overrunning tick is skipped rather than queued, so exchange calls never overlap
> for the same bot.

### Key Features

- **Redis Streams Command Consumer** - Receives BOT_START/BOT_STOP commands from backend
- **Event Publisher** - Publishes control-plane events (COMMAND_ACCEPTED, STATE_CHANGED, ENGINE_REGISTER, ENGINE_HEARTBEAT) **and** ledger events (ORDER_INTENT, TRADE_EXECUTED, POSITION_UPDATED, PERFORMANCE_SNAPSHOT)
- **Engine Identity + Epoch** - Persistent identity with monotonic epoch for stale-event rejection
- **Heartbeat** - Periodic liveness reporting to backend
- **Strategy Execution** - Grid trading strategy with held-quantity order management, per-fill partial accounting and restart-safe snapshots
- **Order Reconciliation** - `OrderReconciliationService` + `OrderManager`: get-before-create placement, id-spending generations (G1), delta-only fill bookings, terminal-cancel remainders
- **Graceful Shutdown** - Safe bot termination with order cancellation on SIGTERM/SIGINT

---

## Architecture

```
Trading Engine (exchange-agnostic core)
├── src/
│   ├── index.ts              # Entry point (bootstrap): Redis connect, engine
│   │                         #   identity, heartbeat, command loop, shutdown
│   ├── application/         # Application layer
│   │   ├── bot-manager.ts    # BOT_START/BOT_STOP orchestration
│   │   ├── strategy-runner.ts # Single-flight tick loop
│   │   ├── lifecycle-coordinator.ts # Heartbeat + registration + shutdown
│   │   ├── order-manager.ts  # Slot records, held-quantity projection, id generations
│   │   ├── order-reconciliation.service.ts # Placement/verification/startup reconciliation
│   │   └── trade-reporter.ts # Ledger event emission (segment-bounded fill ids)
│   ├── protocol/             # Protocol layer
│   │   ├── command-consumer.ts # Redis Streams command consumer loop
│   │   ├── credential-fetcher.ts # Credential fetching from backend
│   │   └── event-publisher.ts # Event publishing helpers
│   ├── domain/               # Domain types
│   │   ├── bot-runtime.ts    # Bot runtime interfaces
│   │   ├── engine-identity.ts # Engine identity management
│   │   ├── exchange.ts       # Exchange client interface (incl. `executedQuantity`)
│   │   ├── grid-snapshot.ts  # Persisted grid slot state incl. quantity fields (checksummed, `.prev` fallback)
│   │   └── order-state.ts    # Slot machine: PARTIALLY_FILLED / pendingFill / startup report
│   ├── exchanges/            # Exchange integrations (pluggable)
│   │   ├── kodiak/
│   │   │   └── client.ts     # Kodiak/Orderly API client
│   │   └── lighter/
│   │       └── client.ts     # Lighter client (venue REST + sidecar signer)
│   ├── strategies/           # Trading strategy implementations
│   │   └── grid.ts           # Grid trading strategy
│   ├── infrastructure/       # Infrastructure adapters
│   │   ├── redis/streams.ts  # Redis Streams client (claim / ack / dedup)
│   │   └── state/grid-state.ts # Grid snapshot load/save on disk
│   ├── types/                # TypeScript definitions
│   │   └── strategy.ts       # Strategy interfaces (GridLevel incl. heldQty / side cumulatives)
│   └── utils/                # Logging, client-order-id synthesis, segment-bounded fill ids
│       ├── logger.ts         # Structured logging
│       ├── client-order-id.ts # Deterministic client order ids (incl. generations)
│       └── fill-id.ts        # Legacy vs segment fill-id synthesis (8-dp bounds)
```

> **Architecture**: The engine is exchange-agnostic. The core (`application/`, `protocol/`, `domain/`, `strategies/`) is decoupled from specific exchanges. Exchange implementations live in `exchanges/` and implement the `ExchangeClient` interface defined in `domain/exchange.ts`.

---

## Bot Lifecycle Protocol

### Command Processing

```
Backend                          Engine
   │                               │
   ├──── BOT_START command ────────▶│
   │                               │─── COMMAND_ACCEPTED event ───▶│
   │                               │─── STATE_CHANGED(STARTING) ──▶│
   │                               │   [fetch credentials]
   │                               │   [connect to Orderly]
   │                               │   [initialize strategy]
   │                               │─── STATE_CHANGED(RUNNING) ───▶│
```

### Engine Identity

```typescript
interface EngineIdentity {
  engineId: string; // Persistent across restarts
  epoch: number; // Incremented on every start
}
```

The backend rejects events from a superseded epoch, preventing stale events from old engine processes.

### Credential Flow

Credentials are **never** sent through Redis Streams. After COMMAND_ACCEPTED, the engine fetches them from:

```
GET /api/bot/engine/credentials/:botId?correlationId=...
```

This requires `BOT_ENGINE_API_KEY` for authentication.

---

## Quick Start

### Prerequisites

- Node.js ≥ 24.15.0 (repo `engines` floor; `.nvmrc` pins the exact dev version)
- Backend API running
- PostgreSQL database
- Redis cache
- Exchange API credentials (Kodiak/Orderly, or Lighter via the signing
  sidecar — see `sidecar/lighter-signer/README.md`)

### Configuration

The engine uses environment variables from the project root `.env` file:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trade_bot

# Redis
REDIS_URL=redis://localhost:6379

# Trading
KODIAK_API_URL=https://api.orderly.org/v1/
KODIAK_WS_URL=wss://ws-evm.orderly.org/ws/stream/

# Authentication
ENCRYPTION_MASTER_KEY=your-32-char-key
BOT_ENGINE_API_KEY=your-engine-api-key
BACKEND_URL=http://localhost:3000

# Engine Identity (optional)
ENGINE_ID=my-engine-1  # Optional: persistent engine identifier
ENGINE_STATE_FILE=./.engine-state.json
```

### Development

```bash
# Start engine in development mode
npm run dev

# Build and start in production
npm run build && npm start
```

---

## Trading Strategies

### Grid Trading Strategy

Creates automated buy/sell grids around a central price level.

**Configuration**:

```typescript
interface GridStrategyConfig {
  symbol: string; // Trading pair (e.g., "ETH_PERP")
  gridSize: number; // Number of grid levels
  gridRangePercent: number; // Price range percentage
  orderQuantity: number; // Quantity per order
  takeProfitPercent?: number; // Optional take profit above the executed entry
  stopLossPercent?: number; // Optional stop loss
}
```

**How it works**:

1. Calculates grid levels around current price
2. Places buy orders at levels below current price (**only the shortfall** if
   the level already booked a partial segment)
3. Observes every live slot on a 5 s throttle: live partials book `delta`-only
   `PARTIALLY_FILLED` rows and stay on the order; completions book the
   remainder; terminal cancels book the final executions as a `pendingFill`
   before the slot re-arms (stale ids are never re-queried — spent client ids
   bump a generation)
4. Exits arm on held quantity and are always `reduce_only`, so a stale sell
   can never open a short; below-minimum remainder refusals declare the level
   long (C2 snap) so the exit can close the real position
5. Books realized PnL `(sellExec − weightedEntry) × qty − fee` per closing
   segment, persisting a checksummed snapshot (with `.prev` fallback) every
   tick so fills/orders survive restarts without double-booking

---

## Protocol Reliability

### At-Least-Once Delivery

- Messages are not deleted after being read
- ACK only after handler completes successfully
- Failed handler → message left unacked for redelivery

### Pending Message Recovery

- `XAUTOCLAIM` recovers messages from crashed consumers
- Minimum idle time before reclaim: `PENDING_RECOVERY_MIN_IDLE_MS` (default 60s)

### Deduplication

- Processed message IDs stored durably in Redis (24h TTL)
- In-memory cache for fast lookup
- Prevents re-execution after restarts

### Poison Message Detection

- Tracks redelivery count per pending message
- Logs warning when threshold exceeded (`PENDING_POISON_MAX_DELIVERIES`, default 10)

### Heartbeat

- Engine publishes `ENGINE_HEARTBEAT` every `ENGINE_HEARTBEAT_INTERVAL_MS` (default 10s)
- Backend marks engine `OFFLINE` after `ENGINE_HEARTBEAT_TIMEOUT_MS` (default 30s)
- Heartbeat includes `activeBotIds` for reconciliation

---

## Environment Variables

| Variable                           | Default                  | Description                        |
| ---------------------------------- | ------------------------ | ---------------------------------- |
| `BACKEND_URL`                      | `http://localhost:3000`  | Backend base URL                   |
| `BOT_ENGINE_API_KEY`               | (required)               | Backend engine API key             |
| `REDIS_URL`                        | `redis://localhost:6379` | Redis connection URL               |
| `ENGINE_ID`                        | auto-generated           | Persistent engine identifier       |
| `ENGINE_STATE_FILE`                | `./.engine-state.json`   | Engine identity persistence        |
| `ENGINE_HEARTBEAT_INTERVAL_MS`     | `10000`                  | Heartbeat interval (ms)            |
| `PENDING_RECOVERY_MIN_IDLE_MS`     | `60000`                  | Min idle before XAUTOCLAIM (ms)    |
| `PENDING_STUCK_ALERT_THRESHOLD_MS` | `30000`                  | Stuck pending alert threshold (ms) |
| `PENDING_POISON_MAX_DELIVERIES`    | `10`                     | Poison message threshold           |

---

## Architecture Highlights

- **Layered**: `application/`, `protocol/`, `domain/`, `exchanges/`, `infrastructure/`.
- **Exchange-agnostic**: the core depends only on the `ExchangeClient` interface.
- **Single-flight ticks**: an overrunning tick is skipped, never queued.
- **Snapshot-restored grid**: slot state (incl. live order ids and
  held quantities) survives restarts; snapshots are checksummed with a
  `.prev` fallback, and quantity state reseeds per-side cumulatives so
  fills are never double-booked.
- **Ledger-backed fills**: `ORDER_INTENT` gates placement; `TRADE_EXECUTED`
  rows carry segment-bounded `fill_id`s (legacy identity preserved for
  whole-order fills), `PARTIALLY_FILLED` segments for partials, and
  `PARTIALLY_FILLED` rows for terminal-cancel remainders.
- **Held-quantity exits**: a level holds `heldQty` (not a boolean), weighted
  entry pricing, and `reduce_only` exits.

Open items on the trading path live in
[`docs/PROJECT_REVIEW_GAP_ANALYSIS.md`](../docs/PROJECT_REVIEW_GAP_ANALYSIS.md);
as of 2026-10-04 the code side is complete through per-fill partial
accounting, with the live Gate-4 run-2 venue proof as the remaining gate.

### Exchange Extensibility

To add a new exchange:

1. Create `src/exchanges/{exchange}/client.ts`
2. Implement the `ExchangeClient` interface from `src/domain/exchange.ts`
3. The engine core automatically works with the new exchange

---

## Code Standards

- TypeScript strict mode enabled
- ESLint configuration enforced
- Prettier formatting on commit
- Winston structured logging
- All Redis operations through centralized streams client

---

**Engine Status**: Functional¹ | **Architecture**: Exchange-Agnostic | **Version**: 1.0.0 | **Updated**: October 4, 2026

¹ The trading path runs Kodiak/Orderly and Lighter through the full
reconciliation → booking → ledger pipeline, including partial fills. The one
remaining gate is the live Gate-4 run-2 venue proof (engine-path partials on
testnet), which requires the Lighter signing sidecar.
