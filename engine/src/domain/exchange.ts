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
}

/**
 * Order response from exchange.
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
