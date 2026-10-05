# Trade Bot

**Automated Trading Platform**

[![License: Apache](https://img.shields.io/badge/License-Apache-yellow.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D24.15.0-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](tsconfig.json)

---

## Overview

Trade Bot is a **full-stack, chain-agnostic automated trading platform** for executing desired trading strategies. It uses a distributed architecture with a React frontend, Node.js Express backend, and an independent trading engine coordinated via Redis Streams.

| Component            | Technology                               | Status         | Documentation                          |
| -------------------- | ---------------------------------------- | -------------- | -------------------------------------- |
| **Network**          | Multi-chain (EVM, Solana)                | ✅ Extensible  | -                                      |
| **Exchange**         | Multi-exchange (Kodiak/Orderly, Lighter) | ✅ Extensible  | -                                      |
| **Frontend**         | React 19 + Vite + Tailwind CSS           | ✅ Functional  | [📖 Frontend Docs](frontend/README.md) |
| **Backend**          | Express.js + PostgreSQL + Redis          | ✅ Functional  | [📖 Backend Docs](backend/README.md)   |
| **Trading Engine**   | TypeScript (Node.js)                     | ✅ Functional¹ | [📖 Engine Docs](engine/README.md)     |
| **Shared Contracts** | TypeScript types                         | ✅ Functional  | -                                      |

¹ Engine: the full grid trading path — slot reconciliation → delta-only fill
booking → durable ledger rows, per-fill partial accounting (`PARTIALLY_FILLED`
segments), restart-safe quantity snapshots — is implemented and unit-tested.
The only remaining gate is the live Gate-4 run-2 _venue_ proof.

> **Maturity Assessment (2026-10-04)**: The architecture is a chain- and
> exchange-agnostic distributed platform with a working control plane. The
> Backend ↔ Engine protocol (Redis Streams, separated desired/actual lifecycle
> state, manual ACK, correlation IDs, engine epochs, heartbeats, poison-message
> detection) and the durable fill ledger (`ORDER_INTENT` + `TRADE_EXECUTED`
> events → idempotent `bot_trade_fills` rows) are the most mature subsystems.
> The toolchain is clean: `npm audit --omit=dev` reports **0 vulnerabilities**
> in the production tree (the `moment` path-traversal advisory was cleared on
> 2026-10-05; the remaining advisories are dev-only and have no upstream patch
> yet — see [Test and gate commands](docs/OPERATIONS.md#6-test-and-gate-commands)),
> lint is **0 errors / 0 warnings**, and the suites report **~3,000 passing tests**
> (backend ~2,540, engine ~285, frontend ~206). The Lighter smoke test is
> **env-gated**: it skips without credentials, but wherever `.env` is populated
> it runs as a *live testnet* test — it needs the signing sidecar and is
> load-sensitive, so re-run it in isolation before treating a failure as a
> regression. Details and the one remaining live-test gate are tracked in the
> [Project Review & Gap Analysis](docs/PROJECT_REVIEW_GAP_ANALYSIS.md).

---

## User Access Tiers

Users progress through three access levels. Progression is enforced server-side and reflected in the authenticated session profile.

| Level          | How it is reached                                                                                  | Access                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **BASIC**      | Email + password registration and login (no email verification)                                    | Public-source market data (prices, charts) and general dashboard pages         |
| **REGISTERED** | Connect a wallet on the Dashboard and sign the welcome message (ownership verified by the backend) | Wallet-linked features; exchange credential setup (Settings) becomes available |
| **VERIFIED**   | Add an exchange account (Kodiak or Lighter) in Settings and have it live-verified by the backend   | Trading strategies, bot configuration, exchange-specific and private data      |

```
BASIC ──connect wallet + sign message──▶ REGISTERED ──verify exchange keys──▶ VERIFIED
```

- Wallet signatures are verified server-side (`POST /api/wallets/verify`; `POST /api/user/verify-wallet` is kept as a compat alias). Linked wallets live in the chain-aware `wallets` table (migration `012_wallets_exchange_accounts.sql`), independently of `exchange_accounts`.
- Unlinking a wallet (`POST /api/wallets/:id/unlink`; `POST /api/user/unlink-wallet` is kept as a compat alias) is an explicit, audited action that downgrades the account: `VERIFIED → REGISTERED`, `REGISTERED → BASIC`. Disconnecting the browser wallet session alone does **not** change the account level.
- BASIC users receive data from public sources only; REGISTERED and VERIFIED users additionally receive exchange-specific and private data.

---

## Quick Start

### Prerequisites

- Node.js ≥ 24.15.0 (LTS "Krypton" line; see `.nvmrc`)
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

# Run database migrations (ledger-tracked runner)
npm run db:migrate

# Check migration status (ledger vs. files)
npm run db:status

# Seed baseline data (optional)
npm run db:seed

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
npm run prod           # Start the production backend (serves the built frontend)
```

---

## Architecture

### Distributed System Design

The platform uses a distributed architecture where the Backend and Engine are independent processes coordinated via Redis Streams. Bots bind to a single `exchange_accounts` row (C3a); the engine fetches that account's credentials out-of-band and trades only that venue account (Kodiak/Orderly, Lighter) — never shared keys:

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
                    │ Lighter     │  Orderly/Kodiak                  │
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
│       │   ├── strategies/    # Strategy management + engine process supervision + trade ledger (`bot_trade_fills`)
│       │   ├── user/          # User profiles & Kodiak credentials
│       │   └── wallet/        # Balance management
│       ├── interfaces/        # HTTP routes, middleware, WebSocket
│       ├── infrastructure/    # Redis, PostgreSQL, security, external APIs
│       └── workers/           # Background processing
├── engine/                    # Exchange-agnostic trading engine
│   └── src/
│       ├── index.ts           # Entry point (bootstrap only)
│       ├── application/       # BotManager, StrategyRunner (tick loop), lifecycle coordinator + order manager/reconciliation, ledger reports
│       ├── protocol/          # Command consumer, event publisher, credential fetcher
│       ├── domain/            # Bot runtime, engine identity, exchange interface, grid snapshot
│       ├── exchanges/         # Exchange integrations (pluggable)
│       │   └── kodiak/        # Kodiak/Orderly (first exchange)
│       │   └── lighter/       # Lighter (signing via the sidecar signer)
│       ├── strategies/        # Grid trading strategy (per-fill partial accounting, quantity snapshots)
│       ├── infrastructure/    # Redis Streams client + grid snapshot persistence
│       ├── types/             # Strategy type definitions
│       └── utils/             # Logging utility
├── shared/                    # Cross-package TypeScript contracts
│   └── src/
│       ├── protocol/          # Bot lifecycle protocol types
│       │   ├── bot-state.ts   # State machine & transitions
│       │   ├── bot-command.ts # Command types & envelope
│       │   ├── bot-event.ts   # Event types + ledger payloads (fill_id, segments)
│       │   └── engine-lifecycle.ts # Engine registration & heartbeat
│       └── types/             # Domain models, infrastructure contracts
├── database/                  # PostgreSQL migrations
├── docs/                      # Durable docs (architecture, operations, review tracker)
│   ├── archived/              # Untracked historical material
│   └── instructions/          # Untracked internal AI guides
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

# Database
npm run db:migrate      # Apply pending migrations (ledger-tracked)
npm run db:status       # Compare migration ledger vs. files
npm run db:seed         # Seed baseline data

# Testing
npm run test            # Full test suite (use CI=true in a TTY) — run when IDLE

# Linting & Formatting
npm run lint            # Lint all packages (0 errors, 0 warnings)
npm run lint:fix        # Fix lint issues
npm run format          # Format all packages
npm run format:check    # Verify formatting without writing
```

> **Run the suite on an idle machine.** `npm test` runs three suites
> back-to-back and Jest fans out one worker per core, so the run competes with
> any running stack for CPU, memory and the shared PostgreSQL/Redis. On an
> otherwise idle host it is clean; on a loaded one — **especially older or
> low-core hardware** — you can see suites that *fail to run* (worker OOM,
> "Jest did not exit cleanly", TS/import errors) or timeouts on tests that
> normally finish in milliseconds. Those are load artifacts, not regressions:
> let the machine settle and re-run, or re-run a single workspace
> (`cd backend && npx jest <path>`).
>
> **The Lighter smoke test is a live testnet test.**
> `engine/src/exchanges/lighter/__tests__/smoke.test.ts` is **env-gated** — it
> skips when `LIGHTER_ACCOUNT_INDEX` / `LIGHTER_API_KEY_INDEX` /
> `LIGHTER_PRIVATE_KEY` / `LIGHTER_SIDECAR_URL` are unset, but wherever `.env`
> is populated it **runs for real**: places a resting order, queries it by
> client index, then cancels it through the signing sidecar (120 s timeout).
> It is the suite most sensitive to load, network latency, sidecar reachability
> and testnet rate limits, so a single red run — particularly during a full
> suite run — is most often a flake. Re-run it alone before treating it as a
> regression: `cd engine && npx jest src/exchanges/lighter/__tests__/smoke.test.ts`.
>
> Full detail in
> [docs/OPERATIONS.md §6 — Test and gate commands](docs/OPERATIONS.md#6-test-and-gate-commands).

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

## Documentation

| Document                                                                                                                 | Answers                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                                                             | How does it work? — topology, control plane, lifecycle model, engine layers, data ownership |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)                                                                                 | How do we run and recover it? — environment, runbooks, observability, test gates            |
| [docs/PROJECT_REVIEW_GAP_ANALYSIS.md](docs/PROJECT_REVIEW_GAP_ANALYSIS.md)                                               | How did we get here / what remains? — review verification, findings, remediation ledger     |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md)                                                                                 | How are users, wallets and exchange accounts modelled? — target model + migration plan      |
| [docs/EXCHANGE_INTEGRATION_PLAN.md](docs/EXCHANGE_INTEGRATION_PLAN.md)                                                   | What are we building next, in what order? — credential contract, Lighter adapter, DB stages |
| [backend/README.md](backend/README.md) · [engine/README.md](engine/README.md) · [frontend/README.md](frontend/README.md) | Workspace-specific guides                                                                   |

`docs/archived/` (historical review material, kept for reference) and
`docs/instructions/` (internal AI working guides) are intentionally untracked.

---

## Test Coverage

Fresh totals (2026-10-04, full-suite runs): **backend ~2,540 tests**
(excluding DB-gated suites), **engine 285 tests**, **frontend 206 tests** —
a live-gated Lighter smoke test that needs the signing sidecar is excluded
from the engine count for local runs. The coverage snapshot below is from
2026-09 and is kept for shape comparison only; percentages are stale and will
be refreshed with the next coverage pass (see Roadmap):

| Workspace         | Suites | Tests | Statements | Branch | Functions | Lines |
| ----------------- | ------ | ----- | ---------- | ------ | --------- | ----- |
| Backend (Jest)    | 120    | 2,371 | 85.0%      | 67.3%  | 86.8%     | 85.2% |
| Engine (Jest)     | 3      | 19    | 74.4%      | 59.8%  | 84.8%     | 75.8% |
| Frontend (Vitest) | 16     | 177   | 61.6%      | 50.7%  | 60.9%     | 62.0% |

Regenerate locally:

```sh
cd backend  && npx jest --coverage        # report in backend/coverage/
cd engine   && npx jest --coverage        # report in engine/coverage/
cd frontend && npx vitest run --coverage   # report in frontend/coverage/
```

Weakest areas in the 2026-09 snapshot were the frontend components/hooks
layer (61.6%) — expanding component and hook tests is the top coverage
priority (see Roadmap). A coverage _percentage_ refresh is also due: the
totals above grew substantially since September (engine grid/reconciliation
suites, backend ledger suites), so the next coverage pass should regenerate
the table rather than reuse it.

---

## Roadmap

### Near-Term

- [x] Harden the engine trading path — exchange↔local order reconciliation
      (`OrderReconciliationService` + `OrderManager`), atomic checksummed
      snapshot persistence with quantity fields, durable trade ledger
      (`ORDER_INTENT` → `TRADE_EXECUTED` → `bot_trade_fills`), per-fill
      partial accounting (see
      [Project Review & Gap Analysis](docs/PROJECT_REVIEW_GAP_ANALYSIS.md))
- [ ] Live venue proof (Gate-4 run 2): engine-path partial fills on Lighter
      testnet through the grid, incl. redelivery + restart row-collapse —
      code is ready, the gate needs a live run
- [ ] Refresh the coverage table above (percentages are from 2026-09)

### Medium-Term

- [ ] Additional exchange integrations (Uniswap, PancakeSwap, Raydium)
- [ ] Additional chain support (Solana, Arbitrum, Base)
- [ ] Additional trading strategies (Trend Following, Arbitrage)
- [ ] Backtesting framework
- [ ] Analytics dashboard

### Long-Term

- [ ] Horizontal scaling support
- [ ] Advanced risk management features
