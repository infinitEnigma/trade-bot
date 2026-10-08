# Trade Bot

**Automated Trading Platform** — connect a wallet, link exchange API keys, configure a grid strategy, and let a durable, reconciled engine trade it while you watch (and intervene) from the browser.

[![CI](https://github.com/infinitEnigma/trade-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/infinitEnigma/trade-bot/actions/workflows/ci.yml)
[![License: Apache](https://img.shields.io/badge/License-Apache-yellow.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D24.15.0-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](backend/tsconfig.json)

---

## What it does

Trade Bot is a **full-stack, chain- and exchange-agnostic automated trading platform**. A user signs up, verifies an exchange account, and configures a strategy (today: grid trading with per-fill partial-fill accounting). From then on the system runs the loop autonomously — with the safety rails a real trading system needs:

- **Desired vs. actual state, kept honest.** You say *start* or *stop*; the backend and an independent trading engine negotiate over Redis Streams (ACKs, correlation IDs, heartbeats, poison-message detection) until reality matches intent — or the system fails loudly and recovers.
- **Crash recovery without duplicates.** If the engine dies, bots park in `UNKNOWN` and surface as *"Action required"* in the UI. **Resume** re-drives the **same** bot from its durable snapshot — no duplicate bots, no re-applied trades. A DB-level unique index enforces one live bot per strategy.
- **A durable financial ledger.** Order intent and fills are persisted before/while they happen (`bot_trade_fills`, idempotent, reconciled against the venue), so PnL, fees, and positions survive restarts and reconcile to the row.
- **Reconciliation over trust.** On every restart the engine cross-checks the exchange for orphans, partial fills, and drift instead of assuming its snapshot is truth.

### Architecture at a glance

| Component            | Technology                               | Status        | Documentation                          |
| -------------------- | ---------------------------------------- | ------------- | -------------------------------------- |
| **Network**          | Multi-chain (EVM, Solana)                | ✅ Extensible | -                                      |
| **Exchange**         | Multi-exchange (Kodiak/Orderly, Lighter) | ✅ Extensible | -                                      |
| **Frontend**         | React 19 + Vite + Tailwind CSS           | ✅ Functional | [📖 Frontend Docs](frontend/README.md) |
| **Backend**          | Express.js + PostgreSQL + Redis          | ✅ Functional | [📖 Backend Docs](backend/README.md)   |
| **Trading Engine**   | TypeScript (Node.js)                     | ✅ Functional | [📖 Engine Docs](engine/README.md)     |
| **Shared Contracts** | TypeScript types                         | ✅ Functional | -                                      |

The Backend ↔ Engine protocol (Redis Streams, separated desired/actual
lifecycle state, manual ACK, correlation IDs, engine epochs, heartbeats,
poison-message detection) and the durable fill ledger (`ORDER_INTENT` +
`TRADE_EXECUTED` events → idempotent `bot_trade_fills` rows) are the most
mature subsystems. The toolchain is clean: `npm audit --omit=dev` reports
**0 vulnerabilities** in the production tree, lint is **0 errors / 0
warnings**, and the suites report **~3,100 passing tests** (backend 2,559,
engine 310, frontend 223 — see [Test Coverage](#test-coverage)). Open
engineering items are tracked in the
[Project Review & Gap Analysis](docs/PROJECT_REVIEW_GAP_ANALYSIS.md); the one
env-gated caveat (the live Lighter smoke test) is documented in
[Test and gate commands](docs/OPERATIONS.md#6-test-and-gate-commands).

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

> **Two caveats when running tests** (full detail in
> [docs/OPERATIONS.md §6 — Test and gate commands](docs/OPERATIONS.md#6-test-and-gate-commands)):
> run the suite on an **idle machine** (loaded hosts produce load artifacts,
> not regressions), and treat the **env-gated Lighter smoke** — a live
> testnet test — as a flake candidate: re-run it alone
> (`cd engine && npx jest src/exchanges/lighter/__tests__/smoke.test.ts`)
> before calling it a regression.

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

Current totals: **backend 2,559 tests** (2026-10-06), **engine 310 tests**
(2026-10-06, 32 suites, clean exit), **frontend 223 tests** (30 files,
2026-10-07) — **~3,100 tests**, all green under the
[CI gate](.github/workflows/ci.yml) (format → lint → build → test, with
Postgres 14 + Redis service containers).

Notes:

- The frontend total includes the 9-file `src/test/integration/`
  execution-integrity matrix (WS reconnect, login/logout cleanup, WS-vs-REST
  ordering, shared Query cache, `strategy_id` collision, account downgrade,
  delete-during-transition, 401-during-mutation, refresh-during-transition).
- The env-gated Lighter live smoke **self-skips** without credentials or a
  reachable signing sidecar; wherever `.env` is populated it is a *live
  testnet* test — re-run it in isolation before treating a failure as a
  regression (see
  [Test and gate commands](docs/OPERATIONS.md#6-test-and-gate-commands)).

Coverage **percentages** are deliberately not published — the last snapshot
(2026-09) went stale while the suites roughly doubled. Regenerate locally
when a coverage number is needed:

```sh
cd backend  && npx jest --coverage        # report in backend/coverage/
cd engine   && npx jest --coverage        # report in engine/coverage/
cd frontend && npx vitest run --coverage   # report in frontend/coverage/
```

---

## Roadmap

### Near-Term

The authoritative near-term list is the remediation ledger in
[Project Review & Gap Analysis §4/§6](docs/PROJECT_REVIEW_GAP_ANALYSIS.md).
In short:

- [ ] **Failure-injection completion** — the five live gates (Redis restart,
      exchange orphans, crash at more exact points, corrupted/missing
      snapshot, venue unavailable during startup reconciliation) on top of
      the landed deterministic matrix
- [ ] **Browser smoke tests** around `App` wiring (2–4 E2E scenarios)
- [ ] **Residue cleanup** — transient signer `21104` (`strategy_id`
      shim-drop and `kodiak_status` column landed 2026-10-08 via
      migrations `021`/`022`)
- [ ] End-to-end `snapFullyLong` live trigger (the last unproven accounting
      condition)
- [ ] Refresh coverage numbers (regenerate the table above, not percentages
      from memory)

Done: engine trading path hardening (reconciliation, snapshots, durable
ledger, per-fill partial accounting), P0 crash-recovery with live Resume,
CI gate + protected `main`, frontend execution-integrity audit (9
integration tests) — see the gap-analysis archives for the full history.

### Medium-Term

- [ ] Additional exchange integrations (Uniswap, PancakeSwap, Raydium)
- [ ] Additional chain support (Solana, Arbitrum, Base)
- [ ] Additional trading strategies (Trend Following, Arbitrage)
- [ ] Agent participation (read-only per-account keys, approved proposals —
      plan §E)
- [ ] Backtesting framework
- [ ] Analytics dashboard

### Long-Term

- [ ] Price-oracle / public market-data integrations (research in progress)
- [ ] Balance-management model upgrade (wallet vs exchange-account vs
      platform balances; research in progress)
- [ ] UI/UX revisit (pages predate the sessions/resume/per-account work;
      research in progress)
- [ ] Split `@trade-bot/shared`
- [ ] Horizontal scaling support
- [ ] Advanced risk management features

