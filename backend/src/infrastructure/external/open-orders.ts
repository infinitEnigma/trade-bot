/**
 * Venue-neutral open-order rows for the strategy workspace (Phase 3).
 *
 * Both venue readers — Kodiak's `getOrders` on the integration service
 * (Orderly `GET /v1/orders[?symbol=]`) and Lighter's `getLighterOrders`
 * (`GET /api/v1/accountActiveOrders`) — map their wire rows onto
 * `OpenOrderRow`, so `GET /api/market/orders` answers one contract no
 * matter which venue the scoped account belongs to. The mappers here are
 * pure (no I/O) and tested directly in
 * `backend/tests/unit/open-orders.test.ts`.
 *
 * Wire facts pinned from the engine adapters
 * (`engine/src/exchanges/{kodiak,lighter}/client.ts`):
 * - Orderly rows: `order_id`, `client_order_id`, `symbol`, `side`,
 *   `order_type`, `order_price`, `order_quantity`, `executed_quantity`,
 *   `status`, `created_time` — the listing reports open orders only, and
 *   `makeKodiakRequest` returns the raw `{ success, data: { rows } }`
 *   envelope (see `orderRowsFromEnvelope`).
 * - Lighter rows: human-unit `price` / `initial_base_amount` /
 *   `filled_base_amount` (the scaled integer `base_price` must NOT be read
 *   without the market's decimals), side via `is_ask`, `market_id` → symbol
 *   through the public `orderBooks` directory, and the row handle is the
 *   **client order index** (the id cancel/query accept — never the 5.6e14
 *   venue `order_id`).
 *
 * @format
 */

/**
 * Short cache TTL (ms) — an open-orders table that lags the venue is worse
 * than none, so both readers keep this far tighter than the 30 s the
 * positions/trades rows use.
 */
export const OPEN_ORDERS_TTL_MS = 5000;

/** One row of the workspace's open-orders table (both venues). */
export interface OpenOrderRow {
  /** Venue order handle — Orderly `order_id`; Lighter client order index. */
  orderId: string;
  /** Human-readable client id when the venue echoes one (else `null`). */
  clientOrderId: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  /** Venue-native order type uppercased (`LIMIT`, `MARKET`); `""` if absent. */
  orderType: string;
  /** Limit price in human units; `null` when the row carries no fixed price. */
  price: number | null;
  /** Order size in base units; `null` when the row carries none. */
  quantity: number | null;
  /** Venue cumulative fill in base units — never conflated with `quantity`. */
  filledQuantity: number;
  /** Venue-native status uppercased (`NEW`, `OPEN`, `PARTIALLY_FILLED`…). */
  status: string;
  /** Created-at epoch milliseconds; `null` when the venue omits it. */
  createdAtMs: number | null;
  /** Which venue answered — lets the table badge rows without a second call. */
  exchange: "kodiak" | "lighter";
}

/** Loose object guard for venue payloads (rows are `unknown` at the edge). */
function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/**
 * Venue envelope → raw order rows. Orderly answers
 * `{ success, data: { rows } }`; a bare array or flat `{ rows }` is
 * accepted too, and anything unrecognised degrades to an empty book rather
 * than throwing (an unreadable listing must read as "no open orders", not
 * as an endpoint failure — the readers still surface real transport errors
 * via their own catch).
 */
export function orderRowsFromEnvelope(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const bag = asRecord(raw);
  if (!bag) return [];
  if (Array.isArray(bag.rows)) return bag.rows;
  const data = asRecord(bag.data);
  return data && Array.isArray(data.rows) ? data.rows : [];
}

