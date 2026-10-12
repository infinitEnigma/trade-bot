/** @format */

/**
 * Lighter tick-size derivation (Phase B).
 *
 * The venue exposes no `quote_tick` field; the authoritative precision is
 * `supported_price_decimals` from `orderBookDetails`. Tick = 10^-decimals
 * as a decimal string (`2` -> `"0.01"`). String at the boundary so the
 * quantizer never sees float error.
 */

import { CommandError } from "../../application/command-error";

export function tickSizeFromPriceDecimals(priceDecimals: number): string {
  if (
    !Number.isInteger(priceDecimals) ||
    priceDecimals < 0 ||
    priceDecimals > 12
  ) {
    throw new CommandError(
      false,
      `Invalid Lighter supported_price_decimals ${JSON.stringify(priceDecimals)} (expected integer 0-12; refusing to guess tick)`
    );
  }
  if (priceDecimals === 0) return "1";
  return `0.${"0".repeat(priceDecimals - 1)}1`;
}
