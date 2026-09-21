# Trading Engine

**Exchange-Agnostic Trading Bot Engine for Automated Strategy Execution**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.15.0-brightgreen)](package.json)

---

## Overview

The trading engine is an independent, **exchange-agnostic** TypeScript service that executes automated trading strategies. It currently supports the Kodiak and Orderly exchange connectors and is designed to support multiple exchanges and chains. It consumes commands from and publishes events to Redis Streams, coordinated by the backend.

> **Tick scheduling**: each running bot is driven by a single-flight tick loop — an
> overrunning tick is skipped rather than queued, so exchange calls never overlap
> for the same bot.

### Key Features

- **Redis Streams Command Consumer** - Receives BOT_START/BOT_STOP commands from backend
- **Event Publisher** - Publishes COMMAND_ACCEPTED, STATE_CHANGED, ENGINE_REGISTER, ENGINE_HEARTBEAT events
- **Engine Identity + Epoch** - Persistent identity with monotonic epoch for stale-event rejection
- **Heartbeat** - Periodic liveness reporting to backend
- **Strategy Execution** - Grid trading strategy with order management
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
│   │   └── lifecycle-coordinator.ts # Heartbeat + registration + shutdown
│   ├── protocol/             # Protocol layer
│   │   ├── command-consumer.ts # Redis Streams command consumer loop
│   │   ├── credential-fetcher.ts # Credential fetching from backend
│   │   └── event-publisher.ts # Event publishing helpers
│   ├── domain/               # Domain types
│   │   ├── bot-runtime.ts    # Bot runtime interfaces
│   │   ├── engine-identity.ts # Engine identity management
│   │   ├── exchange.ts       # Exchange client interface
│   │   └── grid-snapshot.ts  # Persisted grid slot state (versioned schema)
│   ├── exchanges/            # Exchange integrations (pluggable)
│   │   └── kodiak/
│   │       └── client.ts     # Kodiak/Orderly API client
│   ├── strategies/           # Trading strategy implementations
│   │   └── grid.ts           # Grid trading strategy
│   ├── infrastructure/       # Infrastructure adapters
│   │   ├── redis/streams.ts  # Redis Streams client (claim / ack / dedup)
│   │   └── state/grid-state.ts # Grid snapshot load/save on disk
│   ├── types/                # TypeScript definitions
│   │   └── strategy.ts       # Strategy interfaces
│   └── utils/logger.ts       # Structured logging
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

- Node.js ≥ 25.0.9
- Backend API running
- PostgreSQL database
- Redis cache
- Exchange API credentials (e.g., Kodiak)

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
}
```

**How it works**:

1. Calculates grid levels around current price
2. Places buy orders at levels below current price
3. When a buy order fills, it places the corresponding sell order for that level
4. Tracks P&L per completed buy-sell cycle (calibration of the profit logic is
   tracked as finding N6 in the gap analysis)

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
- **Snapshot-restored grid**: slot state (including live order ids) survives restarts.

Open items on the trading path — exchange call contract, order reconciliation,
snapshot durability, accounting — are tracked in
[`docs/PROJECT_REVIEW_GAP_ANALYSIS.md`](../docs/PROJECT_REVIEW_GAP_ANALYSIS.md);
the full design is in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

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

**Engine Status**: In Development | **Architecture**: Exchange-Agnostic | **Version**: 1.0.0 | **Updated**: September 20, 2026
