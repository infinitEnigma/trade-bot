/**
 * Engine Ledger Events - Engine → Backend (via Redis Streams)
 *
 * The durable financial-state event family (Phase 4 / gap doc §4, finding N7):
 * the engine is the only component that talks to the exchange, so every
 * order/fill/position fact reaches PostgreSQL through these events — there is
 * deliberately no HTTP trade-write path (`POST /report-trade` was deleted in
 * `132fbd1`).
 *
 * - ORDER_INTENT:       published BEFORE `createOrder`, so a durable record of
 *                       "what the engine was about to place" survives a crash
 *                       mid-submission (reconciliation adopts or cancels it).
 * - TRADE_EXECUTED:     published once per detected fill. The backend inserts
 *                       it idempotently (unique
 *                       `(bot_id, client_order_id, exchange_order_id, fill_id)`),
 *                       so redelivery/replay of the same event is a no-op.
 * - POSITION_UPDATED:   the engine's aggregate position view after a fill.
 * - PERFORMANCE_SNAPSHOT: engine-side counters (telemetry only — the
 *                       authoritative `bot_instances` totals are derived from
 *                       the fill ledger, never from this event).
 *
 * Every payload carries `engineId` + `engineEpoch` so the backend can run the
 * same fail-closed authority check as the lifecycle events. Identity fields
 * (`user_id`, `strategy_id`) are resolved server-side from `bot_instances` —
 * never trusted from the wire.
 *
 * The correlationId of these events is a fresh UUID: they do not reference a
 * backend command (same convention as ENGINE_REGISTER / ENGINE_HEARTBEAT).
 *
 * @format
 */

import { ProtocolMessage } from "./bot-command";

// ===========================================
// EVENT TYPES
// ===========================================

export type EngineLedgerEventType =
  | "ORDER_INTENT"
  | "TRADE_EXECUTED"
  | "POSITION_UPDATED"
  | "PERFORMANCE_SNAPSHOT";

/** Order sides as written by the engine and stored in PostgreSQL. */
export type LedgerOrderSide = "BUY" | "SELL";
/** Position side; FLAT is an explicit "no position" report. */
export type LedgerPositionSide = "LONG" | "SHORT" | "FLAT";
/**
 * Fill status vocabulary. Engine statuses must map into the `trades.status`
 * CHECK constraint (`PENDING | FILLED | PARTIAL | CANCELLED | REJECTED`) —
 * the backend narrows `PARTIALLY_FILLED` → `PARTIAL` on ingest (N7).
 */
export type LedgerFillStatus = "FILLED" | "PARTIALLY_FILLED";

export interface OrderIntentEventPayload {
  botId: string;
  engineId: string;
  /** Restart epoch of the emitting engine process (authority validation). */
  engineEpoch: number;
  symbol: string;
  side: LedgerOrderSide;
  /** Limit price the engine intends to place at. */
  price: number;
  quantity: number;
  /** Deterministic client order id (idempotency key of the slot). */
  clientOrderId: string;
}

export interface TradeExecutedEventPayload {
  botId: string;
  engineId: string;
  /** Restart epoch of the emitting engine process (authority validation). */
  engineEpoch: number;
  symbol: string;
  side: LedgerOrderSide;
  /**
   * Executed price of the fill: what the venue reported (`average_executed_price`
   * on Orderly, the order's own price on Lighter), else the limit price the
   * engine submitted. Never the mark price at check time (N6).
   */
  price: number;
  quantity: number;
  /**
   * Fee booked for this fill as `notional × rate`, sourced from the venue's
   * own account tier (N6a). Absent when the rate could not be sourced — an
   * unknown fee is never written as a made-up `0`.
   */
  fee?: number;
  /**
   * Realised PnL contributed by this fill: `0 - fee` on an entry leg (its
   * spread is unrealised until the paired exit) and
   * `(sellExec - entryExec) × quantity - fee` on the closing leg — so
   * `SUM(pnl)` over the ledger is realised PnL net of fees and reconciles with
   * `bot_instances.total_pnl` (N6). Absent when the fee is unknown.
   */
  pnl?: number;
  status: LedgerFillStatus;
  /** Deterministic client order id of the filled slot. */
  clientOrderId: string;
  /** Adapter-defined exchange order handle (round-trips into getOrder). */
  exchangeOrderId: string;
  /**
   * Idempotency identity of this fill. The engine synthesizes it
   * deterministically (sha256 over botId/clientOrderId/exchangeOrderId) until
   * the venues expose real fill ids — a re-detection of the same fill must
   * produce the same value so the ledger dedups it.
   */
  fillId: string;
  /** ISO-8601 execution time as observed by the engine. */
  executedAt: string;
}

