/**
 * Order lifecycle state (Phase 2).
 *
 * The grid's slot fields (`buyOrderId` / `sellOrderId` / `filled`) are a
 * *projection*; this is the explicit machine the reconciliation service drives.
 * State is deliberately **not** persisted — it is (re)established from the
 * exchange at startup and on every tick, because the exchange is the authority
 * for what actually exists. The snapshot only supplies the grid geometry and
 * the last-known handles.
 *
 * @format
 */

import { ExchangeOpenOrder } from "./exchange";

/**
 * Explicit order state.
 *
 * `INTENDED → SUBMITTING → { OPEN | FILLED | NOT_FOUND | EXCHANGE_UNAVAILABLE }`
 * with `UNKNOWN` for a submission whose outcome we could not learn.
 */
export type OrderState =
  | "INTENDED" // decision made; not yet submitted
  | "SUBMITTING" // createOrder in flight
  | "UNKNOWN" // submitted; outcome unknown (restored handle / lost response)
  | "OPEN" // confirmed live at the exchange
  | "FILLED" // executed
  | "NOT_FOUND" // definitively absent — SAFE_TO_RECREATE
  | "EXCHANGE_UNAVAILABLE"; // could not ask (timeout/5xx/unknown) — freeze

/** One local order record, keyed by the deterministic client order id. */
export interface OrderRecord {
  clientOrderId: string;
  levelIndex: number;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  filledQty: number;
  /** Adapter handle (round-trips into cancelOrder/getOrder); set once OPEN. */
  orderId?: string;
  state: OrderState;
  /** Human-readable reason for `UNKNOWN` / `EXCHANGE_UNAVAILABLE`. */
  reason?: string;
  updatedAt: string;
}

/** Outcome of reconciling one slot, consumed by the grid's tick. */
export type SlotOutcome =
  | { kind: "OPEN"; orderId: string }
  | { kind: "FILLED"; orderId?: string; filledQty?: number }
  | { kind: "SAFE_TO_RECREATE" }
  | { kind: "UNAVAILABLE"; reason: string };

/** Result of a startup reconciliation pass over the bot's symbol. */
export interface StartupReconcileReport {
  /** False when the exchange could not be listed (fail-closed: refuse to start). */
  reachable: boolean;
  reason?: string;
  /** Slots confirmed still live at the exchange. */
  adopted: number;
  /** Slots found executed while the engine was down. */
  filled: number;
  /** Live orders at the exchange that no grid slot owns (reported, not cancelled). */
  orphans: ExchangeOpenOrder[];
}
