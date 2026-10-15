/**
 * Venue symbol catalog PORT — the live symbol list the lifecycle service's
 * admission validates against (L20 / migration 026).
 *
 * The fetch implementation lives in
 * `infrastructure/external/venue-symbols.ts` (`venueSymbolCatalog`); core
 * only sees this port (dependency inversion — review P1, 2026-10-15).
 * The pure comparison policy is in `core/market/venue-catalog.policy.ts`.
 *
 * @format
 */

export interface IVenueSymbolCatalog {
  /** Live symbol list, or null when the venue catalog is unfetchable (fail-open). */
  listSymbols(exchange: string, environment: string): Promise<string[] | null>;
}