export interface PositionUpdatedEventPayload {
  botId: string;
  engineId: string;
  /** Restart epoch of the emitting engine process (authority validation). */
  engineEpoch: number;
  symbol: string;
  side: LedgerPositionSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  /** Realised PnL net of fees — sums to the engine's fill ledger (N6). */
  pnl: number;
  /**
   * Mark-to-market PnL of the open inventory (N6). Optional so reports from
   * engines older than the split still validate; stored for display, never
   * added to `bot_instances.total_pnl` (that stays ledger-derived).
   */
  unrealizedPnl?: number;
}

export interface PerformanceSnapshotEventPayload {
  botId: string;
  engineId: string;
  /** Restart epoch of the emitting engine process (authority validation). */
  engineEpoch: number;
  metrics: {
    /** In-memory engine counters — reset on engine restart (telemetry). */
    totalTrades: number;
    totalPnl: number;
    winRate?: number;
    maxDrawdown?: number;
    profitFactor?: number;
    sharpeRatio?: number;
  };
}

export type EngineLedgerEventPayload =
  | OrderIntentEventPayload
  | TradeExecutedEventPayload
  | PositionUpdatedEventPayload
  | PerformanceSnapshotEventPayload;

export type EngineLedgerEvent = ProtocolMessage<EngineLedgerEventPayload>;

// ===========================================
// TYPE GUARDS
// ===========================================

const LEDGER_EVENT_TYPES: readonly string[] = [
  "ORDER_INTENT",
  "TRADE_EXECUTED",
  "POSITION_UPDATED",
  "PERFORMANCE_SNAPSHOT",
];

export function isEngineLedgerEventType(type: unknown): boolean {
  return typeof type === "string" && LEDGER_EVENT_TYPES.includes(type);
}

export function isOrderIntentEvent(
  obj: unknown
): obj is ProtocolMessage<OrderIntentEventPayload> {
  const payload = (obj as { payload?: OrderIntentEventPayload })?.payload;
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as { type?: string }).type === "ORDER_INTENT" &&
    typeof payload?.botId === "string" &&
    typeof payload?.clientOrderId === "string"
  );
}

export function isTradeExecutedEvent(
  obj: unknown
): obj is ProtocolMessage<TradeExecutedEventPayload> {
  const payload = (obj as { payload?: TradeExecutedEventPayload })?.payload;
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as { type?: string }).type === "TRADE_EXECUTED" &&
    typeof payload?.botId === "string" &&
    typeof payload?.clientOrderId === "string" &&
    typeof payload?.fillId === "string"
  );
}

export function isPositionUpdatedEvent(
  obj: unknown
): obj is ProtocolMessage<PositionUpdatedEventPayload> {
  const payload = (obj as { payload?: PositionUpdatedEventPayload })?.payload;
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as { type?: string }).type === "POSITION_UPDATED" &&
    typeof payload?.botId === "string" &&
    typeof payload?.symbol === "string"
  );
}

export function isPerformanceSnapshotEvent(
  obj: unknown
): obj is ProtocolMessage<PerformanceSnapshotEventPayload> {
  const payload = (
    obj as {
      payload?: PerformanceSnapshotEventPayload;
    }
  )?.payload;
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as { type?: string }).type === "PERFORMANCE_SNAPSHOT" &&
    typeof payload?.botId === "string" &&
    typeof payload?.metrics?.totalTrades === "number" &&
    typeof payload?.metrics?.totalPnl === "number"
  );
}
