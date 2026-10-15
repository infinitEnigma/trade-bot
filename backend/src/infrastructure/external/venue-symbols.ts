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
 */

import { contextLogger as logger } from "../../core/logging";
import { lighterBaseUrl } from "./exchange-accounts/lighter-verifier";

const FETCH_TIMEOUT_MS = 5_000;
/** Cap the supported-symbol list in the error message (kodiak lists dozens). */
const MAX_LISTED = 12;

/**
 * Validation failure carrying HTTP 400 semantics for the start route
 * (same `statusCode` convention as the lifecycle service's errors).
 */
export class VenueSymbolError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "VenueSymbolError";
  }
}

/**
 * Catalog-unavailable failure (migration 026). Venue-bound strategies fail
 * CLOSED when symbol support cannot be verified: a matching venue does not
 * prove the symbol is listed there. Legacy null-venue rows keep the
 * fail-open `assertSymbolSupported` path. Carries HTTP 503 semantics.
 */
export class VenueCatalogUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(exchange: string, environment: string) {
    super(
      `Venue catalog for ${exchange} (${environment}) is unavailable - cannot verify symbol support. Try again shortly.`
    );
    this.name = "VenueCatalogUnavailableError";
  }
}

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

/**
 * Revalidate inside the admission tx against the already-fetched catalog
 * (no fetch inside the tx). `catalog` is the `listVenueSymbols` result from
 * Phase A: `null` = unavailable, array = available snapshot.
 */
export function revalidateSymbolAgainstCatalog(
  symbol: string,
  exchange: string,
  environment: string,
  catalog: string[] | null,
  opts: { strict: boolean }
): void {
  if (catalog === null) {
    if (opts.strict)
      throw new VenueCatalogUnavailableError(exchange, environment);
    return;
  }
  if (catalog.some(listed => listed.toUpperCase() === symbol.toUpperCase())) {
    return;
  }
  throw buildVenueSymbolError(symbol, exchange, environment, catalog);
}

function buildVenueSymbolError(
  symbol: string,
  exchange: string,
  environment: string,
  symbols: string[]
): VenueSymbolError {
  const sorted = [...symbols].sort();
  const shown = sorted.slice(0, MAX_LISTED).join(", ");
  const more =
    sorted.length > MAX_LISTED
      ? ` … (+${sorted.length - MAX_LISTED} more)`
      : "";
  throw new VenueSymbolError(
    `Symbol "${symbol}" is not listed on ${exchange} (${environment}). ` +
      `Supported symbols: ${shown}.${more} ` +
      `Edit the strategy's symbol and start again.`
  );
}
