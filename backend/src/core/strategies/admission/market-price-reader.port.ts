/** @format */

/**
 * Admission market-price reader — the backend's AUTHORITATIVE price for a
 * grid admission decision.
 *
 * Why this exists: the engine reports a grid's exposure estimate, computed
 * from the price IT saw. The backend must not trust that number — it
 * recomputes the exposure from the PERSISTED config and its own price. That
 * price has to come from the right venue, the right environment and the right
 * instrument, and it has to be FRESH: admitting against a stale or mismatched
 * quote is admitting against an unknown capacity.
 *
 * Contract:
 * - The caller supplies the FULL instrument identity — the bound account's
 *   venue + environment and the persisted strategy symbol. The reader resolves
 *   the venue's own instrument mapping (never a bare "BTC" guess).
 * - The reader returns the resolved identity alongside the price, so the
 *   admission service can prove the price belongs to the instrument it is
 *   admitting.
 * - Freshness is explicit: the result carries the source timestamp (or the
 *   age of the quote). A reader that cannot prove freshness FAILS — it never
 *   returns a figure it cannot vouch for.
 *
 * Venue adapters implement this (Kodiak / Lighter); the admission service
 * stays venue-agnostic.
 */

/** The venue the price was read from. */
export type AdmissionVenue = "kodiak" | "lighter";

/** The venue environment the price was read from. */
export type AdmissionEnvironment = "testnet" | "mainnet";

/** A price read for one fully-resolved instrument. */
export interface AdmissionMarketPrice {
  /** The venue the price came from. */
  venue: AdmissionVenue;
  /** The environment the price came from. */
  environment: AdmissionEnvironment;
  /**
   * The venue-native instrument the symbol resolved to (e.g. Lighter's
   * `market_id` as a number, Kodiak's `PERP_BTC_USDC`). Recorded so the
   * admission can prove WHICH instrument was priced — a bare symbol is not
   * an identity.
   */
  resolvedInstrument: string;
  /** The price the venue reports for that instrument. */
  price: number;
  /**
   * When the quote was produced by the venue (unix ms), when the reader can
   * attest to it. `null` means the venue does not timestamp the quote — the
   * admission service then treats the read time as the only freshness
   * evidence and applies its own age budget from the read moment.
   */
  sourceTimestampMs: number | null;
  /** When THIS reader performed the read (unix ms) — always present. */
  readAtMs: number;
}

/** What the reader was asked for. */
export interface AdmissionPriceRequest {
  venue: AdmissionVenue;
  environment: AdmissionEnvironment;
  /**
   * The persisted strategy symbol, exactly as the strategy stores it. The
   * reader maps it through the venue's own catalog — it never guesses.
   */
  symbol: string;
}

export interface IMarketPriceReader {
  /**
   * Read the authoritative price for one instrument.
   *
   * Implementations THROW when the price cannot be established (venue down,
   * symbol not listed, unpriceable response). They never return a sentinel,
   * a zero, or a stale fallback — the caller treats a throw as "no admission".
   */
  readPrice(request: AdmissionPriceRequest): Promise<AdmissionMarketPrice>;
}
