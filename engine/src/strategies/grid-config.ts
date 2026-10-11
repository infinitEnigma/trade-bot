/** @format */

/**
 * Grid strategy configuration validation (Phase 4).
 *
 * Single application-boundary resolver that turns a raw `Record<string,
 * unknown>` run config into a `GridStrategyConfig`. The old `Number(x) ||
 * default` coercion conflated three different things — a missing value, an
 * invalid value, and `0` — and silently substituted defaults, so `-5` survived
 * as a live grid size and `"abc"` became `10`. Here a *missing* numeric field
 * keeps its historical default (legacy commands omit params), but an
 * *explicitly present yet uncoercible/invalid* value throws `CommandError`
 * (non-retryable) instead of trading on a substituted guess.
 *
 * Bounds mirror the backend Joi contract (`strategies.ts`: gridSize 2–100,
 * gridRange 1–50, orderQuantity/takeProfit positive) plus the frontend zod
 * schema, so the engine can never be stricter-or-looser by accident. The
 * engine is the authority: frontend/backend checks are UX/admission feedback,
 * this resolver is what forbids the strategy from starting.
 *
 * Symbol support (venue catalog) stays the backend's gate — the engine checks
 * non-empty only, since it is venue-agnostic by design.
 */

import { CommandError } from "../application/command-error";
import { GridStrategyConfig } from "../types/strategy";

/** Documented maximums shared with the backend/frontend validation surface. */
export const MAX_GRID_SIZE = 100;
export const MAX_GRID_RANGE_PERCENT = 50;

/** Minimum grid size: a 1-level "grid" has no step and no exit above entry. */
export const MIN_GRID_SIZE = 2;

export const DEFAULT_GRID_SIZE = 10;
export const DEFAULT_GRID_RANGE_PERCENT = 5;
export const DEFAULT_ORDER_QUANTITY = 1;

/**
 * Coerce one numeric field from a raw run config.
 *
 * - `undefined`/`null`/`""` → absent (caller applies the default).
 * - numbers and numeric strings → `Number(value)`.
 * - anything else (non-numeric strings, booleans, objects, NaN) → throws.
 */
function coerceNumber(
  raw: Record<string, unknown>,
  key: string,
  label: string
): number | undefined {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") {
    throw new CommandError(
      false,
      `Invalid grid config: ${label} must be a finite number (got ${JSON.stringify(value)})`
    );
  }
  const coerced = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(coerced)) {
    throw new CommandError(
      false,
      `Invalid grid config: ${label} must be a finite number (got ${JSON.stringify(value)})`
    );
  }
  return coerced;
}

/** Assert `value` lies in `[min, max]`. */
function assertInRange(
  label: string,
  value: number,
  min: number,
  max: number
): void {
  if (value < min || value > max) {
    throw new CommandError(
      false,
      `Invalid grid config: ${label} must be in ${min}–${max} (got ${value})`
    );
  }
}

/**
 * Resolve a raw run config into a validated `GridStrategyConfig`.
 *
 * Missing numeric fields keep their historical defaults; any explicitly
 * present but invalid field (negative grid size, zero quantity, NaN range,
 * empty symbol, non-positive take-profit) throws `CommandError(false, …)`
 * and the session refuses to start with zero runners armed.
 *
 * @param raw the run-level config (`spec.config ?? config` at the call site),
 *   using the engine's raw key spellings (`gridRange`, `takeProfit`).
 */
export function resolveGridConfig(
  raw: Record<string, unknown>
): GridStrategyConfig {
  const symbol = String(raw.symbol ?? "").trim();
  if (!symbol) {
    throw new CommandError(false, "Strategy config is missing symbol");
  }

  const gridSize =
    coerceNumber(raw, "gridSize", "gridSize") ?? DEFAULT_GRID_SIZE;
  if (!Number.isInteger(gridSize)) {
    throw new CommandError(
      false,
      `Invalid grid config: gridSize must be an integer (got ${gridSize})`
    );
  }
  assertInRange("gridSize", gridSize, MIN_GRID_SIZE, MAX_GRID_SIZE);

  const gridRangePercent =
    coerceNumber(raw, "gridRange", "gridRange") ?? DEFAULT_GRID_RANGE_PERCENT;
  assertInRange("gridRange", gridRangePercent, 1, MAX_GRID_RANGE_PERCENT);

  const orderQuantity =
    coerceNumber(raw, "orderQuantity", "orderQuantity") ??
    DEFAULT_ORDER_QUANTITY;
  if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) {
    throw new CommandError(
      false,
      `Invalid grid config: orderQuantity must be a finite positive number (got ${orderQuantity})`
    );
  }

  const takeProfit = coerceNumber(raw, "takeProfit", "takeProfit");
  let takeProfitPercent: number | undefined;
  if (takeProfit !== undefined) {
    if (takeProfit <= 0) {
      throw new CommandError(
        false,
        `Invalid grid config: takeProfit must be positive when supplied (got ${takeProfit})`
      );
    }
    takeProfitPercent = takeProfit;
  }

  return {
    symbol,
    gridSize,
    gridRangePercent,
    orderQuantity,
    takeProfitPercent,
  };
}

/**
 * Engine-side safety invariant: every `GridStrategyConfig` that reaches the
 * strategy must already be valid. `BotManager` resolves through
 * `resolveGridConfig`, but direct construction (tests, future call sites)
 * must not be able to smuggle an invalid geometry past the boundary — a bad
 * config here would otherwise build a nonsensical or empty grid.
 */
export function assertValidGridConfig(config: GridStrategyConfig): void {
  if (!config.symbol || !config.symbol.trim()) {
    throw new CommandError(false, "Strategy config is missing symbol");
  }
  if (!Number.isInteger(config.gridSize)) {
    throw new CommandError(
      false,
      `Invalid grid config: gridSize must be an integer (got ${config.gridSize})`
    );
  }
  assertInRange("gridSize", config.gridSize, MIN_GRID_SIZE, MAX_GRID_SIZE);
  assertInRange(
    "gridRangePercent",
    config.gridRangePercent,
    1,
    MAX_GRID_RANGE_PERCENT
  );
  if (!Number.isFinite(config.orderQuantity) || config.orderQuantity <= 0) {
    throw new CommandError(
      false,
      `Invalid grid config: orderQuantity must be a finite positive number (got ${config.orderQuantity})`
    );
  }
  if (
    config.takeProfitPercent !== undefined &&
    (!Number.isFinite(config.takeProfitPercent) ||
      config.takeProfitPercent <= 0)
  ) {
    throw new CommandError(
      false,
      `Invalid grid config: takeProfitPercent must be positive when supplied (got ${config.takeProfitPercent})`
    );
  }
}
