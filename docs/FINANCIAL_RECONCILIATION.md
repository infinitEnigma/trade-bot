# Financial-plane reconciliation contract

**Status: authoritative (2026-10-11).** This document fixes which source owns
which financial figure, and the rules that keep them reconcilable. It is the
reference implementation of remediation item 5 of the financial-plane review
(F1–F5 findings).

## Sources of truth

| Figure | Authoritative source | Never derived from |
| --- | --- | --- |
| Bot fills (qty, price, fee, realised PnL per fill) | `bot_trade_fills` (PostgreSQL) | engine logs, snapshots, `trades` display rows |
| Bot totals (`total_trades`, `total_pnl`) | `bot_instances`, written transactionally with the fill insert | `bot_performance_snapshots` (telemetry), engine counters |
| Order intent (pre-create record) | `bot_order_intents` | — |
| Bot open position (engine view) | `bot_positions` projection (latest-per-key) | — |
| Account equity / balances (live) | venue APIs via `/api/market/*` | the ledger (fills ≠ balances) |
| Account realised PnL (display) | venue `trade_pnl` series (`/api/market/pnl`), Kodiak native `realized_pnl` rows | synthetic equity curves |
| Engine counters (`totalPnl`, win rate …) | engine memory — **telemetry**, resets on restart | anything durable |

## Invariants

1. **Intent before create.** `ORDER_INTENT` is published (durable in the
   stream + `bot_order_intents`) before `createOrder`; a publish failure
   fails the placement (fail-closed).
2. **Fill delivery is durable (F1).** Every detected fill is journaled to
   the engine-side pending-fill outbox (`$GRID_SNAPSHOT_DIR/pending-fills.json`)
   *before* the `TRADE_EXECUTED` publish and cleared only after the stream
   accepts it. A journal-write failure REJECTS the fill (fail-closed — the
   caller sees an explicit gap, never a log-only loss). Replay runs at engine
   startup, at bot-session start, and on a 30s periodic loop
   (`PENDING_FILL_RETRY_INTERVAL_MS`); the heartbeat carries `pendingFills`
   and `pendingFillsUnknown` (with a per-process `heartbeatSeq`) so the backend
   can alert on a journal that never drains. A session start
   with `remaining > 0` aborts (INIT_FAILED, retryable) — a session never
   trades behind undelivered fills. The backend's unique
   `(bot_id, client_order_id, exchange_order_id, fill_id)` key keeps replay
   idempotent. Corruption path: malformed rows are quarantined
   (`pending-fills.json.corrupt-*`) and `.prev` is consulted even when the
   primary is missing, so the only copy of a fill is never silently dropped.
   **Integrity alerting (F4).** The backend persists the signal on
   `engine_registry` and raises a **sticky** `journal_integrity_alert` on
   `UNKNOWN`, surfaced on `GET /api/bot/engine/status` (`journalIntegrity` =
   live `OK`/`UNKNOWN`/`UNVERIFIED`; `journalIntegrityAlert` = unresolved
   action) and as a UI banner. Writes are ordered by the composite
   `(epoch, heartbeatSeq)` so a stale/redelivered heartbeat cannot overwrite a
   newer signal, and the alert is **cleared only by an admin,
   reconciliation-attested recovery** (`POST /management/engine/journal/recover`,
   which requires the engine to be `OK` and `pending_fills = 0`, checked
   atomically with the clear) — never by a later healthy heartbeat. "Verified
   recovery" = an operator reconciled the fills from venue history (recorded as
   `journal_recovery_ref`) AND the engine currently reports healthy and drained.
   Runbook: `docs/OPERATIONS.md` §5.8.
3. **Unknown ≠ zero (F2).** The engine omits `fee`/`pnl` when the venue rate
   could not be sourced; the backend stores NULL (never a flattened 0).
   `bot_instances.total_pnl` sums only KNOWN fill PnL;
   `total_pnl_incomplete_fills` counts fills booked with unknown PnL — a
   non-zero counter marks `total_pnl` as INCOMPLETE with unknown direction
   (an omitted fill may have been a loss), never a lower bound or net PnL.
   Any surface rendering `total_pnl` must surface the counter when non-zero.
   *(Known limitation: pre-023 rows already collapsed unknowns to 0 and
   cannot be repaired retroactively.)*
4. **Fee provenance travels (F5).** `feeIsEstimate` rides the event contract
   (`TradeExecutedEventPayload`) from `ExchangeFeeRates.exact`/maker-vs-taker
   to `bot_trade_fills.fee_is_estimate`. `true` = upper-bound estimate
   (taker rate, unmapped tier, unapplied discount); `false` = exact venue
   rate. Absent provenance defaults to estimate (conservative). The grid's
   deliberate use of `takerRate` (the venue never reports liquidity role) is
   documented in `EXCHANGE_INTEGRATION_PLAN.md` N6a.
5. **Aggregates fail loudly (F3).** The portfolio total is a sum of readable
   accounts only when it can be — an unreadable account makes the result
   `totalIsPartial` with `failedAccounts` named and trips the hook error.
   A failed read is never folded into a silent $0. A resolved response with
   a missing or non-numeric `totalBalance` counts as unreadable (P2) — only
   a finite numeric balance marks an account readable, so a legitimate zero
   and "unavailable" stay distinct.
6. **No fabricated equity (F4).** Trade-derived curves plot cumulative
   realised PnL anchored at 0 unless the caller supplies a real equity
   baseline; venue `realized_pnl` is the only per-row input (rows without it
   are skipped, never `(close − open) × qty`); no non-negative clamp. The
   chart is labelled "Cumulative realized PnL", never "Equity" — no verified
   equity baseline is constructed on the Dashboard.

## Reconciliation procedure (ledger ↔ venue)

Run after any incident involving Redis/PostgreSQL downtime, and as part of
the live gates:

1. **Fills vs venue history.** For each RUNNING bot, compare
   `SELECT count(*), sum(quantity) FROM bot_trade_fills WHERE bot_id = $1`
   against the venue's fill/order history for the session's client-order-id
   prefix (G1 ids are deterministic). Missing rows → the journal
   (`pending-fills.json`) first, then the engine logs.
2. **Totals vs ledger.** `bot_instances.total_pnl` must equal
   `SELECT COALESCE(sum(pnl),0) FROM bot_trade_fills WHERE bot_id = $1
   AND pnl IS NOT NULL` and
   `total_pnl_incomplete_fills` must equal the count of `pnl IS NULL` rows.
   `total_trades` must equal the ledger row count.
3. **Positions vs venue.** `bot_positions.quantity` (per symbol) vs the
   venue positions endpoint; drift means either a lost `POSITION_UPDATED`
   (telemetry — self-heals on the next report) or a lost fill (durable —
   see step 1).
4. **Display vs ledger.** Legacy `trades` rows are written in the same
   transaction as the ledger row; any `trades` row without a
   `bot_trade_fills` sibling (matched on bot/order/fill identity) is a
   defect.

## Fallbacks that must stay honest

- `dashboardService.getPositions()/getTrades()` return `[]` on error —
  **known gap**: consumers cannot distinguish "no positions" from "venue
  unreadable". The portfolio strip paths (F3) do not use these; the
  dashboard tables do. Until fixed, treat an empty dashboard table on an
  account that should be trading as suspicious.
- `kodiakApi` portfolio endpoints map some venue failures to empty rows at
  the adapter layer (documented in `PROJECT_REVIEW_GAP_ANALYSIS` L-series).
  The balance channel throws (L15); positions/trades channels are the
  remaining soft-failure surface.
