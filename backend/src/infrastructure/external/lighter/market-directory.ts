/**
 * Lighter public market directory — `GET /api/v1/orderBooks` ⇄ symbol ↔
 * `market_id` (X3).
 *
 * Extracted from `portfolio.ts` (which now imports it) so the trades reader and
 * the candles reader (`./market-data.ts`, venue dispatch on `/tv/history`)
 * share ONE directory source. Behaviour is unchanged from the portfolio-era
 * copy: cached in-memory under the existing `lighter:markets:{env}` key for
 * 5 minutes, and a fetch failure degrades to an **empty** directory (callers
 * decide what a miss means — trades fall back to the raw id, candles answer
 * "symbol not listed").
 *
 * @format
 */

import { kodiakCache } from "../kodiak-cache";
import { lighterBaseUrl } from "../exchange-accounts/lighter-verifier";
import { venueClient } from "./venue-client";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";

const MARKET_DIRECTORY_TTL_MS = 300000;

/** Venue string/number → finite number (never poison a numeric column). */
function num(value: unknown): number {
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Public `GET /api/v1/orderBooks` → `market_id → symbol` directory (cached
 * 5 min per environment). A directory miss degrades symbols to the raw id —
 * it must never fail the trades read.
 */
export async function marketDirectory(
  environment: string
): Promise<Map<number, string>> {
  const cacheKey = `lighter:markets:${environment}`;
  const cached = kodiakCache.get(cacheKey);
  if (cached instanceof Map) return cached;
  const byId = new Map<number, string>();
  try {
    const response = await venueClient(lighterBaseUrl(environment)).get(
      "/api/v1/orderBooks"
    );
    const data = response.data as { order_books?: unknown } | undefined;
    const books = Array.isArray(data?.order_books) ? data.order_books : [];
    for (const row of books) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const marketId = num(record.market_id ?? record.market_index);
      if (marketId && typeof record.symbol === "string") {
        byId.set(marketId, record.symbol);
      }
    }
  } catch (error) {
    logger.warn("Failed to load Lighter market directory", {
      environment,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  kodiakCache.set(cacheKey, byId, MARKET_DIRECTORY_TTL_MS);
  return byId;
}

/**
 * `symbol → market_id` (case-insensitive; Lighter symbols are exact strings
 * like `ETH` / `ETH/USDC`, so only the case is normalised). `null` = not
 * listed (or the catalog is currently unavailable) — callers answer an
 * explicit "not listed" error rather than guessing an id.
 */
export async function resolveMarketId(
  symbol: string,
  environment: string
): Promise<number | null> {
  const byId = await marketDirectory(environment);
  const wanted = symbol.trim().toUpperCase();
  if (!wanted) return null;
  for (const [marketId, listed] of byId) {
    if (listed.toUpperCase() === wanted) return marketId;
  }
  return null;
}
