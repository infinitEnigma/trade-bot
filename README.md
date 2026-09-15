# Trade Bot

**Automated Perpetual Futures Trading Platform**

[![License: Apache](https://img.shields.io/badge/License-Apache-yellow.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D25.0.0-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](tsconfig.json)

---

## Overview

Trade Bot is a **full-stack, chain-agnostic automated trading platform** for perpetual futures. It uses a distributed architecture with a React frontend, Node.js Express backend, and an independent trading engine coordinated via Redis Streams.

| Component | Technology | Status | Documentation |
|-----------|-----------|--------|---------------|
| **Network** | Multi-chain (Berachain, EVM, Solana) | ✅ Extensible | - |
| **Exchange** | Multi-exchange (Kodiak, + extensible) | ✅ Extensible | - |
| **Frontend** | React 19 + Vite + Tailwind CSS | ✅ Functional | [📖 Frontend Docs](frontend/README.md) |
| **Backend** | Express.js + PostgreSQL + Redis | ✅ Functional | [📖 Backend Docs](backend/README.md) |
| **Trading Engine** | TypeScript (Node.js) | ⚠️ In Development | [📖 Engine Docs](engine/README.md) |
| **Shared Contracts** | TypeScript types | ✅ Functional | - |

> **Maturity Assessment**: The architecture is a **chain- and exchange-agnostic distributed system** with proper backend-engine coordination. The Backend ↔ Engine protocol (Redis Streams, explicit state transitions, ACKs, correlation IDs, engine epochs, heartbeats) is the strongest architectural area. However, several critical correctness and operational issues remain before this can be considered production-grade. See [Known Issues & Priorities](#known-issues--priorities) below.

---

## User Access Tiers

Users progress through three access levels. Progression is enforced server-side and reflected in the authenticated session profile.

| Level | How it is reached | Access |
|-------|-------------------|--------|
| **BASIC** | Email + password registration and login (no email verification) | Public-source market data (prices, charts) and general dashboard pages |
| **REGISTERED** | Connect a wallet on the Dashboard and sign the welcome message (ownership verified by the backend) | Wallet-linked features; exchange credential setup (Settings) becomes available |
| **VERIFIED** | Add exchange (Kodiak) API credentials in Settings and have them verified by the backend | Trading strategies, bot configuration, exchange-specific and private data |

```
BASIC ──connect wallet + sign message──▶ REGISTERED ──verify exchange keys──▶ VERIFIED
```

- Wallet signatures are verified server-side (`POST /api/user/verify-wallet`). The linked wallet is stored independently of exchange credentials (see the `wallet_addresses` migration).
- Unlinking a wallet (`POST /api/user/unlink-wallet`) is an explicit, audited action that downgrades the account: `VERIFIED → REGISTERED`, `REGISTERED → BASIC`. Disconnecting the browser wallet session alone does **not** change the account level.
- BASIC users receive data from public sources only; REGISTERED and VERIFIED users additionally receive exchange-specific and private data.

---

## Quick Start

### Prerequisites
- Node.js ≥ 25.0.9
- PostgreSQL 14+
- Redis 5.0+

### Installation & Development

```bash
# Clone and install dependencies
git clone <repo-url> && cd trade-bot
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database, Redis, and API credentials

# Run database migrations
npm run db:migrate

# Start all services
npm run dev

# Or start individual services
npm run dev:frontend   # http://localhost:5173
npm run dev:backend    # http://localhost:3000
npm run dev:engine     # Trading bot engine
```

### Production Build

```bash
npm run build          # Build all packages
npm start              # Start production server
```

---

## Architecture

### Distributed System Design

The platform uses a distributed architecture where the Backend and Engine are independent processes coordinated via Redis Streams:

```
                    ┌───────────────┐
                    │   Frontend    │
                    │ React + Vite  │
                    └───────┬───────┘
                            │ HTTP / Socket.IO
                            ▼
                    ┌───────────────┐
                    │    Backend    │
                    │ Express       │
                    │ PostgreSQL    │
                    │ Redis         │
                    └───────┬───────┘
                            │
                   Redis Streams
                 command/event bus
                            │
                            ▼
                    ┌───────────────┐
                    │    Engine     │
                    │ BotManager    │
                    │ Strategy      │
                    │ Orderly/Kodiak│
                    └───────────────┘
```

### Backend ↔ Engine Protocol

The control plane between Backend and Engine uses Redis Streams with consumer groups:

- **Commands** (Backend → Engine): `tradebot:engine:commands` stream
- **Events** (Engine → Backend): `tradebot:engine:events` stream

Both sides implement:
- **At-least-once delivery** with manual ACK after processing
- **Pending-message recovery** via `XAUTOCLAIM` for crashed consumers
- **Deduplication** using durable Redis markers (24h TTL) + in-memory cache
- **Correlation IDs** to trace commands through their lifecycle
- **Engine identity + epoch** to reject stale events from superseded processes
- **Heartbeat monitoring** for engine liveness detection
- **Poison-message detection** for repeatedly redelivered messages

### Bot Lifecycle State Machine

The backend separates desired state from actual state:

```
desired_state: what the user/system wants (RUNNING | STOPPED)
actual_state:  what the engine reports (STOPPED | STARTING | RUNNING | STOPPING | ERROR | UNKNOWN)
```

Valid transitions:

```
STOPPED  ──START──▶ STARTING ──confirm──▶ RUNNING ──STOP──▶ STOPPING ──confirm──▶ STOPPED
STARTING ──failure──▶ ERROR | STOPPED
RUNNING  ──failure──▶ ERROR | UNKNOWN
STOPPING ──failure──▶ ERROR
UNKNOWN  ──reconnect──▶ RUNNING | STOPPED | ERROR
ERROR    ──retry──▶ STARTING | STOPPED
```

Every transition is validated centrally using compare-and-set semantics to prevent concurrent state corruption.

### Project Structure

```
trade-bot/
├── frontend/                  # React SPA dashboard
│   └── src/
│       ├── features/          # Domain features (auth, bots, strategies, dashboard, analytics)
│       ├── infrastructure/    # API client, WebSocket, caching
│       └── shared/            # UI components, hooks, utilities
├── backend/                   # Express API server
│   └── src/
│       ├── core/              # Business domains
│       │   ├── auth/          # Authentication & authorization
│       │   ├── bots/          # Bot lifecycle management + engine protocol
│       │   ├── logging/       # Structured logging with correlation IDs
│       │   ├── market/        # Market data services
│       │   ├── strategies/    # Strategy management + engine process supervision
│       │   ├── user/          # User profiles & Kodiak credentials
│       │   └── wallet/        # Balance management
│       ├── interfaces/        # HTTP routes, middleware, WebSocket
│       ├── infrastructure/    # Redis, PostgreSQL, security, external APIs
│       └── workers/           # Background processing
├── engine/                    # Exchange-agnostic trading engine
│   └── src/
│       ├── index.ts           # Entry point (bootstrap only)
│       ├── application/       # Bot lifecycle + heartbeat coordination
│       ├── protocol/          # Command consumer + event publisher
│       ├── domain/            # Bot runtime types + exchange interface
│       ├── exchanges/         # Exchange integrations (pluggable)
│       │   └── kodiak/        # Kodiak/Orderly (first exchange)
│       ├── strategies/        # Grid trading strategy
│       ├── infrastructure/    # Redis Streams client
│       ├── types/             # Strategy type definitions
│       └── utils/             # Logging utility
├── shared/                    # Cross-package TypeScript contracts
│   └── src/
│       ├── protocol/          # Bot lifecycle protocol types
│       │   ├── bot-state.ts   # State machine & transitions
│       │   ├── bot-command.ts # Command types & envelope
│       │   ├── bot-event.ts   # Event types
│       │   └── engine-lifecycle.ts # Engine registration & heartbeat
│       └── types/             # Domain models, infrastructure contracts
├── database/                  # PostgreSQL migrations
├── docs/                      # Architecture & deployment docs
└── scripts/                   # Build & maintenance scripts
```

### Scripts

```bash
# Development
npm run dev              # Start all services
npm run dev:frontend    # Frontend only (Vite)
npm run dev:backend     # Backend only with auto-reload
npm run dev:engine      # Bot engine only

# Building
npm run build           # Build all packages

# Testing
npm run test            # Run full test suite

# Linting & Formatting
npm run lint            # Lint all packages
npm run lint:fix        # Fix lint issues
npm run format          # Format all packages
```

---

## Security

- ✅ **JWT Authentication** with refresh token rotation
- ✅ **CSRF Protection** for browser routes
- ✅ **Rate Limiting** (100 req/15s per IP)
- ✅ **CORS Protection** with origin validation
- ✅ **Helmet Security Headers**
- ✅ **Password Hashing** (bcrypt)
- ✅ **Encrypted credential storage** for Kodiak API keys
- ✅ **Wallet ownership verification** through signed messages, with audited link/unlink and level downgrade
- ✅ **API key authentication** for engine-to-backend communication

---

## Known Issues & Priorities

Based on architectural review, the following issues are tracked:

### ✅ Recently Fixed

| Issue | Fix | Files Changed |
|-------|-----|---------------|
| **Overlapping Strategy Ticks** | Replaced `setInterval()` with sequential tick loop using self-replacing `setTimeout`. Added single-flight guard (`tickRunning` flag) to skip interval if previous tick still executing. | `engine/kodiak/src/index.ts` |
| **Trading Operation Idempotency** | Added deterministic `clientOrderId` generation using format `{botId}:{levelIndex}:{side}`. Same bot/level/side always produces the same ID, allowing exchange to detect duplicates on command redelivery. | `engine/kodiak/src/strategies/grid.ts` |

### 🔴 Critical (P0)

| Issue | Description |
|-------|-------------|
| **Reconciliation Worker Disabled** | ✅ Fixed: Replaced by a lifecycle-aware reconciler (`LifecycleReconciliationService`) that repairs desired/actual drift through `BotLifecycleService` only, with bounded stop-reissues, stuck-transition degradation to UNKNOWN, audit events, and CAS-safe transitions. The superseded `BotReconciliationWorker` has been deleted. |

### 🟠 High (P1)

| Issue | Description |
|-------|-------------|
| **Redis Failure Semantics** | ✅ Fixed: Bot start/stop endpoints now return 503 when Redis is unavailable. Health endpoint includes `controlPlane` status. |
| **Engine Monolithic Design** | ✅ Fixed: The engine's `BotManager` is embedded in `index.ts`, handling command consumption, heartbeats, bot lifecycle, credential retrieval, and strategy scheduling in a single file. |
| **Command Timeout Semantics** | ✅ Fixed: Added timeout reason tracking with appropriate state transitions. |

### 🟡 Medium (P2)

| Issue | Description |
|-------|-------------|
| **Legacy Bot Status Models** | ✅ Fixed: Consolidated around canonical `BotActualState` from `@trade-bot/shared/src/protocol`. Removed duplicate enums and inline status strings. |
| **Shared Package Scope** | `@trade-bot/shared` has become a god package containing protocol types, domain models, API contracts, error classes, and logging types. Should be split. |
| **Dead Code Cleanup** | ✅ Fixed: Removed the dormant Orderly `market-stream` subsystem, the superseded `BotReconciliationWorker`, the `service-selector` rollout shim, unused WebSocket/DI getters, unused frontend `QuickActions`, and one-off Redis debug scripts. |

---

## Roadmap

### Current Focus
- [x] Fix overlapping strategy tick execution (single-flight scheduler)
- [x] Implement business-operation idempotency for trading orders
- [x] Define explicit control-plane behavior when Redis is unavailable
- [x] Refactor engine into modular, exchange-agnostic architecture
- [x] Replace legacy reconciliation worker with lifecycle-aware reconciler (drift repair + attribution instrumentation)
- [x] Remove superseded legacy `BotReconciliationWorker` and its tests
- [x] Retire the dormant Orderly `market-stream` subsystem (market data served over HTTP)
- [x] Consolidate on a single DI container (`service-selector` rollout shim removed)
- [x] Wallet-first onboarding: wallet verification no longer requires exchange credentials

### Near-Term
- [x] Consolidate old/new bot status models in shared package
- [x] Complete command timeout → ERROR/UNKNOWN transition semantics
- [ ] Expand test coverage

### Medium-Term
- [ ] Additional exchange integrations (Uniswap, PancakeSwap, Raydium)
- [ ] Additional chain support (Solana, Arbitrum, Base)
- [ ] Additional trading strategies (Trend Following, Arbitrage)
- [ ] Backtesting framework
- [ ] Analytics dashboard

### Long-Term
- [ ] Horizontal scaling support
- [ ] Advanced risk management features

---

## Architecture Ratings

Per recent architectural review:

| Area | Rating |
|------|--------|
| Monorepo structure | 8/10 |
| Backend architecture | 7.5/10 |
| Frontend architecture | 7.5/10 |
| Backend ↔ Engine protocol | 8/10 |
| Lifecycle model | 8.5/10 |
| Engine reliability | 7/10 |
| Trading execution | 7/10 |
| Failure recovery | 6.5/10 |
| Operational maturity | 6/10 |
| Documentation | 4/10 |
| **Overall** | **~7/10** |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -am 'Add feature'`
4. Push branch: `git push origin feature/your-feature`
5. Open a pull request

### Code Standards
- TypeScript strict mode enabled
- ESLint configuration enforced
- Prettier formatting on commit
- Comprehensive error handling
- Detailed logging for debugging

---

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details

---

## Resources

- **[Kodiak/Orderly Documentation](https://docs.orderly.network/)**
- **[Berachain Documentation](https://docs.berachain.com/)**
- **[TypeScript Documentation](https://www.typescriptlang.org/)**

---

**Status**: In Development | **Version**: 1.0.0 | **Updated**: September 14, 2026