/** String/number → trimmed string, or `""` (never `undefined` into a row). */
function upper(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** Loose number → finite number or `null` (never `NaN` into a column). */
function finite(value: unknown): number | null {
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Venue timestamp → epoch **milliseconds**. Lighter and Orderly rows carry
 * ms today; a seconds value (~1e9) is scaled up so a stray seconds field
 * can never render an order at 1970.
 */
function epochMs(value: unknown): number | null {
  const n = finite(value);
  if (n === null || n <= 0) return null;
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

/**
 * Orderly `GET /v1/orders` row → `OpenOrderRow` (engine parity:
 * `toExchangeOpenOrder` — same field picks, same SELL-else-BUY side rule).
 * `fallbackSymbol` is the symbol the caller filtered on; it only fills rows
 * that omit `symbol`. Returns `null` for rows without an order id (they
 * cannot be keyed in the table).
 */
export function mapKodiakOrderRow(
  raw: unknown,
  fallbackSymbol?: string
): OpenOrderRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const orderId = row.order_id != null ? String(row.order_id).trim() : "";
  if (!orderId) return null;
  const symbol = String(row.symbol ?? fallbackSymbol ?? "")
    .trim()
    .toUpperCase();
  return {
    orderId,
    clientOrderId:
      row.client_order_id != null ? String(row.client_order_id) : null,
    symbol,
    side: upper(row.side) === "SELL" ? "SELL" : "BUY",
    orderType: upper(row.order_type ?? row.type),
    price: finite(row.order_price),
    quantity: finite(row.order_quantity),
    filledQuantity: finite(row.executed_quantity) ?? 0,
    status: upper(row.status) || "OPEN",
    createdAtMs: epochMs(row.created_time ?? row.timestamp),
    exchange: "kodiak",
  };
}

/**
 * Dashboard display symbol (`PERP_ETH_USDC` style) — same rule as the
 * private `displaySymbol` helper in `lighter/portfolio.ts` (kept as a
 * local copy so this module stays dependency-free and cycle-free; the two
 * must agree or the workspace's symbol filter would miss Lighter rows).
 */
function toDisplaySymbol(raw: unknown): string {
  const symbol = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!symbol) return "UNKNOWN";
  return symbol.includes("_") ? symbol : `PERP_${symbol}_USDC`;
}

/** Lighter side: `is_ask` is the venue's canonical flag; `side` is fallback. */
function lighterSide(row: Record<string, unknown>): "BUY" | "SELL" {
  const ask = row.is_ask;
  if (ask !== undefined && ask !== null) {
    const text = String(ask).toLowerCase();
    return text === "1" || text === "true" ? "SELL" : "BUY";
  }
  const side = upper(row.side);
  return side === "SELL" || side === "ASK" ? "SELL" : "BUY";
}

/**
 * Lighter `GET /api/v1/accountActiveOrders` row → `OpenOrderRow` (engine
 * parity: `toOpenOrder` — human-unit price/quantity, client order index as
 * the handle, absent status reads as resting `OPEN`). `directory` maps
 * `market_id → venue symbol` (a miss falls back to the row's own `symbol`,
 * then to the raw id — same convention as the trades reader). Returns
 * `null` for rows without any handle.
 */
export function mapLighterOrderRow(
  raw: unknown,
  directory: Map<number, string>
): OpenOrderRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const handle =
    row.client_order_index != null
      ? String(row.client_order_index)
      : row.client_order_id != null
        ? String(row.client_order_id)
        : row.order_id != null
          ? String(row.order_id)
          : "";
  if (!handle.trim()) return null;
  const marketId = Number(row.market_id ?? row.market_index);
  const named =
    (Number.isFinite(marketId) && marketId !== 0
      ? directory.get(marketId)
      : undefined) ??
    (typeof row.symbol === "string" && row.symbol.trim()
      ? row.symbol
      : undefined) ??
    String(row.market_id ?? row.market_index ?? "");
  return {
    orderId: handle,
    clientOrderId:
      row.client_order_id != null ? String(row.client_order_id) : null,
    symbol: toDisplaySymbol(named),
    side: lighterSide(row),
    orderType: upper(row.order_type ?? row.type),
    price: finite(row.price),
    quantity:
      finite(row.initial_base_amount) ??
      finite(row.remaining_base_amount) ??
      finite(row.filled_base_amount) ??
      finite(row.base_amount),
    filledQuantity: finite(row.filled_base_amount) ?? 0,
    status: row.status == null ? "OPEN" : upper(row.status) || "OPEN",
    createdAtMs: epochMs(
      row.transaction_time ?? row.updated_at ?? row.timestamp
    ),
    exchange: "lighter",
  };
}
