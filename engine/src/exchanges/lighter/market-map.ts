/** @format */

/**
 * Lighter market directory (workstream B3).
 *
 * Phase-0 probe facts (`steps_readonly.py` / `steps_orders.py`):
 * - `GET /api/v1/orderBooks` lists `{symbol, market_id}`; the matching entry
 *   is case-insensitive on `symbol`.
 * - `GET /api/v1/orderBookDetails?market_id=<id>` returns the entry carrying
 *   `supported_price_decimals`, `supported_size_decimals`, `min_base_amount`,
 *   and `mark_price`. Prices/amounts sent to the sidecar are scaled integers
 *   in those decimals — the sidecar does no decimal math.
 * - Symbol case on the wire is the engine's own convention (`ETH`, or the
 *   order-book's `symbol` verbatim); unknown symbols resolve to
 *   `CommandError`, never a guessed market.
 */

export interface LighterMarket {
  marketIndex: number;
  /** Symbol as listed by the venue (e.g. `ETH`). */
  symbol: string;
  priceDecimals: number;
  sizeDecimals: number;
  minBaseAmount: number;
  markPrice?: number;
}

/** Minimal reader surface the directory needs (axios-like GET). */
export interface MarketReader {
  get(
    path: string,
    options?: { params?: Record<string, unknown> }
  ): Promise<{ data?: unknown }>;
}

export class UnknownMarketError extends Error {
  constructor(symbol: string) {
    super(`Unknown Lighter market for symbol "${symbol}" (no guessed market)`);
    this.name = "UnknownMarketError";
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseDetails(
  entry: Record<string, unknown>,
  fallbackSymbol: string
): LighterMarket {
  return {
    marketIndex: toNumber(entry.market_id ?? entry.market_index, NaN),
    symbol: String(entry.symbol ?? fallbackSymbol),
    priceDecimals: toNumber(entry.supported_price_decimals, 0),
    sizeDecimals: toNumber(entry.supported_size_decimals, 0),
    minBaseAmount: toNumber(entry.min_base_amount, 0),
    markPrice:
      entry.mark_price !== undefined && entry.mark_price !== null
        ? Number(entry.mark_price)
        : undefined,
  };
}

/**
 * Resolve one market by symbol via `orderBooks` + `orderBookDetails`.
 * Unknown symbols throw `UnknownMarketError` — never a guessed market.
 */
export async function resolveLighterMarket(
  reader: MarketReader,
  symbol: string
): Promise<LighterMarket> {
  const booksResp = await reader.get("/api/v1/orderBooks");
  const books = (booksResp.data as Record<string, unknown> | undefined)
    ?.order_books;
  const rows: unknown[] = Array.isArray(books) ? books : [];
  const wanted = symbol.toUpperCase();
  const match = rows.find(
    row =>
      typeof row === "object" &&
      row !== null &&
      String((row as Record<string, unknown>).symbol ?? "").toUpperCase() ===
        wanted
  ) as Record<string, unknown> | undefined;
  if (!match) throw new UnknownMarketError(symbol);

  const marketId = match.market_id ?? match.market_index;
  const detailsResp = await reader.get("/api/v1/orderBookDetails", {
    params: { market_id: marketId },
  });
  const details = (detailsResp.data as Record<string, unknown> | undefined)
    ?.order_book_details;
  const entries: unknown[] = Array.isArray(details) ? details : [];
  const entry =
    entries.length > 0 && typeof entries[0] === "object" && entries[0] !== null
      ? (entries[0] as Record<string, unknown>)
      : match;
  const market = parseDetails(entry, symbol);
  if (!Number.isInteger(market.marketIndex)) {
    throw new UnknownMarketError(symbol);
  }
  return market;
}

/**
 * TTL-cached market directory. Resolution hits REST; repeats within `ttlMs`
 * are served from memory. Keyed by upper-cased symbol.
 */
export class LighterMarketDirectory {
  private readonly cache = new Map<
    string,
    { at: number; market: LighterMarket }
  >();

  constructor(
    private readonly reader: MarketReader,
    private readonly ttlMs = 300_000
  ) {}

  async get(symbol: string): Promise<LighterMarket> {
    const key = symbol.toUpperCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.market;
    const market = await resolveLighterMarket(this.reader, symbol);
    this.cache.set(key, { at: Date.now(), market });
    return market;
  }

  clear(): void {
    this.cache.clear();
  }
}
