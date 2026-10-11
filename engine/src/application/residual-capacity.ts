/** @format */

/**
 * Engine residual-capacity backstop — pure math, fail-closed (Model A spirit).
 *
 * The backend owns attach-time admission (`existingExposure + pending(STOPPED |
 * STARTING) + incoming ≤ balance × leverage`, see
 * `backend/.../session-cap.provider.ts` + `bot-lifecycle.service.ts`). This
 * module is the engine's INDEPENDENT defense-in-depth re-check on the session
 * start path: even if the backend gate was bypassed, stale, or wrong, the
 * engine refuses to arm runs when the venue account has no residual capacity
 * left for them.
 *
 * Design contract (see the engine backstop scope):
 * - one fail-closed gate at `BotManager.doStartSession`, NOT a per-order or
 *   per-tick gate — the grid sizes orders from `orderQuantity` (base units),
 *   which does not share a unit with `notionalAmount` (USD);
 * - live venue reads through the session's own `ExchangeClient` — no Redis,
 *   no backend round-trip;
 * - pure functions only in this file (no I/O) so every numeric rule is
 *   unit-testable and the gate itself cannot fail open on a network blip —
 *   the caller wraps the venue reads and throws on any failure.
 *
 * KEEP IN SYNC with `backend/src/infrastructure/external/exchange-accounts/
 * session-cap.provider.ts`: leverage default/bound and the exposure row rules
 * must stay identical, or the backend admits something the engine refuses (or
 * worse, the reverse).
 */

/** Product leverage policy default (env-overridable). Keep = backend. */
export const SESSION_CAP_LEVERAGE_DEFAULT = 10;

/**
 * Upper bound for the configured session-cap leverage. Prevents a large
 * `SESSION_CAP_LEVERAGE` from multiplying a total value into `Infinity`
 * (which would make `total > cap` false and silently disable the gate).
 * Keep = backend `SESSION_CAP_LEVERAGE_MAX`.
 */
export const SESSION_CAP_LEVERAGE_MAX = 100;

/**
 * Product leverage policy for the engine cap (env-overridable).
 *
 * Unset/empty → the documented default. A *set but invalid* value throws
 * (fail-closed) rather than silently reverting to the default, so a typo like
 * `"1e999"` or `"0"` surfaces as a refused start, not a disabled cap.
 * Mirrors the backend's `sessionCapLeverage()`.
 */
