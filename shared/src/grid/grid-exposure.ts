/** @format */

/**
 * Grid exposure calculator — the ONE implementation of the grid's resting
 * exposure rules, shared by the engine (which reports it) and the backend
 * (which recomputes it independently and enforces admission against it).
 *
 * Why this exists: the engine prices a grid from its resolved config + the live
 * venue price; the backend must NOT trust that number. It recomputes the same
 * quantity from the PERSISTED config and its OWN validated price, then
 * cross-checks the engine's report. Two implementations of the same rule would
 * drift, and drift here is a risk-control failure — so the rule lives here.
 *
 * The rules mirrored here are the engine's, audited against
 * `engine/src/strategies/grid.ts`:
 *
 * 1. LEVELS — `buildLevels` builds `gridSize + 1` prices evenly spaced across
 *    the band `baseline ± baseline·range%/2`:
 *
 *        P_i = baseline · (1 − range/2 + i·range/gridSize),  i = 0…gridSize
 *
 *    The engine then snaps the band edges inward to the market tick and every
 *    intermediate level down to a tick multiple. Tick quantization is NOT
 *    reproduced here — it is venue-specific and lives with the price
 *    acquisition (outside this pure calculator). The backend therefore
 *    compares the engine's reported total against this value with an explicit
 *    numerical tolerance (the tick snapping moves levels by < 1 tick each).
 *
 * 2. BUY ELIGIBILITY — the tick arms a BUY at a level when
 *    `currentPrice <= level.price` (the price has fallen to/through that level)
 *    AND no side order is already live on that level. At preparation time no
 *    order exists yet, so eligibility reduces to the price comparison.
 *
 * 3. NOTIONAL — each eligible level commits `orderQuantity` units at that
 *    level's price:
 *
 *        orderNotional_i = orderQuantity · P_i
 *        estimatedRestingNotional = Σ orderNotional_i   (over eligible levels)
 *
 * SELL levels are reduce-only exits of already-filled inventory, so they add
 * NO resting exposure.
 *
 * All arithmetic here is plain IEEE-754 double, matching the engine's own
 * float math exactly — the two sides must agree bit-for-bit on the same
 * inputs, and the engine computes its levels in doubles too. Decimal-safe
 * arithmetic is deliberately NOT introduced here: it would make the engine's
 * own float result and the backend's decimal result differ in the last bits,
 * which is exactly the drift this module exists to eliminate.
 */

/** Grid geometry + sizing, as resolved by the engine's `resolveGridConfig`. */
export interface GridExposureConfig {
  /** Number of grid steps; the engine builds `gridSize + 1` levels. */
  gridSize: number;
  /** Band width in PERCENT (e.g. 5 = ±2.5% around the baseline). */
  gridRangePercent: number;
  /** Base-unit size of ONE order (BTC, ETH, ... — not USD). */
  orderQuantity: number;
}

/** One grid level's exposure contribution. */
export interface GridExposureLevel {
  /** Index of the level in the grid (0 = bottom). */
  index: number;
  /** The level's price. */
  price: number;
  /** `orderQuantity · price` — the notional this level commits if it rests. */
  orderNotional: number;
  /** True when the engine's tick would arm a resting BUY at this level. */
  buyEligible: boolean;
}

/** The full exposure picture for one grid at one baseline price. */
export interface GridExposureResult {
  /** Every level, bottom to top. */
  levels: GridExposureLevel[];
  /** Levels eligible to rest a BUY (the exposure-bearing ones). */
  buyLevels: GridExposureLevel[];
  /** Σ orderNotional over the eligible BUY levels. */
  estimatedRestingNotional: number;
  /** The largest single orderNotional among the eligible BUY levels. */
  maxOrderNotional: number;
  /** The baseline price the band was built around. */
  baselinePrice: number;
}

/**
 * Validate the inputs. Fail-closed: a non-finite or out-of-bounds input
 * throws rather than producing a plausible-looking exposure figure.
 */
