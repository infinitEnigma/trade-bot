/** @format */

/**
 * derivePriceFormat (Phase 3.1, review P1-2): bounded price precision for a
 * chart series.
 *
 * The chart was pinned to precision 2 / minMove 0.01 — fine-priced markets
 * (PERP_1000PEPE_USDC, quote_tick 1e-7) rendered distinct prices as the same
 * rounded value, which is misleading for order placement and monitoring. The
 * authoritative venue tick (Kodiak `quote_tick`, Lighter
 * `supported_price_decimals` — engine readers exist) is not exposed to the
 * frontend yet; deriving the format from the prices actually ON SCREEN —
 * candles AND order-level prices — is the display-grade fix, bounded so a
 * single outlier can never blow up the axis. The backend metadata endpoint is
 * the documented follow-up for venue-grid-exact labels.
 *
 * Rules:
 * - precision = max decimal digits needed across the inputs, clamped to
 *   [2, 8] (8 covers the live 1e-7 tick with room);
 * - minMove = 10 ** -precision;
 * - scientific notation is normalized (1e-7 → 0.0000001 → 7 digits);
 * - no usable input → the historic { precision: 2, minMove: 0.01 } fallback.
 */

export const MIN_PRICE_PRECISION = 2;
export const MAX_PRICE_PRECISION = 8;

export interface ChartPriceFormat {
  precision: number;
  minMove: number;
}

/** Decimal digits `value` needs, normalized; 0 when unusable (non-finite). */
function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // toFixed(MAX) never emits scientific notation; trailing zeros are noise.
  const fixed = Math.abs(value).toFixed(MAX_PRICE_PRECISION);
  const [, fraction = ""] = fixed.split(".");
  return fraction.replace(/0+$/, "").length;
}

export function derivePriceFormat(
  prices: Array<number | null | undefined>
): ChartPriceFormat {
  let precision = 0;
  for (const price of prices) {
    if (price == null) continue;
    precision = Math.max(precision, decimalsOf(price));
  }
  const bounded = Math.min(
    MAX_PRICE_PRECISION,
    Math.max(MIN_PRICE_PRECISION, precision)
  );
  return { precision: bounded, minMove: 10 ** -bounded };
}
