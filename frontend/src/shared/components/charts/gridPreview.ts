/** @format */

/**
 * Grid preview geometry — the levels the strategy form's fields will build.
 *
 * Display-only: nothing here moves money or decides a fill. It exists so the
 * operator can SEE the configured grid while editing (F5) instead of
 * committing to a shape they cannot picture.
 *
 * Geometry mirrors the engine's `buildLevels` (`engine/src/strategies/grid.ts`):
 * a band of `center ± center·range%/2`, with `gridSize + 1` levels spaced
 * evenly across it (level 0 at the bottom, level `gridSize` exactly at the
 * top). Two deliberate differences:
 *
 *  1. NO tick quantization. The engine snaps every level to the market's tick
 *     at start (`quantizePriceNumber`, outer edges snapped inward so no level
 *     can leave the authorised band) and refuses to start when the quantized
 *     levels collapse. The preview therefore shows the band geometrically but
 *     not tick-exactly: the real grid can be a few ticks off, and an extreme
 *     config that the engine will REFUSE to start can still be drawn here.
 *     The chart's own price format handles display precision.
 *  2. NO centre-price authority. The caller passes the price the band should
 *     be centred on (the charted market's mark price, else the last candle
 *     close) — the engine re-derives its centre from the market snapshot at
 *     start, so a price move between preview and start shifts the real band.
 *
 * Bounds and defaults mirror `resolveGridConfig` (`engine/src/strategies/
 * grid-config.ts`): gridSize integer 2–100 (default 10), gridRange 1–50
 * (default 5). That resolver is the authority — if it ever changes, this copy
 * must change with it. An input outside those bounds (or a symbol-less or
 * non-positive centre) yields `null`: the caller draws nothing rather than
 * previewing a grid the engine would refuse to build.
 */

/** Mirrors `MIN_GRID_SIZE` — a 1-level "grid" has no step and no exit. */
export const MIN_GRID_SIZE = 2;
/** Mirrors `MAX_GRID_SIZE`. */
export const MAX_GRID_SIZE = 100;
/** Mirrors the backend/frontend floor for the band width. */
export const MIN_GRID_RANGE_PERCENT = 1;
/** Mirrors `MAX_GRID_RANGE_PERCENT`. */
export const MAX_GRID_RANGE_PERCENT = 50;
/** Mirrors `DEFAULT_GRID_SIZE` — applied when the field is left empty. */
export const DEFAULT_GRID_SIZE = 10;
/** Mirrors `DEFAULT_GRID_RANGE_PERCENT` — applied when the field is empty. */
export const DEFAULT_GRID_RANGE_PERCENT = 5;

/** The form fields the preview needs (symbol + venue for attribution). */
export interface GridPreviewInput {
  symbol: string;
  /** Venue exchange (migration 026). Absent = legacy unknown → withhold band. */
  exchange?: "kodiak" | "lighter" | null;
  /** Venue environment (migration 026). Absent = legacy unknown → withhold band. */
  environment?: "testnet" | "mainnet" | null;
  gridSize?: number;
  gridRange?: number;
}

/** One drawn level. */
export interface GridPreviewLevel {
  price: number;
  /** Price-axis label — `G0`…`Gn`, so levels stay readable at any count. */
  label: string;
}

export interface GridPreview {
  /** The price the band is centred on (mark price, else the last close). */
  center: number;
  /** Inclusive band edges — `levels[0].price` / `levels[n].price`. */
  bandBottom: number;
  bandTop: number;
  /** Distance between two adjacent levels. */
  spacing: number;
  gridSize: number;
  gridRange: number;
  /** `gridSize + 1` levels, bottom → top. */
  levels: GridPreviewLevel[];
}

/**
 * The levels a grid config will build around `center`, or `null` when the
 * input cannot produce one (see the module doc).
 */
export function computeGridPreview(
  center: number,
  input: GridPreviewInput
): GridPreview | null {
  if (!input.symbol || !input.symbol.trim()) return null;
  if (!Number.isFinite(center) || center <= 0) return null;

  const gridSize = input.gridSize ?? DEFAULT_GRID_SIZE;
  const gridRange = input.gridRange ?? DEFAULT_GRID_RANGE_PERCENT;
  if (!Number.isInteger(gridSize)) return null;
  if (gridSize < MIN_GRID_SIZE || gridSize > MAX_GRID_SIZE) return null;
  if (!Number.isFinite(gridRange)) return null;
  if (
    gridRange < MIN_GRID_RANGE_PERCENT ||
    gridRange > MAX_GRID_RANGE_PERCENT
  ) {
    return null;
  }

  const halfBand = (center * gridRange) / 100 / 2;
  const bandBottom = center - halfBand;
  const bandTop = center + halfBand;
  const spacing = (bandTop - bandBottom) / gridSize;

  const levels: GridPreviewLevel[] = [];
  for (let i = 0; i <= gridSize; i += 1) {
    levels.push({ price: bandBottom + i * spacing, label: `G${i}` });
  }

  return { center, bandBottom, bandTop, spacing, gridSize, gridRange, levels };
}
