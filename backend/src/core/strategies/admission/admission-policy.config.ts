/** @format */

/**
 * Admission policy configuration — the per-order notional limits and the
 * freshness/tolerance budgets, read from the process environment.
 *
 * THE PER-ORDER POLICY IS UNSET BY DEFAULT, ON PURPOSE.
 *
 * A per-order notional limit is a financial risk control, and an
 * undocumented assumption must not become an operational policy just because
 * it was convenient during implementation. So there is NO default cap: with
 * no configured limit the admission FAILS CLOSED with
 * `POLICY_NOT_CONFIGURED` and no grid can be authorized until an operator
 * explicitly configures one.
 *
 * The proposed values below are DOCUMENTATION, not configuration. They are
 * deliberately left commented out so nobody can enable them by accident:
 *
 *   // PROPOSED (DRAFT — requires review before activation):
 *   //   BTC -> 5000 USD per order
 *   //   ETH -> 5000 USD per order
 *
 * Note this is a DIFFERENT control from the F1 account-wide exposure cap
 * (`SESSION_CAP_LEVERAGE`): configuring one does not imply the other is
 * configured or satisfied.
 */

import {
  createSymbolNotionalPolicy,
  type ISymbolNotionalPolicy,
  type SymbolNotionalPolicyLimits,
} from "./symbol-notional-policy.port";
import type { GridAdmissionPolicy } from "./grid-admission.service";

/**
 * Parse a per-symbol cap map from the environment.
 *
 * Format: `SYMBOL=AMOUNT` pairs separated by commas —
 * `MAX_ORDER_NOTIONAL_BY_SYMBOL=BTC=5000,ETH=2500`.
 *
 * An UNSET variable yields an EMPTY map (no cap configured → fail closed).
 * A SET but malformed variable THROWS: a typo in a risk control must surface
 * as an operational error, not as a silently disabled check.
 */
export function parseMaxOrderNotionalBySymbol(
  raw: string | undefined
): Record<string, number> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return {};

  const caps: Record<string, number> = {};
  for (const pair of trimmed.split(",")) {
    const entry = pair.trim();
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(
        `Invalid MAX_ORDER_NOTIONAL_BY_SYMBOL entry "${entry}" — expected SYMBOL=AMOUNT`
      );
    }
    const symbol = entry.slice(0, separator).trim().toUpperCase();
    const amountRaw = entry.slice(separator + 1).trim();
    const amount = Number(amountRaw);
    if (!symbol) {
      throw new Error(
        `Invalid MAX_ORDER_NOTIONAL_BY_SYMBOL entry "${entry}" — missing symbol`
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(
        `Invalid MAX_ORDER_NOTIONAL_BY_SYMBOL entry "${entry}" — amount must be a positive finite number`
      );
    }
    caps[symbol] = amount;
  }
  return caps;
}

/** Parse a positive finite number from the environment, or use the default. */
function positiveNumberFromEnv(
  raw: string | undefined,
  fallback: number,
  label: string
): number {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${label} "${raw}": must be a positive finite number`
    );
  }
  return parsed;
}

/** The effective per-order limits, as read from the environment. */
export function symbolNotionalPolicyLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SymbolNotionalPolicyLimits {
  const defaultRaw = (env.MAX_ORDER_NOTIONAL_DEFAULT ?? "").trim();
  return {
    // Unset by default: no cap => the admission fails closed.
    defaultMaxOrderNotional: defaultRaw
      ? positiveNumberFromEnv(
          env.MAX_ORDER_NOTIONAL_DEFAULT,
          0,
          "MAX_ORDER_NOTIONAL_DEFAULT"
        )
      : null,
    maxOrderNotionalBySymbol: parseMaxOrderNotionalBySymbol(
      env.MAX_ORDER_NOTIONAL_BY_SYMBOL
    ),
  };
}

/** The effective per-order policy, as read from the environment. */
export function symbolNotionalPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ISymbolNotionalPolicy {
  return createSymbolNotionalPolicy(symbolNotionalPolicyLimitsFromEnv(env));
}

/**
 * The freshness/tolerance budgets for the admission gate.
 *
 * - `ADMISSION_MAX_PRICE_AGE_MS` — how old a quote may be. A price older
 *   than this fails the admission (an old price is an unknown capacity).
 * - `ADMISSION_PRICE_TOLERANCE` — how far the engine's price may differ from
 *   the backend's, as a RELATIVE fraction. The two are sampled at different
 *   instants, so they need not be identical.
 * - `ADMISSION_ESTIMATE_TOLERANCE` — how far the engine's reported exposure
 *   may differ from the backend's recomputation, as a RELATIVE fraction. The
 *   engine's grid is tick-quantized and the recomputation is not, so a small
 *   difference is expected and bounded.
 */
export function admissionPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): GridAdmissionPolicy {
  return {
    maxPriceAgeMs: positiveNumberFromEnv(
      env.ADMISSION_MAX_PRICE_AGE_MS,
      30_000,
      "ADMISSION_MAX_PRICE_AGE_MS"
    ),
    priceRelativeTolerance: positiveNumberFromEnv(
      env.ADMISSION_PRICE_TOLERANCE,
      0.02,
      "ADMISSION_PRICE_TOLERANCE"
    ),
    estimateRelativeTolerance: positiveNumberFromEnv(
      env.ADMISSION_ESTIMATE_TOLERANCE,
      0.01,
      "ADMISSION_ESTIMATE_TOLERANCE"
    ),
  };
}

/**
 * The effective policy for operational diagnostics — the limits and budgets,
 * never a secret. Safe to log.
 */
export function describeEffectiveAdmissionPolicy(
  env: NodeJS.ProcessEnv = process.env
): {
  maxOrderNotionalBySymbol: Record<string, number>;
  defaultMaxOrderNotional: number | null;
  maxPriceAgeMs: number;
  priceRelativeTolerance: number;
  estimateRelativeTolerance: number;
} {
  const limits = symbolNotionalPolicyLimitsFromEnv(env);
  const policy = admissionPolicyFromEnv(env);
  return {
    maxOrderNotionalBySymbol: limits.maxOrderNotionalBySymbol,
    defaultMaxOrderNotional: limits.defaultMaxOrderNotional,
    maxPriceAgeMs: policy.maxPriceAgeMs,
    priceRelativeTolerance: policy.priceRelativeTolerance,
    estimateRelativeTolerance: policy.estimateRelativeTolerance,
  };
}
