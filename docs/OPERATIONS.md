# Operations

**How to run, observe, and recover the platform.**

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together and
[PROJECT_REVIEW_GAP_ANALYSIS.md](PROJECT_REVIEW_GAP_ANALYSIS.md) for the known
gaps referenced by the runbooks below.

---

## 1. Prerequisites

| Requirement   | Version                                  | Notes                                                                                                       |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Node.js       | ≥ 24.15.0 (`.nvmrc` pins `24.21.0`)      | npm workspaces monorepo (`frontend`, `backend`, `engine`, `shared`)                                         |
| PostgreSQL    | 14+                                      | Migrations in `database/migrations/`, run by `scripts/run-migrations.js` (ledger-tracked)                   |
| Redis         | 5.0+                                     | 6.2+ preferred: `XAUTOCLAIM` is used when available, with an `XPENDING`/`XCLAIM` fallback for older servers |
| Exchange keys | Orderly/Kodiak API key pair + account id | Stored encrypted by the backend; never used by the frontend                                                 |

---

## 2. Environment

Copy `.env.example` to `.env` at the repository root and fill it in; the backend
and the engine both read it.

### Backend / shared

| Variable                                                      | Default                                             | Purpose                                                  |
| ------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `localhost` / `5432` / `trade_bot` / `postgres` / – | PostgreSQL connection                                    |
| `REDIS_URL`                                                   | `redis://localhost:6379`                            | Redis connection (the engine uses logical DB 1)          |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                            | –                                                   | 32+ chars, required in production                        |
| `ENCRYPTION_MASTER_KEY`                                       | –                                                   | 32+ chars; encrypts stored exchange credentials          |
| `BOT_ENGINE_API_KEY`                                          | –                                                   | Authenticates engine → backend calls                     |
| `KODIAK_API_URL`, `KODIAK_WS_URL`                             | Orderly endpoints                                   | Exchange REST / WebSocket endpoints                      |
| `NODE_ENV`, `PORT`, `FRONTEND_URL`, `CORS_ORIGIN`             | `development` / `3000` / `http://localhost:5173`    | Server configuration                                     |
| `BOT_COMMAND_TIMEOUT_MS`                                      | `30000`                                             | A delivered command must be confirmed within this window |
| `ENGINE_HEARTBEAT_TIMEOUT_MS`                                 | `30000`                                             | Silence after which an engine is marked `OFFLINE`        |
| `PENDING_RECOVERY_MIN_IDLE_MS`                                | `60000`                                             | Minimum idle time before a pending message is claimed    |
| `PENDING_RECOVERY_INTERVAL_MS`                                | `30000`                                             | How often the pending-recovery pass runs                 |
| `PENDING_STUCK_ALERT_THRESHOLD_MS`                            | `30000`                                             | Pending entries idle this long count as "stuck"          |
| `PENDING_ALERT_THRESHOLD`                                     | `5`                                                 | Stuck-entry count that triggers a backlog warning        |
| `PENDING_POISON_MAX_DELIVERIES`                               | `10`                                                | Redelivery count treated as a poison message             |

### Engine

| Variable                           | Default                  | Purpose                                                |
| ---------------------------------- | ------------------------ | ------------------------------------------------------ |
| `BACKEND_URL`                      | `http://localhost:3000`  | Backend base URL (credential endpoint)                 |
| `REDIS_URL`                        | `redis://localhost:6379` | Command stream + dedup markers                         |
| `ENGINE_ID`                        | auto-generated           | Persistent engine identity written to the state file   |
| `ENGINE_STATE_FILE`                | `./.engine-state.json`   | Identity + epoch persistence (epoch bumps per restart) |
| `GRID_SNAPSHOT_DIR`                | `<cwd>/.grid-snapshots`  | Per-bot grid slot snapshots                            |
| `ENGINE_HEARTBEAT_INTERVAL_MS`     | `10000`                  | `ENGINE_HEARTBEAT` cadence                             |
| `PENDING_RECOVERY_MIN_IDLE_MS`     | `60000`                  | Command-side pending recovery threshold                |
| `PENDING_STUCK_ALERT_THRESHOLD_MS` | `30000`                  | Stuck-command alert threshold                          |
| `PENDING_POISON_MAX_DELIVERIES`    | `10`                     | Poison-command threshold                               |

---

## 3. Run, build, migrate

```bash
# Install (npm workspaces)
npm install

# Development — all services, or one at a time
npm run dev             # backend + frontend + engine (concurrently)
npm run dev:backend     # http://localhost:3000
npm run dev:frontend    # http://localhost:5173
npm run dev:engine

# Database
npm run db:migrate      # apply pending migrations (ledger-tracked)
npm run db:status       # compare the migration ledger with the files on disk
npm run db:seed         # seed baseline data (optional)

# Production
npm run build           # builds shared → frontend → engine → backend
npm run prod            # starts the built backend (serves the built frontend)
```

`db:validate` (backend workspace) checks that runtime query validation still
matches the schema. `db:reset` drops and re-runs migrations — **destructive**,
development only.

---

## 4. Observability

