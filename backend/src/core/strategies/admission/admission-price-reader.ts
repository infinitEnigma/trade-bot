/** @format */

/**
 * Venue-dispatching admission price reader.
 *
 * Keeps the admission service venue-agnostic: it asks for a price for a
 * fully-resolved instrument (venue + environment + symbol) and this adapter
 * routes it to the venue's own reader.
 *
 * The venue readers are injected so the admission service's tests never reach
 * the network, and so an unsupported venue FAILS (a bare "BTC" is not an
 * instrument — pricing it against the wrong venue would admit a run against
 * an unknown capacity).
 */

import type {
  AdmissionMarketPrice,
  AdmissionPriceRequest,
  IMarketPriceReader,
} from "./market-price-reader.port";

export interface VenuePriceReaders {
  kodiak: IMarketPriceReader;
  lighter: IMarketPriceReader;
}

/**
 * Build the dispatching reader over the venue readers.
 *
 * An unsupported venue THROWS — never a sentinel price.
 */
export function createAdmissionPriceReader(
  readers: VenuePriceReaders
): IMarketPriceReader {
  return {
    async readPrice(
      request: AdmissionPriceRequest
    ): Promise<AdmissionMarketPrice> {
      const reader = readers[request.venue];
      if (!reader) {
        throw new Error(
          `No admission price reader for venue "${request.venue}" — cannot price the admission`
        );
      }
      const price = await reader.readPrice(request);
      // Defence in depth: the reader's answer must match the instrument that
      // was asked for. A reader that answered for another venue/environment
      // must never be allowed to admit this run.
      if (price.venue !== request.venue) {
        throw new Error(
          `Admission price reader answered for venue "${price.venue}" but "${request.venue}" was requested`
        );
      }
      if (price.environment !== request.environment) {
        throw new Error(
          `Admission price reader answered for environment "${price.environment}" but "${request.environment}" was requested`
        );
      }
      if (!Number.isFinite(price.price) || price.price <= 0) {
        throw new Error(
          `Admission price reader returned a non-positive price (${price.price})`
        );
      }
      return price;
    },
  };
}
