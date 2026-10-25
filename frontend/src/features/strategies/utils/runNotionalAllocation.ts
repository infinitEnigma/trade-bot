/** @format */

/**
 * Parse a single run's `notional_amount` string into a validated non-negative
 * finite number.
 *
 * Rejects the JavaScript coercion pitfalls explicitly:
 * - `Number("")` === 0 → empty strings are **invalid** (not a real zero).
 * - `Number(null)` === 0 → null is **invalid**.
 * - `Number(undefined)` → NaN → **invalid**.
 * - Whitespace-only is trimmed before parsing → invalid.
 * - Negative, NaN, Infinity, -Infinity → invalid.
 *
 * A valid zero (`"0"`, `" 0 "`, etc.) is preserved.
 */
export function parseNotionalAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  // Coerce non-string values (e.g. a number coming straight off the wire) to
  // string before trimming — `.trim()` does not exist on numbers and would
  // throw "X.trim is not a function", crashing the Strategies page.
  const str = typeof value === "string" ? value : String(value);
  const trimmed = str.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export interface RunNotionalAllocationResult {
  /** `true` if at least one run was iterated (regardless of validity). */
  hasRuns: boolean;
  /** `true` if any run's notional is invalid, missing, or negative. */
  hasInvalid: boolean;
  /** `true` if the running sum became non-finite (overflow). */
  overflow: boolean;
  /** The all-or-nothing sum, or `null` when an aggregate is not available. */
  total: number | null;
  /** Number of valid runs that contributed to `total`. */
  count: number;
}

export function computeRunNotionalAllocation(
  bots: Array<{ runs?: Array<{ notional_amount: unknown }> }>
): RunNotionalAllocationResult {
  let total = 0;
  let count = 0;
  let hasRuns = false;
  let hasInvalid = false;

  for (const bot of bots) {
    const runs = bot.runs ?? [];
    for (const run of runs) {
      hasRuns = true;
      const parsed = parseNotionalAmount(run.notional_amount);
      if (parsed === null) {
        hasInvalid = true;
        continue;
      }
      total += parsed;
      count += 1;
    }
  }

  // All-or-nothing: if any run is invalid, the aggregate is unavailable.
  // Overflow is also an aggregate-level failure (never show a partial sum).
  if (hasInvalid || !Number.isFinite(total)) {
    return {
      hasRuns,
      hasInvalid: hasInvalid || !Number.isFinite(total),
      overflow: !Number.isFinite(total),
      total: null,
      count: 0,
    };
  }

  return { hasRuns, hasInvalid: false, overflow: false, total, count };
}
