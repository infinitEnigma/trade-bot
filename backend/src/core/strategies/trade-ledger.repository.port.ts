/**
 * Trade Ledger Repository PORT — the durable financial-state ingest contract
 * (Phase 4 / N7).
 *
 * The write side of the durable financial state: `bot_trade_fills` (the
 * idempotent fill ledger), `bot_order_intents` (intent-before-create),
 * `bot_positions` and `bot_performance_snapshots` (engine-reported
 * projections). All reads for display keep going through the existing
 * `TradeRepositoryAdapter` / portfolio paths — this port is ingest-only.
 *
 * The PostgreSQL implementation lives in
 * `infrastructure/adapters/repositories/trade-ledger-repository.adapter.ts`;
 * core never imports it (dependency inversion — external review P1,
 * 2026-10-15). Wiring happens at startup (index.ts
 * `setTradeLedgerRepository`, beside `setTradeLedgerHandler`), fail-fast when
 * unwired so a missing adapter can never silently drop a fill.
 *
 * Invariants owned by implementers:
 * - `recordFill` is idempotent on
 *   `(bot_id, client_order_id, exchange_order_id, fill_id)`: a redelivered or
 *   replayed event returns DUPLICATE and changes nothing.
 * - `bot_instances.total_trades` / `total_pnl` are incremented by `bot_id`
 *   ONLY in the same transaction as an actual ledger insert, so the totals
 *   reconcile with `SUM(bot_trade_fills.pnl)` (Phase 4 exit criterion). F2:
 *   a fill whose fee/PnL the engine could not source arrives `undefined`,
 *   is stored as NULL (unknown ≠ zero), and is counted in
 *   `total_pnl_incomplete_fills` — `total_pnl` therefore sums only KNOWN
 *   realised PnL and any non-zero counter marks it INCOMPLETE (unknown
 *   direction, never a lower bound: an omitted fill may have been a loss).
 * - The `trades` display row is written in the same transaction, so there is
 *   never a display row without a ledger row (or a double display row from a
 *   replay).
 * - Ownership (`user_id`, plus the run-derived `strategy_id` attribution)
 *   is resolved server-side inside the transaction — never from the event
 *   payload. `strategy_id` comes from the session's oldest run (022
 *   shim-drop), NULL when the session has no runs yet.
 *
 * Persistence failures throw so the event stays unacked and is redelivered;
 * the DB unique key makes that redelivery safe.
 *
 * @format
 */

export type LedgerStatus = "FILLED" | "PARTIAL";

export type RecordFillResult = "INSERTED" | "DUPLICATE" | "UNKNOWN_BOT";

export interface LedgerFill {
  botId: string;
  clientOrderId: string;
  exchangeOrderId: string;
  fillId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  /** Venue fee for this fill. Undefined = unknown → stored NULL (F2). */
  fee?: number;
  /** Fee provenance (F5): true = upper-bound estimate, false = exact venue rate. */
  feeIsEstimate?: boolean;
  /** Realised PnL net of fees. Undefined = unknown → stored NULL (F2). */
  pnl?: number;
  status: LedgerStatus;
  /** ISO-8601 execution time as observed by the engine. */
  executedAt: string;
}

export interface LedgerIntent {
  botId: string;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
}

export interface LedgerPosition {
  botId: string;
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  /** Realised PnL net of fees (sums to `bot_trade_fills.pnl`, N6). */
  pnl: number;
  unrealizedPnl?: number;
}

export interface LedgerPerformance {
  botId: string;
  totalTrades: number;
  totalPnl: number;
  winRate?: number;
  maxDrawdown?: number;
  profitFactor?: number;
  sharpeRatio?: number;
}

export interface ITradeLedgerRepository {
  /**
   * Idempotently append one fill to the ledger in one transaction:
   * resolve identity → ledger insert (ON CONFLICT DO NOTHING) → display row →
   * intent state → bot totals. DUPLICATE short-circuits after the conflict,
   * so no side effect runs twice.
   */
  recordFill(fill: LedgerFill): Promise<RecordFillResult>;
  /** Upsert order intent (written BEFORE `createOrder`). */
  upsertIntent(intent: LedgerIntent): Promise<boolean>;
  /** Upsert the engine-reported position for (bot_id, symbol). */
  upsertPosition(position: LedgerPosition): Promise<boolean>;
  /** Upsert the latest engine-reported performance counters (telemetry). */
  upsertPerformance(perf: LedgerPerformance): Promise<boolean>;
}
