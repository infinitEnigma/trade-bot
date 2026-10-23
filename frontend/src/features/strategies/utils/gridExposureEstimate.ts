/** @format */

/**
 * Reference-price extraction for grid exposure guidance.
 *
 * The source must be a venue-aware TradingView history response with explicit
 * freshness metadata. The generic /market/ticker endpoint is Kodiak-only and
 * is not suitable for strategies on arbitrary venues.
 */
export const GRID_REFERENCE_PRICE_MAX_AGE_MS = 180_000;

export interface FreshGridReferencePrice {
  price: number;
  /** Unix epoch milliseconds for the latest one-minute candle. */
  timestampMs: number;
  dataSource: string;
}

interface FreshnessAwareHistoryResponse {
  success?: unknown;
  stale?: unknown;
  freshness?: {
    isStale?: unknown;
    dataSource?: unknown;
  } | null;
  data?: {
    t?: unknown;
    c?: unknown;
  } | null;
}

/**
 * Return the latest valid candle close only when the response explicitly says
 * it is fresh and the candle timestamp is within the local freshness budget.
 * Missing freshness metadata, stale responses, malformed rows, old candles,
 * and implausibly future-dated candles all fail closed.
 */
export function extractFreshGridReferencePrice(
  response: unknown,
  nowMs: number = Date.now()
): FreshGridReferencePrice | null {
  if (
    typeof response !== "object" ||
    response === null ||
    !Number.isFinite(nowMs)
  ) {
    return null;
  }

  const payload = response as FreshnessAwareHistoryResponse;
  if (
    payload.success !== true ||
    payload.stale === true ||
    payload.freshness?.isStale !== false
  ) {
    return null;
  }

  const times = payload.data?.t;
  const closes = payload.data?.c;
  if (!Array.isArray(times) || !Array.isArray(closes)) return null;

  let latest: { price: number; timestampMs: number } | null = null;

  // Select by timestamp first, then validate that candle's price. Never fall
  // back to an older valid close if the newest candle is malformed.
  for (let i = 0; i < times.length; i += 1) {
    const timestampSeconds = Number(times[i]);
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
      continue;
    }

    const timestampMs = timestampSeconds * 1000;
    if (!latest || timestampMs > latest.timestampMs) {
      latest = {
        price: i < closes.length ? Number(closes[i]) : Number.NaN,
        timestampMs,
      };
    }
  }

  if (!latest || !Number.isFinite(latest.price) || latest.price <= 0) {
    return null;
  }
  const ageMs = nowMs - latest.timestampMs;
  if (ageMs > GRID_REFERENCE_PRICE_MAX_AGE_MS || ageMs < -60_000) {
    return null;
  }

  return {
    ...latest,
    dataSource:
      typeof payload.freshness?.dataSource === "string"
        ? payload.freshness.dataSource
        : "venue-history",
  };
}
