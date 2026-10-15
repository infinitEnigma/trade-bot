/**
 * Venue symbol catalog POLICY — pure validation logic with no network I/O.
 *
 * Moved from `infrastructure/external/venue-symbols.ts` (dependency inversion
 * — external review P1, 2026-10-15): the revalidation helpers only compare a
 * symbol against an already-fetched catalog, so they belong in core. The
 * network fetch (`listVenueSymbols`) stays in infrastructure behind the
 * `IVenueSymbolCatalog` port; `venue-symbols.ts` re-exports these symbols so
 * existing importers keep working.
 *
 * @format
 */

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

/** Cap the supported-symbol list in the error message (kodiak lists dozens). */
const MAX_LISTED = 12;

export function buildVenueSymbolError(
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
  return new VenueSymbolError(
    `Symbol "${symbol}" is not listed on ${exchange} (${environment}). ` +
      `Supported symbols: ${shown}.${more} ` +
      `Edit the strategy's symbol and start again.`
  );
}

/**
 * Revalidate inside the admission tx against the already-fetched catalog
 * (no fetch inside the tx). `catalog` is the `listSymbols` result from
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
