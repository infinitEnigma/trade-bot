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

| Variable                                                      | Default                                             | Purpose                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `localhost` / `5432` / `trade_bot` / `postgres` / – | PostgreSQL connection                                                                    |
| `REDIS_URL`                                                   | `redis://localhost:6379`                            | Redis connection (the engine uses logical DB 1)                                          |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                            | –                                                   | 32+ chars, required in production                                                        |
| `ENCRYPTION_MASTER_KEY`                                       | –                                                   | 32+ chars; encrypts stored exchange credentials                                          |
| `BOT_ENGINE_API_KEY`                                          | –                                                   | Authenticates engine → backend calls                                                     |
| `KODIAK_API_URL`, `KODIAK_WS_URL`                             | Orderly endpoints                                   | Exchange REST / WebSocket endpoints                                                      |
| `NODE_ENV`, `PORT`, `FRONTEND_URL`, `CORS_ORIGIN`             | `development` / `3000` / `http://localhost:5173`    | Server configuration                                                                     |
| `BOT_COMMAND_TIMEOUT_MS`                                      | `30000`                                             | A delivered command must be confirmed within this window                                 |
| `ENGINE_HEARTBEAT_TIMEOUT_MS`                                 | `30000`                                             | Silence after which an engine is marked `OFFLINE`                                        |
| `LIFECYCLE_RECONCILE_INTERVAL_MS`                             | `60000`                                             | Reconciliation sweep cadence (jittered)                                                  |
| `LIFECYCLE_RECONCILE_STUCK_GRACE_MS`                          | `90000` (3× command timeout)                        | Grace before a stuck transitional state degrades to `UNKNOWN`                            |
| `LIFECYCLE_RECONCILE_MAX_STOP_REISSUES`                       | `3`                                                 | Max automatic `BOT_STOP` re-issues per bot per hour (reconciler + terminal-state repair) |
| `PENDING_RECOVERY_MIN_IDLE_MS`                                | `60000`                                             | Minimum idle time before a pending message is claimed                                    |
| `PENDING_RECOVERY_INTERVAL_MS`                                | `30000`                                             | How often the pending-recovery pass runs                                                 |
| `PENDING_STUCK_ALERT_THRESHOLD_MS`                            | `30000`                                             | Pending entries idle this long count as "stuck"                                          |
| `PENDING_ALERT_THRESHOLD`                                     | `5`                                                 | Stuck-entry count that triggers a backlog warning                                        |
| `PENDING_POISON_MAX_DELIVERIES`                               | `10`                                                | Redeliveries after which a poison entry is alert-and-ACKed (dropped)                     |

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
| `PENDING_POISON_MAX_DELIVERIES`    | `10`                     | Poison-command threshold (alert-and-ACK past it)       |
| `LIGHTER_ENV`                      | `testnet`                | Lighter venue environment (`testnet` or `mainnet`)     |
| `LIGHTER_BASE_URL`                 | venue default            | Lighter REST base URL                                  |
| `LIGHTER_ACCOUNT_INDEX`            | –                        | Venue account index (per user; encrypted at rest)      |
| `LIGHTER_API_KEY_INDEX`            | –                        | Venue API key index (indices 0-1 are reserved)         |
| `LIGHTER_PRIVATE_KEY`              | –                        | API-key private key (memory only, never logged)        |
| `LIGHTER_MARKET_SYMBOL`            | `ETH`                    | Symbol used by the B5 smoke / phase-0 probe            |
| `LIGHTER_SIDECAR_URL`              | `http://127.0.0.1:8790`  | Signer sidecar base URL (`exchange: "lighter"` bots)   |
| `SIDECAR_AUTH_TOKEN`               | –                        | Bearer token required by the sidecar (recommended)     |

---

## 3. Run, build, migrate

