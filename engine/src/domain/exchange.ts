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
  /**
   * Crossing band for an adapter-priced MARKET request, in basis points off
   * the reference price. Lighter has no signed MARKET type: its adapter
   * executes MARKET as an IOC limit at mark ∓ band, and this overrides the
   * fixed default (100 bps) so a panic flatten can escalate its willingness
   * to cross a thin book — bounded by the adapter's own clamp, never
   * unbounded. Advisory for adapters with native market orders (they may
   * ignore it); meaningless on a LIMIT request, where the price is the
   * caller's (adapters fail closed if it is set there).
   */
  maxSlippageBps?: number;
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
 * One price level of the resting book (`getMarketDepth`).
 *
 * `quantity` is the level's *remaining* base size — the fillable amount, not
 * the originally-posted size (Lighter rows `remaining_base_amount`).
 */
export interface ExchangeDepthLevel {
  price: number;
  quantity: number;
}

/**
 * Resting order-book depth snapshot — sizing guidance for slice-based exits
 * (the emergency flatten's first consumer; the 2026-10-14 prod incident
 * submitted one full-size IOC into a book thinner than the position and
 * silently cancelled the remainder).
 *
 * Best-first on both sides. This is NOT a precision boundary: float sums over
 * these levels only size order slices, and the submission boundary (tick
 * check, venue minimums, the adapter's scaling) still enforces the exact
 * rules — never derive a submission price from these numbers alone. An EMPTY
 * snapshot means "the venue reported no resting orders"; a venue that could
 * not be asked must REJECT instead (an unreachable book must never read as
 * empty — that would steer sizing on fabricated data).
 */
export interface ExchangeMarketDepth {
  symbol: string;
  bids: ExchangeDepthLevel[];
  asks: ExchangeDepthLevel[];
  /** Epoch ms of the read, when the venue provides one. Absent = "as read". */
  asOf?: number;
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
  /**
   * Cumulative quantity executed on this order as of the listing row
   * (Phase 4 partial-fill detection). Distinct from `quantity`, which is the
   * **order's size** (`initial_base_amount` on Lighter): a partially-filled
   * row reads `quantity` = full size while `executedQuantity` = the filled
   * part. Optional — an adapter or tape that carries no such field omits it,
   * and the observation path then books nothing (risk D1: never guess);
   * the `getOrder` path, which does carry it, catches the fill within one
   * slot-check interval. A terminal-cancel observation must read *this*
   * field, never `quantity`: a canceled remainder's `quantity` is the
   * original size, not what actually filled before the cancel.
   */
  executedQuantity?: number;
  [key: string]: unknown;
}

/**
 * Default HTTP timeout (ms) for every exchange request. A hung socket must
 * never stall the engine's single-flight tick forever (plan §B1).
 */
export const DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS = 8000;

/**
 * Price rules for one exchange market (Phase B).
 *
 * `priceTickSize` is a decimal string at the API boundary (`"0.05"`), never
 * a float: decimal places and tick size are not the same thing.
 */
export interface MarketRules {
  exchange: string;
  symbol: string;
  priceTickSize: string;
}

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
   * Which ACCOUNT this client trades — a stable string for one venue account.
   *
   * Optional on the type (same "optional on the type, runtime-checked by the
   * consumer" pattern as `getFeeRates?`/`getMarketRules?`), and absent means
   * "unknown", never "no account". Consumers must treat an unknown identity
   * CONSERVATIVELY — as possibly shared — because positions on these venues
   * belong to the *account*, not the bot: the emergency flatten uses this to
   * decide whether a sibling bot trading the same symbol owns the same
   * position (skip) or an independent one on another account (flatten).
   *
   * Must be cheap and local: derived from the credentials/config the client
   * was built with, never a venue round-trip.
   */
  getAccountIdentity?(): string;

  /**
   * List open orders for a symbol — the startup orphan cross-check source.
   * Transport failures reject; callers map them to `UNREACHABLE` via
   * `queryOrderByClientOrderId` rather than treating them as "absent".
   */
  listOpenOrders(symbol: string): Promise<ExchangeOpenOrder[]>;

  /**
   * Price rules for a symbol — the market's authoritative tick size.
   *
   * Optional on the type so third-party / legacy fakes still compile, but
   * REQUIRED at runtime on the grid path: `resolveMarketRules` fails closed
   * when the method is absent. Implementations derive it from venue metadata
   * (Lighter: `supported_price_decimals`; Kodiak: `quote_tick` from
   * `GET /v1/public/info/{symbol}`) and must throw — never guess — when
   * metadata is missing or malformed.
   */
  getMarketRules?(symbol: string): Promise<MarketRules>;

  /**
   * Resting book depth for a symbol — bids/asks best-first, level quantity =
   * remaining (fillable) size. Sizing guidance for slice-based exits (panic
   * flatten), never a submission-precision source.
   *
   * Optional on the type so legacy fakes still compile; runtime-optional by
   * design: consumers must DEGRADE gracefully when it is absent (the flatten
   * falls back to full-size IOC slices), never fail closed on the capability
   * itself. Implementations must REJECT on transport failures — an
   * unreachable venue must never masquerade as an empty book.
   */
  getMarketDepth?(
    symbol: string,
    options?: { limit?: number }
  ): Promise<ExchangeMarketDepth>;

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