| Signal                    | Where                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Service health            | `GET /api/system/health` (includes `controlPlane` for the Redis control bus)                                                             |
| External traffic counters | `GET /api/system/metrics` → `external_traffic` (exchange requests, cache hits/misses, 429s, WebSocket connections, market subscriptions) |
| Bot state                 | `GET /api/bot/status/:botId` (actual vs. desired state, staleness validation)                                                            |
| Engine liveness           | `engine_registry` (last heartbeat, status); engines go `OFFLINE` after `ENGINE_HEARTBEAT_TIMEOUT_MS`                                     |
| Lifecycle audit           | `bot_lifecycle_events` (transitions, credential issuance, reconciliation markers)                                                        |
| Command tracking          | `bot_commands` (`PENDING` → confirmed, or `TIMED_OUT` with an error code)                                                                |
| Stream backlog            | Warning logs from the pending-insight scan (stuck count, oldest stuck idle, poison ids)                                                  |
| Structured logs           | Winston JSON logs with `correlationId` on every protocol message                                                                         |

---

## 5. Runbooks

### 5.1 Redis unavailable

Trading endpoints that need the control plane return **503** instead of
pretending to succeed; bot state in PostgreSQL is left untouched. Restore Redis
and re-issue the request. Never mutate bot state directly in the database.

### 5.2 Engine process down or silent

The registry marks the engine `OFFLINE` after the heartbeat timeout and moves
`RUNNING` bots to `UNKNOWN`. Recovery:

1. Restart the engine. It re-registers with a new epoch; events from the old
   epoch are ignored.
2. Bots reporting `ERROR`/`UNKNOWN` while `desired=RUNNING` are audited as
   `RECONCILE_NEEDS_USER_ACTION` — the system **never auto-starts** them.
   Restarting a bot is an explicit user/operator action.

### 5.3 Bot stuck in `STARTING` or `STOPPING`

The reconciliation sweep degrades a transitional state stuck longer than
3× `BOT_COMMAND_TIMEOUT_MS` with no pending command to `UNKNOWN` via
compare-and-set, and records a `RECONCILE_MARKED_UNKNOWN` audit event.
Investigate the engine log for the matching `correlationId` before retrying.

### 5.4 Duplicate or stuck stop

`desired=STOPPED` while the engine still reports the bot active triggers a
bounded `BOT_STOP` re-issue (max 3 per bot per hour, tracked as pending so the
timeout sweeper keeps supervising it). Once the budget is exhausted the bot is
degraded to `UNKNOWN` for operator attention instead of looping forever.

### 5.5 Engine restart and grid state

On start, each bot restores its grid from `$GRID_SNAPSHOT_DIR/<botId>.json` when
the snapshot version, symbol, grid size, and grid range all match the current
config; otherwise the grid is rebuilt around the current price.

> **Known gap.** Snapshot writes are not atomic yet (no temp file + fsync +
> rename), a corrupt or missing snapshot silently falls back to a fresh grid, and
> there is no startup cross-check against the exchange's open orders. Until that
> lands, treat the snapshot as a **cache, not a ledger**: after any unclean engine
> restart, stop the bot, reconcile open orders at the exchange, then restart it.

### 5.6 Graceful shutdown

`SIGTERM`/`SIGINT` make the engine cancel each bot's resting orders before
publishing `STOPPED`. Cancellation errors are currently swallowed, so a
`STOPPED` report is not proof that no orders remain — verify at the exchange
after an unclean stop (findings N3/N5 in the gap analysis).

### 5.7 Post-incident checklist

1. Confirm order/fill/position state **at the exchange**.
2. Confirm backend state: `GET /api/bot/status/:botId`, then `bot_lifecycle_events`
   and `bot_commands` for the affected `correlationId`.
3. Confirm the engine registry shows exactly one authoritative engine and epoch.
4. Inspect the stream pending list for stuck/poison entries before re-enabling
   trading.
5. Only then restart the bot.

---

## 6. Test and gate commands

All four gates must pass before every commit (see
[CONTRIBUTING.md](../CONTRIBUTING.md)):

```bash
npm run format:check    # Prettier
npm run lint            # ESLint — 0 errors / 0 warnings
npm run build           # tsc + vite
CI=true npm test        # Jest (backend, engine) + Vitest (frontend)
```

Coverage and per-workspace runs:

```bash
cd backend  && npx jest --coverage
cd engine   && npx jest --coverage
cd frontend && npx vitest run --coverage
```

The backend integration suite needs PostgreSQL and Redis reachable via `.env`.
`CI=true` (or a non-TTY shell) is required so Vitest does not start in watch
mode.

---

## 7. Deployment

- Build with `npm run build`, start with `npm run prod` (the backend serves the
  built frontend from `frontend/dist`).
- The engine is a separate process — deploy and supervise it independently so a
  backend deploy cannot interrupt strategy execution.
- Give the engine a stable `ENGINE_STATE_FILE`: identity and epoch persistence is
  what lets the backend reject events from superseded processes.
- Give the engine a persistent `GRID_SNAPSHOT_DIR`; today the snapshots are the
  only record of grid slot state.
- Node 24 LTS on every host (`.nvmrc`).
