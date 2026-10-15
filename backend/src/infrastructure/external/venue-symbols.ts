/** @format */

/**
 * Venue symbol catalogs (L20).
 *
 * Start-time gate: reject a strategy whose `config.symbol` is not listed on
 * the bound account's venue BEFORE the bot row is created or BOT_START is
 * dispatched, with a user-facing reason. Fail-open by design: when the venue
 * list cannot be fetched (or the venue is unknown), start proceeds and the
 * engine's own resolution (Lighter market directory / ticker lookup) stays
 * the authority — this is a UX guard, not a security boundary.
 *
 * Split (dependency inversion — review P1): the pure comparison policy
 * (`VenueSymbolError`, `VenueCatalogUnavailableError`,
 * `revalidateSymbolAgainstCatalog`) now lives in
 * `core/market/venue-catalog.policy.ts` and is re-exported here for
 * existing importers. This module keeps the network fetch and exposes
 * `venueSymbolCatalog` — the `IVenueSymbolCatalog` port implementation the
 * lifecycle service is wired to at startup.
 */

import { contextLogger as logger } from "../../core/logging";
import { lighterBaseUrl } from "./exchange-accounts/lighter-verifier";
import { IVenueSymbolCatalog } from "../../core/bots/lifecycle/venue-symbol-catalog.port";
import {
  VenueCatalogUnavailableError,
  buildVenueSymbolError,
} from "../../core/market/venue-catalog.policy";

export {
  VenueSymbolError,
  VenueCatalogUnavailableError,
  revalidateSymbolAgainstCatalog,
} from "../../core/market/venue-catalog.policy";

const FETCH_TIMEOUT_MS = 5_000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * The symbols a venue lists, or `null` when the catalog cannot be obtained
 * (network error, unexpected shape, unknown exchange) — callers fail open.
 *
 * - lighter: `GET {lighterBaseUrl}/api/v1/orderBooks` → `order_books[].symbol`
 *   (same endpoint the engine's market directory resolves against).
 * - kodiak:  `GET {KODIAK_API_URL}/v1/public/futures` → `data.rows[].symbol`
 *   (Orderly instrument list; presence check only, no status filtering —
 *   a closed market fails at the engine instead of being masked here).
 */
export async function listVenueSymbols(
  exchange: string,
  environment: string
): Promise<string[] | null> {
  try {
    let raw: string[] = [];
    if (exchange === "lighter") {
      const data = (await fetchJson(
        `${lighterBaseUrl(environment)}/api/v1/orderBooks`
      )) as { order_books?: Array<{ symbol?: unknown }> };
      raw = (Array.isArray(data?.order_books) ? data.order_books : []).map(
        row => (typeof row?.symbol === "string" ? row.symbol : "")
      );
    } else if (exchange === "kodiak") {
      const base = (
        process.env.KODIAK_API_URL || "https://api.orderly.org"
      ).replace(/\/+$/, "");
      const data = (await fetchJson(`${base}/v1/public/futures`)) as {
        data?: { rows?: Array<{ symbol?: unknown }> };
      };
      const rows = Array.isArray(data?.data?.rows) ? data.data.rows : [];
      raw = rows.map(row =>
        typeof row?.symbol === "string" ? row.symbol : ""
      );
    } else {
      return null;
    }
    const symbols = raw.filter(Boolean);
    return symbols.length > 0 ? symbols : null;
  } catch (error) {
    logger.warn("Venue symbol catalog unavailable - skipping symbol check", {
      exchange,
      environment,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The `IVenueSymbolCatalog` port implementation — the single source the
 * lifecycle service's admission reads through the port.
 */
export const venueSymbolCatalog: IVenueSymbolCatalog = {
  listSymbols: (exchange, environment) =>
    listVenueSymbols(exchange, environment),
};

/**
 * Reject (HTTP 400) when `symbol` is not listed on `(exchange, environment)`.
 * Resolves when the symbol is listed, when the catalog is unavailable
 * (fail-open — the engine remains authoritative), or for unknown venues.
 *
 * Legacy path: venue-less (null) strategies only. Venue-bound strategies
 * use `assertSymbolSupportedStrict` (fail-closed on unavailable catalog).
 */
export async function assertSymbolSupported(
  symbol: string,
  exchange: string,
  environment: string
): Promise<void> {
  const symbols = await listVenueSymbols(exchange, environment);
  if (!symbols) return;
  if (symbols.some(listed => listed.toUpperCase() === symbol.toUpperCase())) {
    return;
  }
  throw buildVenueSymbolError(symbol, exchange, environment, symbols);
}

/**
 * Strict variant for venue-bound strategies (migration 026): the catalog
 * must be available AND list the symbol. Unavailable catalog → 503
 * `VenueCatalogUnavailableError` (fail-closed); unlisted symbol → 400
 * `VenueSymbolError`. No network I/O may hold a DB row lock — callers
 * resolve this BEFORE opening the admission transaction, then revalidate
 * the locked row against the already-fetched result.
 */
export async function assertSymbolSupportedStrict(
  symbol: string,
  exchange: string,
  environment: string
): Promise<void> {
  const symbols = await listVenueSymbols(exchange, environment);
  if (!symbols) throw new VenueCatalogUnavailableError(exchange, environment);
  if (symbols.some(listed => listed.toUpperCase() === symbol.toUpperCase())) {
    return;
  }
  throw buildVenueSymbolError(symbol, exchange, environment, symbols);
}