```bash
# Install (npm workspaces)
npm install

# Development — all services, or one at a time
npm run dev             # sidecar + backend + frontend + engine (concurrently)
npm run dev:backend     # http://localhost:3000
npm run dev:frontend    # http://localhost:5173
npm run dev:engine

# Database
npm run db:migrate      # apply pending migrations (ledger-tracked)
npm run db:status       # compare the migration ledger with the files on disk
npm run db:seed         # seed baseline data (optional)

# Production
npm run build           # builds shared → frontend → engine → backend
npm run prod:all        # sidecar + backend (serves built frontend) + engine (concurrently, single host)
npm run prod            # starts the built backend (serves the built frontend)
npm run prod:engine     # starts the built engine (Redis Streams consumer)
npm run prod:sidecar    # the Lighter signer sidecar — required for Lighter traffic
                        # (bootstrap the venv once first: npm run dev:sidecar)
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
| Bot state                 | `GET /api/bot/management/status/:botId` (actual vs. desired state, staleness validation)                                                 |
| Engine liveness           | `engine_registry` (last heartbeat, status); engines go `OFFLINE` after `ENGINE_HEARTBEAT_TIMEOUT_MS`                                     |
| Lifecycle audit           | `bot_lifecycle_events` (transitions, credential issuance, reconciliation markers)                                                        |
| Command tracking          | `bot_commands` (`PENDING` → confirmed, or `TIMED_OUT` with an error code)                                                                |
| Stream backlog            | Warning logs from the pending-insight scan (stuck count, oldest stuck idle, poison ids)                                                  |
| Structured logs           | Winston JSON logs with `correlationId` on every protocol message                                                                         |

**Known gaps (2026-09-26 flow audit).** Full evidence in
[archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md](archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md)
§3 (findings L1–L10, all closed). L1–L4 landed on 2026-09-26 and L5–L7 on
2026-09-28; the bullets below
record where each log signal now stands, and what to trust:

- `/api/auth/*` requests **are** covered by `http-*.log` again (L3), and their
  log lines carry a masked email since L6 — the real address lives in
  `audit_logs` and in the user's own response body.
- Background work (Redis consumer, DB pool, WebSocket handshakes, shutdown)
  shares that same boot-time `correlationId`, so its `operationDuration` counts
  from process start — ignore the field for those lines (L8/L9).
- Response lines carry the `correlationId`/`requestId` captured by
  `httpLogger` itself (L7), so a reply is never attributed to a concurrent
  request — `method` + `url` matching is no longer needed.
- Exchange-account connect / verify / revoke **are** logged now (L4/L5):
  `Exchange account verification started|completed|failed` (with `exchange`,
  `environment`, `durationMs` and a bounded `reason`) plus
  `Exchange account connected|verified`, and for Lighter the verifier's own
  `Lighter credentials verified` / `Lighter verification failed - <step>`
  lines with per-step timings. Credentials and private keys are never part of
  a log line.
- The graceful-shutdown tail (Phases 2–4 plus "completed") is not observable
  today (L10).

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
3. Recover each one explicitly with `POST /api/bot/management/resume { botId }`
   (or the **Resume Bot** button in the UI). The bot re-enters `STARTING` and
   the engine rehydrates it from its own snapshot; the engine still has to
   confirm `RUNNING` before the backend claims it.

> **Do not use `POST /start` to recover a crashed bot.** `/start` takes
> `{ strategyId, exchangeAccountId, notionalAmount }` and no `botId`, so it
> always **inserts a new instance** — you would end up with two live bots on one
> venue account. The backend refuses this at two levels: the one-live-bot-per-
> strategy guard (now counting parked `UNKNOWN`/`ERROR` bots, not just
> `RUNNING`/`STARTING`) and the `bot_instances_one_live_per_strategy` partial
> unique index (migration 018). A 409 from `/start` means "resume this bot
> instead".

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

The same bounded repair covers **terminal drift**: once the authority has
concluded a bot must not trade (`ERROR`/`STOPPED`/`UNKNOWN` — typically a
`COMMAND_TIMEOUT_*` sweep outcome) and a healthy engine still lists it as active,
the timeout sweeper and the heartbeat-inventory reconciler dispatch a `BOT_STOP`
and audit `RECONCILE_STOP_REISSUED` (or `RECONCILE_STOP_REISSUE_FAILED`) with
`source: "terminal-state-drift"`. A timeout is only backend bookkeeping, so this
is what actually stops an orphaned runner from keeping the grid live: when
investigating exposure after an `ERROR`, check `bot_lifecycle_events` for that
event and the engine log for the matching `correlationId`. Mid-lifecycle states
(`RUNNING`/`STARTING`/`STOPPING`) are never second-guessed — there the engine
inventory is simply ahead of the backend.

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

### 5.7 Lighter signer sidecar down

`exchange: "lighter"` bots sign create/cancel transactions through the
stateless `sidecar/lighter-signer` process (`LIGHTER_SIDECAR_URL`). When it
cannot be reached the engine maps that to `UNREACHABLE`: the affected grid
slots **freeze** — no new order is placed and no cancellation is assumed to
have committed — so bringing the sidecar back can never reveal a
double-placed order.

1. Check health: `curl http://127.0.0.1:8790/health` → `{"status":"ok"}`.
2. Restart it: dev stack `npm run dev:sidecar` (included in `npm run dev`),
   or manual per `sidecar/lighter-signer/README.md`. It holds no state and
   no credentials: every request carries its own, and nonces are fetched from
   the venue per transaction, so a restart needs no resynchronisation.
3. Already-resting orders stay resting at the venue while slots are frozen.
   After a long outage, verify open orders at the venue
   (`accountActiveOrders`) before expecting the bots to resume normally.
4. A _refused_ transaction (bad credentials, rejected tx) is not an outage:
   it surfaces as a non-retryable error and the bot goes to `ERROR`. Fix the
   credentials instead of restarting anything.
5. The sidecar is only required for `exchange: "lighter"` traffic: engine
   order signing, Settings connect/verify, and the dashboard portfolio reads
   of a Lighter account (its `auth-token` gates `GET /api/v1/account` /
   `/api/v1/trades`). One shared loopback instance serves all of them — it
   holds no per-account state, so there is never a reason to run more than
   one. Kodiak traffic is unaffected by its absence.

### 5.8 Post-incident checklist

1. Confirm order/fill/position state **at the exchange**.
2. Confirm backend state: `GET /api/bot/management/status/:botId`, then `bot_lifecycle_events`
   and `bot_commands` for the affected `correlationId`.
3. Confirm the engine registry shows exactly one authoritative engine and epoch.
4. Inspect the stream pending list for stuck/poison entries before re-enabling
   trading.
5. Only then restart the bot.

### 5.9 Bot or account data does not appear in the UI (post-C3 checklist)

The panel is the primary surface for these flows again — the L1/L2/L11 mismatches
(frontend calling the pre-`/management` paths, a kodiak-pinned portfolio, and
kodiak-only portfolio endpoints) are all fixed. Reach for the API only when the UI
disagrees with it.

Routes the frontend actually calls (all under `/management`):

| Action | Route                                     | Body / notes                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List   | `GET /api/bot/management/instances`       | one row per bot, carrying its `exchangeAccountId`                                                                                                                                                                                                                                                                                                                                             |
| Start  | `POST /api/bot/management/start`          | `{ strategyId, exchangeAccountId, notionalAmount }` → **202**; account must be owned + `ACTIVE` (else 400/404) and the user VERIFIED (else 403)                                                                                                                                                                                                                                               |
| Stop   | `POST /api/bot/management/stop`           | `{ botId }`                                                                                                                                                                                                                                                                                                                                                                                   |
| Resume | `POST /api/bot/management/resume`         | `{ botId }` → **202**. Re-drives an **existing** bot left in `UNKNOWN`/`ERROR` by a lost engine through `STARTING` so it rehydrates from its own snapshot. Use this — **not** `/start` — to recover a crashed bot: `/start` takes no `botId` and always INSERTS a new instance, which would leave two live bots on one venue account. 409 if the bot cannot be resumed from its current state |
| Panic  | `POST /api/bot/management/emergency-stop` | `{ botId, action? }` → **202**; (M1) real `EMERGENCY_STOP` command — engine stops the runner, cancels the bot’s orders and (unless `action: CANCEL_ALL_ORDERS`) flattens its position; default `FULL_SHUTDOWN`, flatten skipped while another engine bot trades the symbol                                                                                                                    |

Checklist when something is missing:

1. Account exists, belongs to the user, and is ACTIVE:
   `SELECT id, exchange, environment, status, verified_at FROM exchange_accounts WHERE user_id = …`.
2. Bot row and its binding:
   `SELECT id, desired_state, actual_state, exchange_account_id FROM bot_instances WHERE user_id = …`.
   A UI showing "no bots" is **never** evidence that none exist — this query decides.
3. The portfolio cards follow the Dashboard's account picker, which offers every
   ACTIVE account of either venue; the balance/positions/trades reads carry
   `?exchangeAccountId=`. A failed balance read (e.g. signer sidecar down,
   venue-side wiped account) renders "Balance unavailable" with the server's
   reason (L15 fixed 2026-09-29 — error channel `getKodiakBalance` →
   `globalBalanceManager` → `useBalance` → UI), never $0/stale; positions
   and trades carry their own error state.
4. A bot cannot exist without an ACTIVE account: `exchange_account_id` has been
   `NOT NULL` since migration `014`, and an account with _live_ bots bound
   (`actual_state` STARTING/RUNNING/STOPPING) cannot be revoked —
   `DELETE /api/accounts/:id` answers **409** with `boundBots`. Terminal
   history (STOPPED/ERROR/UNKNOWN) is cleared as part of the revoke and
   never blocks it, so a venue-side wipe (Lighter testnet reset) no longer
   deadlocks the disconnect; `DELETE /api/bot/management/instances/:botId`
   clears single terminal rows without deleting the strategy.
5. One active bot per strategy is enforced (a second start while the first is
   STARTING/RUNNING returns 409). Stop the first bot, or start a bot for a
   different strategy, before switching accounts.
6. A strategy badge ("Active"/"Inactive") mirrors bot lifecycle: it is flipped when
   a start/stop is dispatched and when the engine reports `RUNNING`/`STOPPED`/`ERROR`
   (`strategies.active`). A stale badge next to a live bot means the best-effort
   badge sync failed — check `bot_lifecycle_events` (and the logs for "Failed to
   sync strategy active flag") before assuming the bot is dead.

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

- Build with `npm run build`. On a single host, start everything with
  `npm run prod:all` (sidecar + backend serving the built frontend from
  `frontend/dist` + engine, as concurrently siblings).
- For independent deploys, `npm run prod` / `npm run prod:engine` /
  `npm run prod:sidecar` still work standalone — supervise the engine
  separately so a backend deploy cannot interrupt strategy execution.
- Give the engine a stable `ENGINE_STATE_FILE`: identity and epoch persistence is
  what lets the backend reject events from superseded processes.
- Give the engine a persistent `GRID_SNAPSHOT_DIR`; today the snapshots are the
  only record of grid slot state.
- Node 24 LTS on every host (`.nvmrc`).
