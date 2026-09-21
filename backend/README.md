# Trade Bot Backend

**Express.js API Server - Chain & Exchange Agnostic Trading Platform**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](tsconfig.json)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.15.0-brightgreen)](package.json)
[![Express.js](https://img.shields.io/badge/Express.js-5.x-lightgrey)](package.json)

---

## Overview

The backend is an Express.js API server that serves the frontend, manages user authentication, and orchestrates bot lifecycle through a Redis Streams protocol with the trading engine. It is **chain- and exchange-agnostic** - supporting multiple blockchains and exchanges through a pluggable architecture.

### Key Responsibilities

- **REST API** for frontend communication (auth, users, bots, strategies, wallet)
- **Bot Lifecycle Management** - desired/actual state machine with PostgreSQL persistence
- **Engine Protocol** - Redis Streams control plane for engine coordination
- **WebSocket Server** - real-time bot state updates to the frontend (market data is served over HTTP)
- **Credential Management** - encrypted storage of Kodiak API keys
- **User Access Progression** - BASIC → REGISTERED (wallet signature) → VERIFIED (exchange credentials)

---

## Architecture

### Bot Lifecycle Service

The `BotLifecycleService` is the sole owner of bot lifecycle state. API routes must not manipulate bot state directly; they call this service and return 202 Accepted.

```
BotLifecycleService (orchestrator)
        │
        ├── BotLifecycleRepository  - PostgreSQL persistence (CAS transitions, audit trail)
        ├── BotCommandDispatcher    - command payloads + pending-command tracking
        ├── BotLifecycleNotifier    - Socket.IO bot.stateChanged bridge
        └── BotEventProcessor       - engine event handling + supervision sweeps
```

### Engine Protocol Service

The `EngineProtocolService` implements the Redis Streams control plane:

- **Commands** (Backend → Engine): `tradebot:engine:commands` stream
- **Events** (Engine → Backend): `tradebot:engine:events` stream
- Consumer groups with manual ACK
- Pending-message recovery via `XAUTOCLAIM`
- Durable deduplication (Redis SET NX EX 24h)
- Poison-message detection

### Domain Services

```
core/
├── auth/          # JWT authentication, role management
├── bots/          # Bot lifecycle + engine protocol (see above)
├── logging/       # Structured logging with correlation IDs
├── market/        # Market data services
├── strategies/    # Strategy management + engine process supervision
├── user/          # User profiles, Kodiak credentials
└── wallet/        # Balance management, qualification checks
```

### User Access Tiers

User level is owned by the auth domain and enforced on every privileged route.

```
BASIC ──connect wallet + sign message──▶ REGISTERED ──verify Kodiak keys──▶ VERIFIED
```

| Level          | Requirement                                         | Notes                                            |
| -------------- | --------------------------------------------------- | ------------------------------------------------ |
| **BASIC**      | Email + password                                    | Public-source data only                          |
| **REGISTERED** | Linked wallet, ownership proven by a signed message | Exchange credential setup (Settings) is unlocked |
| **VERIFIED**   | Verified Kodiak API credentials                     | Strategies, bot configuration, private data      |

Wallet linking is stored in its own `wallet_addresses` table (migration `010_wallet_addresses.sql`), independent of `kodiak_credentials`, so a wallet can be linked without supplying exchange keys. `POST /api/user/unlink-wallet` is an explicit, audited action that downgrades the account (`VERIFIED → REGISTERED`, `REGISTERED → BASIC`).

### Infrastructure

```
infrastructure/
├── cache/         # Redis caching, streams, connection management
├── external/      # Kodiak API integration
├── messaging/     # Socket.IO server (auth middleware + bot state bridge)
├── security/      # Encryption, rate limiting, key management
└── adapters/      # Repository implementations, external service adapters
```

---

## Bot Lifecycle Protocol

### Desired/Actual State Machine

```
desired_state: what the user/system wants (RUNNING | STOPPED)
actual_state:  what the engine reports (STOPPED | STARTING | RUNNING | STOPPING | ERROR | UNKNOWN)
```

### Command Flow

```
POST /api/bot/start → 202 Accepted { botId, desiredState: RUNNING, actualState: STARTING }

Backend                          Engine
   │                               │
   ├──── BOT_START command ────────▶│
   │                               │
   │◀─── COMMAND_ACCEPTED event ───┤
   │                               │
   │◀─── STATE_CHANGED(STARTING) ──┤
   │                               │
   │◀─── STATE_CHANGED(RUNNING) ───┤
   │                               │
```

### Lifecycle Reconciliation

`LifecycleReconciliationService` (`src/core/bots/lifecycle-reconciliation.service.ts`) runs a bounded,
audited reconciliation sweep (default every 60s, jittered) started only by the main server lifecycle,
after DB, engine protocol, command-timeout sweeper and engine registry supervision are up:

- `desired=STOPPED` but engine active → reissue `BOT_STOP` (max 3 reissues/bot/hour, tracked PENDING,
  so the timeout sweeper continues to supervise it).
- Transitional state stuck beyond grace (3x command timeout) with no `PENDING` command → degrade to
  `UNKNOWN` via compare-and-set + `RECONCILE_MARKED_UNKNOWN` audit event.
- `desired=RUNNING` but actual `ERROR/UNKNOWN` → audit-only `RECONCILE_NEEDS_USER_ACTION` (no auto-start).

It never writes lifecycle state directly: all repairs go through `BotLifecycleService`. Phase-0
attribution counters (Kodiak requests/cache hit-miss/429, Orderly connections, privileged WebSocket
connections, market subscriptions) are exposed at `GET /api/system/metrics` under `external_traffic`.

### Supervision Mechanisms

- **Command tracking & timeouts**: Every delivered command is recorded as `PENDING`. A sweeper marks expired commands `TIMED_OUT` and transitions stuck bots to `ERROR`.
- **Concurrency safety**: Every lifecycle UPDATE uses compare-and-set (`WHERE ... AND actual_state = $expected`); concurrent requests return 409.
- **Engine registration & heartbeat**: Engines register with persistent `engineId` + restart `epoch`. The registry marks engines `OFFLINE` after heartbeat timeout and transitions RUNNING bots to `UNKNOWN`.
- **Stale-generation rejection**: Events from a non-authoritative engine or superseded epoch are ignored.

---

## Quick Start

### Prerequisites

- Node.js ≥ 24.15.0 (LTS; `.nvmrc` pins `24.21.0`)
- PostgreSQL 14+
- Redis 5.0+ (6.2+ preferred for `XAUTOCLAIM`; older servers fall back to `XPENDING`/`XCLAIM`)

### Configuration

Create `.env` in the project root:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trade_bot
DB_USER=postgres
DB_PASSWORD=yourpassword

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
ENCRYPTION_MASTER_KEY=your-32-char-encryption-key

# External APIs
KODIAK_API_URL=https://api.orderly.org/v1/
KODIAK_WS_URL=wss://ws-evm.orderly.org/ws/stream/

# Application
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### Development

```bash
# Start with auto-reload
npm run dev

# Run database migrations (scripts/run-migrations.js, ledger-tracked)
npm run db:migrate

# Validate schema for runtime query validation (does not run migrations)
npm run db:validate

# Build for production
npm run build && npm start
```

---

## API Endpoints

### Authentication

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout

### Bot Management

- `POST /api/bot/start` - Start a bot (returns 202 Accepted)
- `POST /api/bot/stop` - Stop a bot (returns 202 Accepted)
- `GET /api/bot/status/:botId` - Get bot status

### User Profile & Access Tiers

- `GET /api/user/profile` - Authenticated user profile (includes `userLevel`)
- `POST /api/user/profile/update` - Update profile fields
- `POST /api/user/verify-wallet` - Verify a signed message and link the wallet (`BASIC → REGISTERED`)
- `POST /api/user/unlink-wallet` - Unlink the wallet (audited); downgrades the level (`VERIFIED → REGISTERED`, `REGISTERED → BASIC`)

### Engine (internal)

- `GET /api/bot/engine/credentials/:botId` - Engine fetches credentials out-of-band (bot-scoped API key)
- `POST /api/bot/engine/report-trade` - Trade/fill reporting endpoint; present but **not called by the engine today** (see Known Issues)

### Other

- `GET /api/system/health` - Health check
- `GET /api/market/ticker` - Market data
- `GET /api/wallet/balance` - Wallet balance

---

## Known Issues

Review history and open findings are tracked outside this README:

- [docs/PROJECT_REVIEW_GAP_ANALYSIS.md](../docs/PROJECT_REVIEW_GAP_ANALYSIS.md) —
  verified review findings and the remediation ledger
- [docs/OPERATIONS.md](../docs/OPERATIONS.md) — runbooks (Redis unavailable,
  engine offline, stuck transitions, reconciliation sweeps, post-incident checks)
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — control plane, lifecycle
  model, engine layering, data ownership

Notable backend behaviours worth knowing before changing lifecycle code:

- Command timeouts are tracked with reason codes (`STATE_MISMATCH`,
  `STOP_INCOMPLETE`, `ENGINE_NO_RESPONSE`, `COMMAND_NEVER_DELIVERED`) and map to
  target states (`UNKNOWN` for ambiguous state, `ERROR` for engine failures).
- `POST /api/bot/engine/report-trade` exists and writes to `trades`, but **no
  engine code calls it today**; see finding N7 before relying on it.

## Code Standards

- TypeScript strict mode enabled
- ESLint configuration enforced
- Prettier formatting on commit
- Winston structured logging with correlation IDs
- All bot lifecycle mutations go through BotLifecycleService

---

**Backend Status**: Functional | **Architecture**: Chain & Exchange Agnostic | **Version**: 1.0.0 | **Updated**: September 20, 2026
