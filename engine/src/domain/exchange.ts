/**
 * Exchange Client Interface
 *
 * Defines the contract that all exchange implementations must fulfill.
 * This allows the engine to work with any exchange (Kodiak, Uniswap, etc.)
 * without coupling to specific exchange APIs.
 *
 * @format
 */

/**
 * Ticker information for a trading pair.
 */
export interface ExchangeTicker {
  symbol: string;
  price: number;
  mark_price?: number;
  index_price?: number;
}

/**
 * Order request parameters.
 */
export interface ExchangeOrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  orderPrice?: number;
  orderQuantity: number;
  clientOrderId?: string;
  /**
   * Venue-level "reduce only" flag (N6): the order may only shrink the
   * account's existing position, never open or grow one. The **caller** decides
   * — the grid sets it on its exit legs, whose only job is to close a level's
   * long — and the adapter forwards it verbatim (Orderly `reduce_only`;
   * Lighter `reduce_only` through the signing sidecar). Undefined means "not
   * requested", not "false".
   */
  reduceOnly?: boolean;
}

/**
 * Order response from an exchange.
 *
 * `orderId` is an **adapter-defined handle**, not necessarily the venue's own
 * identifier: it must round-trip into this adapter's `cancelOrder` and
 * `getOrder` (a live example: Lighter cancels/polls by client order index and
 * rejects its venue-assigned `order_id` for both, so its adapter emits the
 * client index as `orderId`). Callers must only ever pass back a value they
 * received from `createOrder`, `listOpenOrders`, or `queryOrderByClientOrderId`.
 */
export interface ExchangeOrderResponse {
  orderId: string;
  status: string;
  executedPrice?: number;
  executedQuantity?: number;
}

/**
 * Position information.
 */
export interface ExchangePosition {
  symbol: string;
  position_qty: number;
  mark_price: number;
  [key: string]: unknown;
}

/**
 * Account information.
 */
export interface ExchangeAccountInfo {
  total_value: number;
  max_leverage: number;
  max_notional?: Record<string, number>;
  [key: string]: unknown;
}

/**
 * Account fee rates as reported by the venue, expressed as **fractions of the
 * traded notional** (`0.0004` = 0.04% = 4 bps).
 *
 * Fee rates are an account-level fact, not a per-fill field: Phase-1
 * reconnaissance (2026-10-02) found that Lighter exposes **no** fee on any
 * REST tape — including the authenticated, account-scoped `/api/v1/trades` —
 * so the engine derives a fill's fee as `notional × rate` from this type.
 * Provenance rides along so the ledger can record where a number came from.
 */
export interface ExchangeFeeRates {
  /** Maker fee as a fraction of notional (0.0004 = 0.04% = 4 bps). */
  makerRate: number;
  /** Taker fee as a fraction of notional. */
  takerRate: number;
  /** Venue-reported tier label when the venue names one (e.g. "standard"). */
  tier?: string;
  /** True when these rates describe the account's own venue-reported tier. */
  venueReported?: boolean;
  /**
   * True when `makerRate`/`takerRate` are the exact published rates; false
   * when an unapplied discount or an unmapped tier makes them an upper bound.
   */
  exact?: boolean;
  /** Human-readable provenance of the numbers (venue fields / fallback). */
  basis?: string;
}

/**
 * Order lookup result for idempotency reconciliation.
 *
 * `NOT_FOUND` means the exchange definitively reports the order absent
 * (safe to recreate). `UNREACHABLE` means the exchange could not be asked
 * (timeout, 5xx, network error) — the caller must freeze the slot and must
 * NOT recreate, because the order may still be live. Never `null`.
 */
export type OrderLookup =
  | { kind: "FOUND_OPEN"; order: ExchangeOpenOrder }
  | { kind: "FOUND_FILLED"; order: ExchangeOpenOrder }
  | { kind: "FOUND_CANCELED"; order: ExchangeOpenOrder }
  | { kind: "NOT_FOUND" }
  | { kind: "UNREACHABLE"; reason: string };

/**
 * Open-order row as reported by an exchange listing.
 */
export interface ExchangeOpenOrder {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  status: string;
  side?: "BUY" | "SELL";
  price?: number;
  quantity?: number;
  [key: string]: unknown;
}

/**
 * Default HTTP timeout (ms) for every exchange request. A hung socket must
 * never stall the engine's single-flight tick forever (plan §B1).
 */
export const DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS = 8000;

/**
 * Exchange client interface.
 * All exchange implementations must implement this interface.
 */
export interface ExchangeClient {
  /**
   * Get current ticker for a symbol.
   */
  getTicker(symbol: string): Promise<ExchangeTicker>;

  /**
   * Place a new order.
   */
  createOrder(request: ExchangeOrderRequest): Promise<ExchangeOrderResponse>;

  /**
   * Cancel an existing order.
   */
  cancelOrder(orderId: string, symbol: string): Promise<{ status: string }>;

  /**
   * Get order status.
   */
  getOrder(orderId: string): Promise<ExchangeOrderResponse>;

  /**
   * Get all open positions.
   */
  getPositions(): Promise<ExchangePosition[]>;

  /**
   * Get account information.
   */
  getAccountInfo(): Promise<ExchangeAccountInfo>;

  /**
   * Venue-reported fee rates for this account, when the venue exposes them.
   *
   * Optional by design: an adapter whose venue publishes no account fee tier
   * omits it, and callers must then fall back to configured rates — an absent
   * method means "unknown", never "fee-free".
   */
  getFeeRates?(): Promise<ExchangeFeeRates>;

  /**
   * List open orders for a symbol — the startup orphan cross-check source.
   * Transport failures reject; callers map them to `UNREACHABLE` via
   * `queryOrderByClientOrderId` rather than treating them as "absent".
   */
  listOpenOrders(symbol: string): Promise<ExchangeOpenOrder[]>;

  /**
   * Look up one order by the client order id the engine assigned at
   * placement. Never returns `null`: `NOT_FOUND` means definitively
   * absent (safe to recreate), `UNREACHABLE` means the exchange could
   * not be asked (freeze the slot, never recreate).
   */
  queryOrderByClientOrderId(
    symbol: string,
    clientOrderId: string
  ): Promise<OrderLookup>;
}