export function sessionCapLeverage(): number {
  const raw = process.env.SESSION_CAP_LEVERAGE;
  if (raw === undefined || raw === "") return SESSION_CAP_LEVERAGE_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid SESSION_CAP_LEVERAGE "${raw}": must be a positive finite number`
    );
  }
  if (parsed > SESSION_CAP_LEVERAGE_MAX) {
    throw new Error(
      `SESSION_CAP_LEVERAGE ${parsed} exceeds the maximum allowed ${SESSION_CAP_LEVERAGE_MAX}`
    );
  }
  return parsed;
}

/**
 * `Σ |qty × mark|` over one account's open positions — the `existingExposure`
 * half of the gate. Rows arrive venue-agnostic (callers map `position_qty`/
 * `mark_price` from `getPositions()` into `{ qty, mark, symbol }`), which keeps
 * this testable without venue types.
 *
 * FAIL-CLOSED row rules (mirror the backend's `sumPositionExposure`):
 * - a non-zero quantity with a missing/non-numeric/non-positive mark THROWS
 *   (an unpriceable open position must not silently free up headroom);
 * - a non-zero quantity that cannot be parsed THROWS;
 * - flat rows (parsed qty === 0) contribute 0 (venues may include closed rows);
 * - a non-finite total THROWS (IEEE754 overflow guard, mirrors the cap check).
 */
export function sumPositionExposure(
  rows: ReadonlyArray<{
    qty: unknown;
    mark: unknown;
    symbol?: string;
  }>
): number {
  let exposure = 0;
  for (const row of rows) {
    const qty =
      typeof row.qty === "string"
        ? parseFloat(row.qty)
        : row.qty === null || row.qty === undefined
          ? Number.NaN
          : Number(row.qty);
    if (!Number.isFinite(qty)) {
      throw new Error(
        `Open position (market ${row.symbol ?? "unknown"}) has an unparseable quantity (${String(row.qty)}); cannot compute exposure`
      );
    }
    if (qty === 0) continue; // flat row — no exposure contribution
    const mark =
      typeof row.mark === "string"
        ? parseFloat(row.mark)
        : row.mark === null || row.mark === undefined
          ? Number.NaN
          : Number(row.mark);
    if (!Number.isFinite(mark) || mark <= 0) {
      throw new Error(
        `Open position (market ${row.symbol ?? "unknown"}) has a missing or invalid mark price (${String(row.mark)}); cannot price exposure`
      );
    }
    exposure += Math.abs(qty * mark);
  }
  if (!Number.isFinite(exposure)) {
    throw new Error("Computed venue exposure is not a finite number");
  }
  return exposure;
}

/**
 * `Σ run.notionalAmount` — the session's declared intent (what the backend
 * already admits as `incoming`/`pending`). FAIL-CLOSED: a run whose notional
 * is missing, non-numeric, or non-positive is *unknown intent* — never assume
 * zero size, or a malformed payload could arm an ungated session. The backend
 * only ever dispatches positive notionals, so this refuses on bugs/malice,
 * not on legitimate traffic.
 */
export function sessionRequestedNotional(
  runs: ReadonlyArray<{
    runId?: string;
    notionalAmount: unknown;
  }>
): number {
  let total = 0;
  for (const run of runs) {
    const notional =
      typeof run.notionalAmount === "string"
        ? Number(run.notionalAmount)
        : run.notionalAmount === null || run.notionalAmount === undefined
          ? Number.NaN
          : Number(run.notionalAmount);
    if (!Number.isFinite(notional) || notional <= 0) {
      throw new Error(
        `Session run ${run.runId ?? "unknown"} declares a missing or non-positive notional (${String(run.notionalAmount)}); refusing to start against unknown intent`
      );
    }
    total += notional;
  }
  if (!Number.isFinite(total)) {
    throw new Error(
      "Summed session notional is not a finite number; refusing to start"
    );
  }
  return total;
}

/** Inputs to the final gate comparison. All are numbers already parsed. */
export interface ResidualCapacityInput {
  /** `Σ |qty × mark|` over the account's open venue positions. */
  exposure: number;
  /** `Σ run.notionalAmount` — this session's declared notionals. */
  requested: number;
  /** Venue account equity (`getAccountInfo().total_value`). */
  totalValue: number;
  /** Product leverage policy (`SESSION_CAP_LEVERAGE`). */
  leverage: number;
}

/** Format a dollar figure for an ops-readable refusal message. */
function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * The Model A spirit gate: `exposure + requested ≤ totalValue × leverage`.
 *
 * FAIL-CLOSED on every input: a non-finite/non-positive total value, an
 * invalid leverage, a negative/NaN exposure or requested, or a cap that
 * overflows to `Infinity` all throw instead of letting the start through —
 * admitting against an unknown capacity is exactly what this backstop exists
 * to prevent. The over-cap message is ops-readable and keeps the three numbers
 * an operator needs (exposure, session, cap).
 */
export function assertEngineResidualCapacity({
  exposure,
  requested,
  totalValue,
  leverage,
}: ResidualCapacityInput): void {
  if (!Number.isFinite(exposure) || exposure < 0) {
    throw new Error(
      `Venue exposure is not a non-negative finite number (${exposure}); cannot verify residual capacity`
    );
  }
  if (!Number.isFinite(requested) || requested < 0) {
    throw new Error(
      `Session notional is not a non-negative finite number (${requested}); cannot verify residual capacity`
    );
  }
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    throw new Error(
      `Account total value is not a positive finite number (${totalValue}); cannot compute the engine session cap (fail-closed)`
    );
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new Error(
      `Session-cap leverage is not a positive finite number (${leverage}); cannot compute the engine session cap (fail-closed)`
    );
  }
  const cap = totalValue * leverage;
  // Belt-and-suspenders: even with a bounded leverage, an extreme total value
  // could overflow. A non-finite cap would make `total > cap` false and
  // silently disable the gate — refuse instead.
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(
      `Computed engine session cap is not a positive finite number (totalValue=${totalValue}, leverage=${leverage}); fail-closed`
    );
  }
  if (exposure + requested > cap) {
    throw new Error(
      `Engine residual capacity exceeded: exposure ${usd(exposure)} + session ${usd(requested)} > cap ${usd(cap)} (total value ${usd(totalValue)} × leverage ${leverage})`
    );
  }
}
