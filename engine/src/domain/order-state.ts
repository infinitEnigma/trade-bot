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
  /**
   * Cumulative quantity **booked** for this order instance (Phase 4; risk
   * B3): the venue cumulative the ledger has already been told about. The
   * next observation books only `venueCum − filledQty` — never the whole
   * order again. Reset to 0 by `beginSubmit` (a new instance) and seeded
   * from the snapshot's `buyFilledQty`/`sellFilledQty` by `adopt` so a
   * restart re-observes the same cumulative without re-booking (risk A4).
   */
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
  | {
      kind: "FILLED";
      orderId?: string;
      /**
       * The venue's cumulative executed quantity for the order — the upper
       * bound of the fill segment this row closes (risk A1/B2). Absent when
       * the venue reported no cumulative at all (the legacy adapter case), in
       * which case the manager assumed the instance's own size.
       */
      filledQty?: number;
      /**
       * Newly-booked quantity (Phase 4, risk A2): the remainder this terminal
       * row added on top of any `PARTIALLY_FILLED` segment already booked.
       * `OrderManager.markFilled` has already granted exactly this much to the
       * level's held quantity, so it is the **only** quantity the grid may
       * book into the ledger — never `filledQty`, which is the whole order.
       * `0` when the observation added nothing (a re-detection of an
       * already-booked fill: the ledger's dedup already collapsed that row,
       * and the level must not move twice either).
       */
      delta: number;
      /**
       * Executed price of the fill — what Phase-5 accounting books realised
       * PnL from (the mark price at check time is *not* an execution fact).
       *
       * Both adapters surface the best number their tape carries: Orderly
       * reports `average_executed_price`, Lighter reports the order's own
       * limit price (its REST tapes carry no average). Absent when the venue
       * reported neither — the caller then falls back to the limit price it
       * submitted, which for a maker fill *is* the executed price.
       */
      executedPrice?: number;
      /**
       * The client order id the fill actually happened under — captured
       * before `OrderManager.markFilled` bumps the slot's generation, so the
       * ledger books the identity the venue's history row belongs to (G1).
       */
      clientOrderId: string;
    }
  | {
      /**
       * The venue still holds the order, but with cumulative executions the
       * engine has not booked yet (Phase 4; Gate 4's trigger: status `open`
       * with `filled_base_amount > 0`). `OrderManager.markBooked` has
       * already applied `delta` to the level's held quantity — the grid
       * books exactly `delta` into the ledger, never the whole order (a
       * prior segment already booked its share, risk A2).
       */
      kind: "PARTIALLY_FILLED";
      /**
       * The handle the observation came from. Stable across fills even on
       * Lighter, where the venue's own `order_id` mutates (Gate 4) — the
       * ledger's `exchange_order_id` must always be this handle (risk B2).
       */
      orderId: string;
      /** The venue's cumulative executed quantity for the order. */
      cumQty: number;
      /** Newly-booked delta: `cumQty − previously booked`, always > 0. */
      delta: number;
      /** Executed price of the segment — same rules as `FILLED`. */
      executedPrice?: number;
      clientOrderId: string;
    }
  | {
      kind: "SAFE_TO_RECREATE";
      /**
       * A terminal order (canceled/rejected/expired) whose final executions
       * are being booked only now (Phase 4, risk A3): the fill that landed
       * between the last poll and the cancel. `OrderManager` has already
       * applied `delta` to the level; the grid books it as a
       * `PARTIALLY_FILLED` row *before* the slot re-arms, so a fill just
       * before a cancel is never dropped from the ledger or the position.
       * Absent when the venue reported no unbooked remainder — the plain
       * vanish path, byte-identical to pre-Phase-4 behavior.
       */
      pendingFill?: PendingFill;
    }
  | { kind: "UNAVAILABLE"; reason: string };

/**
 * A dying order's unbooked executions (Phase 4, risk A3) — the fill that landed
 * between the last poll and the cancel, plus the identity it must be booked
 * under. Produced by `OrderReconciliationService.bookRemainder` and carried on
 * `SlotOutcome.SAFE_TO_RECREATE`, because the slot is about to re-arm and this
 * row must reach the ledger before it does.
 */
export interface PendingFill {
  /** The venue's cumulative executed quantity for the dying order. */
  cumQty: number;
  /** Newly-booked delta: `cumQty − previously booked`, always > 0. */
  delta: number;
  /** Executed price of the segment — same rules as `SlotOutcome.FILLED`. */
  executedPrice?: number;
  clientOrderId: string;
  /**
   * Handle of the dead order, when the observation had one — the handle we
   * queried under, so every segment of one order shares one exchange id
   * (risk B2).
   */
  orderId?: string;
}

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
