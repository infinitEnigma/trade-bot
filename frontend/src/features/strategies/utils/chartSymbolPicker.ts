/** @format */

/**
 * Strategies chart symbol picker — pure helpers (X3).
 *
 * The chart dropdown lists **all** symbols the user's ACTIVE accounts' venues
 * list (venue-grouped via `<optgroup>`, the X1 disambiguation pattern), not
 * just the symbols strategies happen to use — the chart is a market view, and
 * the venue a symbol belongs to is now part of the selection (the reader the
 * backend dispatches to comes from it).
 *
 * Default-selection rules (locked product decision):
 * 1. first strategy's symbol → venue by **catalog membership**
 *    (case-insensitive; ties → first ACTIVE account's venue, same account
 *    order `usePortfolioSummary` uses);
 * 2. that symbol in no catalog (defensive — catalog unavailable) → first
 *    ACTIVE account's venue;
 * 3. no strategies → BTC on the first usable catalog's venue (the historic
 *    default symbol, venue-corrected so it is a real dropdown option);
 * 4. no strategies + no usable catalog → the historic `PERP_BTC_USDC`
 *    Kodiak fallback, exactly as before X3.
 *
 * Strategies do not store an exchange today, so the venue is *derived*, never
 * read from the strategy row — adding one is the platform-canonical symbol
 * work we are deliberately not doing yet (see X2 note).
 */

import type {
  AccountExchange,
  AccountEnvironment,
} from "../../../infrastructure/api/accounts";

/** The chart's market + venue selection (drives the API params + WS skip). */
export interface ChartSelection {
  symbol: string;
  exchange: AccountExchange;
  environment: AccountEnvironment;
}

/** One venue pair, in ACTIVE-account order. */
export interface ChartVenueRef {
  exchange: AccountExchange;
  environment: AccountEnvironment;
}

/** One `GET /api/market/venue-symbols` answer (fail-open → `available:false`). */
export interface VenueCatalog extends ChartVenueRef {
  available: boolean;
  symbols: string[];
}

/** One `<optgroup>`: venue-disambiguated label + its alphabetized symbols. */
export interface ChartSymbolGroup extends ChartVenueRef {
  label: string;
  symbols: string[];
}

/** Historic default — also the no-strategies default (rule 3/4 above). */
export const FALLBACK_CHART_SELECTION: ChartSelection = {
  symbol: "PERP_BTC_USDC",
  exchange: "kodiak",
  environment: "mainnet",
};

/** `"lighter"` + `"testnet"` → `"Lighter testnet"` (X1 optgroup labels). */
export const venueLabel = (
  exchange: AccountExchange,
  environment: AccountEnvironment
): string =>
  `${exchange.charAt(0).toUpperCase()}${exchange.slice(1)} ${environment}`;

const uniqueSorted = (symbols: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const symbol of symbols) {
    const key = symbol.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(symbol);
  }
  return out.sort((a, b) => a.localeCompare(b));
};

/**
 * Build the dropdown groups: one per catalog that answered with symbols
 * (unavailable/empty catalogs contribute no group), then a defensive
 * "Strategy symbols" group for symbols no catalog lists — those still need
 * somewhere to render, charted on `orphanVenue` (the first ACTIVE account's
 * venue, or the Kodiak fallback).
 */
export function buildChartSymbolGroups(
  catalogs: VenueCatalog[],
  strategySymbols: string[],
  orphanVenue: ChartVenueRef
): ChartSymbolGroup[] {
  const groups: ChartSymbolGroup[] = [];
  const listed = new Set<string>();
  for (const catalog of catalogs) {
    for (const symbol of catalog.symbols) {
      listed.add(symbol.trim().toUpperCase());
    }
    if (!catalog.available || catalog.symbols.length === 0) continue;
    groups.push({
      label: venueLabel(catalog.exchange, catalog.environment),
      exchange: catalog.exchange,
      environment: catalog.environment,
      symbols: uniqueSorted(catalog.symbols),
    });
  }

  const orphans = uniqueSorted(
    strategySymbols.filter(symbol => !listed.has(symbol.trim().toUpperCase()))
  );
  if (orphans.length > 0) {
    groups.push({
      label: "Strategy symbols",
      exchange: orphanVenue.exchange,
      environment: orphanVenue.environment,
      symbols: orphans,
    });
  }
  return groups;
}

/**
 * The default selection (rules 1–4 in the module doc). `catalogs` must be in
 * ACTIVE-account order — first membership match then wins ties.
 */
export function resolveChartSelection(
  catalogs: VenueCatalog[],
  strategySymbols: string[],
  activeVenues: ChartVenueRef[]
): ChartSelection {
  const first = strategySymbols[0];
  if (first) {
    const wanted = first.trim().toUpperCase();
    for (const catalog of catalogs) {
      if (
        catalog.symbols.some(symbol => symbol.trim().toUpperCase() === wanted)
      ) {
        return {
          symbol: first,
          exchange: catalog.exchange,
          environment: catalog.environment,
        };
      }
    }
    // Not listed anywhere (defensive) → first ACTIVE account's venue.
    const venue = activeVenues[0];
    return venue
      ? {
          symbol: first,
          exchange: venue.exchange,
          environment: venue.environment,
        }
      : { ...FALLBACK_CHART_SELECTION };
  }

  // Rule 3: no strategies → chart BTC on the user's own venue (the historic
  // default symbol, venue-corrected so it renders as a real dropdown option;
  // a Kodiak-only default would be a non-option for a Lighter-only user).
  // No usable catalog → rule 4: the Kodiak fallback exactly as before X3.
  for (const catalog of catalogs) {
    if (!catalog.available || catalog.symbols.length === 0) continue;
    const sorted = uniqueSorted(catalog.symbols);
    const preferred = sorted.find(symbol => {
      const upper = symbol.trim().toUpperCase();
      return upper === "BTC" || upper === "PERP_BTC_USDC";
    });
    return {
      symbol: preferred ?? sorted[0],
      exchange: catalog.exchange,
      environment: catalog.environment,
    };
  }
  return { ...FALLBACK_CHART_SELECTION };
}

/**
 * Option values carry the venue — two venues can list the same raw symbol,
 * so a bare symbol value would make the `<select>` ambiguous (the exact X1
 * duplicate-label trap, one level deeper).
 */
export const encodeChartOption = (selection: ChartSelection): string =>
  `${selection.exchange}|${selection.environment}|${selection.symbol}`;

export const decodeChartOption = (value: string): ChartSelection | null => {
  const [exchange, environment, ...rest] = value.split("|");
  const symbol = rest.join("|");
  if (!symbol) return null;
  if (exchange !== "kodiak" && exchange !== "lighter") return null;
  if (environment !== "testnet" && environment !== "mainnet") return null;
  return { symbol, exchange, environment };
};