function assertValidConfig(config: GridExposureConfig): void {
  if (!Number.isInteger(config.gridSize) || config.gridSize < 1) {
    throw new Error(
      `gridSize must be an integer >= 1 (got ${String(config.gridSize)})`
    );
  }
  if (
    !Number.isFinite(config.gridRangePercent) ||
    config.gridRangePercent <= 0
  ) {
    throw new Error(
      `gridRangePercent must be a positive finite number (got ${String(config.gridRangePercent)})`
    );
  }
  if (!Number.isFinite(config.orderQuantity) || config.orderQuantity <= 0) {
    throw new Error(
      `orderQuantity must be a positive finite number (got ${String(config.orderQuantity)})`
    );
  }
}

/**
 * The grid's level prices for a baseline price — the even spacing of
 * `buildLevels`, before tick quantization.
 *
 * Mirrors the engine exactly: `bandMin = baseline − baseline·range/2`,
 * `bandMax = baseline + baseline·range/2`, `spacing = (bandMax − bandMin)/N`,
 * `P_i = bandMin + i·spacing`.
 */
export function computeGridLevelPrices(
  baselinePrice: number,
  config: GridExposureConfig
): number[] {
  if (!Number.isFinite(baselinePrice) || baselinePrice <= 0) {
    throw new Error(
      `baselinePrice must be a positive finite number (got ${String(baselinePrice)})`
    );
  }
  assertValidConfig(config);

  const halfBand = (baselinePrice * config.gridRangePercent) / 100 / 2;
  const bandBottom = baselinePrice - halfBand;
  const bandTop = baselinePrice + halfBand;
  const spacing = (bandTop - bandBottom) / config.gridSize;

  const prices: number[] = [];
  for (let i = 0; i <= config.gridSize; i += 1) {
    prices.push(bandBottom + i * spacing);
  }
  return prices;
}

/**
 * Compute the grid's resting exposure at a baseline price.
 *
 * `currentPrice` is the mark price the engine compares levels against. At
 * preparation time it equals the baseline (the engine builds the band around
 * the current price), but it is a separate parameter because the engine's tick
 * compares against the LIVE mark, which may have moved since initialization.
 *
 * @param baselinePrice the price the band is built around
 * @param currentPrice  the mark price the BUY arming rule compares against
 * @param config        the resolved grid geometry + sizing
 */
export function computeGridExposure(
  baselinePrice: number,
  currentPrice: number,
  config: GridExposureConfig
): GridExposureResult {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(
      `currentPrice must be a positive finite number (got ${String(currentPrice)})`
    );
  }
  const prices = computeGridLevelPrices(baselinePrice, config);

  const levels: GridExposureLevel[] = prices.map((price, index) => ({
    index,
    price,
    orderNotional: config.orderQuantity * price,
    // The engine's BUY arming condition, minus the "no live order" clause
    // (nothing is live at preparation time).
    buyEligible: currentPrice <= price,
  }));

  const buyLevels = levels.filter(level => level.buyEligible);
  const estimatedRestingNotional = buyLevels.reduce(
    (sum, level) => sum + level.orderNotional,
    0
  );
  const maxOrderNotional = buyLevels.reduce(
    (max, level) => (level.orderNotional > max ? level.orderNotional : max),
    0
  );

  return {
    levels,
    buyLevels,
    estimatedRestingNotional,
    maxOrderNotional,
    baselinePrice,
  };
}

/**
 * Relative difference between two figures, for tolerance comparisons.
 *
 * Returns `Infinity` when either side is not a finite number, so a NaN or
 * Infinity on either side always FAILS a tolerance check (never silently
 * passes). When both are zero the difference is exactly 0.
 */
export function relativeDifference(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 0;
  return Math.abs(a - b) / scale;
}

/**
 * Whether two figures agree within a relative tolerance.
 *
 * Used to cross-check the engine's reported estimate against the backend's
 * independent recomputation. `tolerance` is a RELATIVE fraction (e.g. 0.001
 * = 0.1%).
 */
export function agreesWithin(
  a: number,
  b: number,
  tolerance: number
): boolean {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      `tolerance must be a non-negative finite number (got ${String(tolerance)})`
    );
  }
  return relativeDifference(a, b) <= tolerance;
}
