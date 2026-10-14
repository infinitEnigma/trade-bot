/** @format */

/**
 * Lighter order-book depth parser (P0.1 — panic-flatten sizing).
 *
 * Source: `GET /api/v1/orderBookOrders?market_id=&limit=` — the documented
 * REST alternative to the WebSocket `order_book` channel. Live-probed on
 * mainnet BTC (2026-10-14): the body is `{ code, total_asks, asks: [...],
 * total_bids, bids: [...] }`, where each entry is a RESTING ORDER —
 * `price` and `remaining_base_amount` are **human-unit decimal strings**
 * (the same convention the REST order rows use; NOT the scaled wire
 * integers). `limit` bounds each side; asks arrive ascending (best first),
 * bids descending (best first).
 *
 * The parser never trusts the wire order or shape: malformed rows are
 * skipped (D1 — never guess a size), the result is re-sorted best-first, and
 * an empty book is a valid answer ("no resting liquidity"), which the flatten
 * reads as "widen the band / fall back to a full-size slice", never as a
 * failure.
 */

import { ExchangeDepthLevel } from "../../domain/exchange";

export interface LighterDepthSides {
  bids: ExchangeDepthLevel[];
  asks: ExchangeDepthLevel[];
}

/** Parse one side's raw rows into best-first levels, capped at `limit`. */
function parseSide(
  rows: unknown,
  side: "bids" | "asks",
  limit: number
): ExchangeDepthLevel[] {
  const levels: ExchangeDepthLevel[] = [];
  if (!Array.isArray(rows)) return levels; // an absent side reads as empty
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const price = Number(row.price);
    // `remaining_base_amount` is what is actually fillable; fall back to the
    // posted size when the venue omits it (both are human-unit values).
    const quantity = Number(
      row.remaining_base_amount ?? row.initial_base_amount
    );
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    levels.push({ price, quantity });
  }
  levels.sort((a, b) =>
    side === "bids" ? b.price - a.price : a.price - b.price
  );
  return levels.slice(0, limit);
}

/**
 * Parse an `/api/v1/orderBookOrders` body into best-first levels.
 *
 * Throws when the body carries a non-200 `code` — the caller maps that to a
 * NON-retryable `CommandError` (a venue-declared parameter/data problem must
 * not be retried blindly). A body with no `code` (or `code: 200`) and no
 * `bids`/`asks` arrays parses as an empty book — the venue truthfully
 * reported no resting orders.
 */
export function parseOrderBookOrders(
  payload: unknown,
  limit: number
): LighterDepthSides {
  const body = (payload ?? {}) as Record<string, unknown>;
  if (body.code !== undefined && Number(body.code) !== 200) {
    throw new Error(`lighter orderBookOrders code ${String(body.code)}`);
  }
  return {
    bids: parseSide(body.bids, "bids", limit),
    asks: parseSide(body.asks, "asks", limit),
  };
}
