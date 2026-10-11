/** @format */

/**
 * Symbol normalization + matching, shared by every path that has to decide
 * whether a venue-reported symbol is the one a bot actually trades.
 *
 * Venues are inconsistent about case and separators (`ETH_PERP`,
 * `ETH-PERP`, ` eth_perp `), and matching is always a *safety* decision:
 * get it wrong one way and a recovery gate ignores real exposure, get it
 * wrong the other way and a flatten closes the wrong market. So this is the
 * single normalization both the grid recovery gate and the emergency flatten
 * use — never a per-call inline comparison that can drift.
 *
 * The comparison is deliberately **conservative**: case/whitespace only. It
 * does not try to reconcile different separator conventions or suffixes,
 * because a venue symbol format we do not recognize must resolve to "not a
 * match" (skip / fail closed) rather than a guessed match. A caller that
 * needs looser matching must first map the venue symbol to the configured
 * form at the adapter boundary.
 */
export function normalizeSymbol(symbol: string): string {
  return String(symbol ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Does a venue-reported symbol identify the same market as the configured
 * symbol? Case/whitespace-insensitive only — an unknown format must not match
 * (see the module doc: a false positive here can close the wrong market).
 */
export function symbolsMatch(
  venueSymbol: string,
  configSymbol: string
): boolean {
  return normalizeSymbol(venueSymbol) === normalizeSymbol(configSymbol);
}
