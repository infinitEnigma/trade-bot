/** @format */

/**
 * Per-symbol order-notional policy — the cap on ONE grid order.
 *
 * This is a DIFFERENT control from the F1 account-exposure cap:
 *
 * | Control | Protects against |
 * |---|---|
 * | Per-order cap | an individual grid order being disproportionately large |
 * | F1 account cap | aggregate exposure exceeding the account's capacity |
 *
 * The per-order cap is what rejects `orderQuantity = 1` on BTC (a ~$100,000
 * order at current prices) while leaving `orderQuantity = 1` on ETH (~$2,500)
 * alone — the SAME config value means radically different risk per symbol, and
 * a grid-wide limit cannot express that.
 *
 * The cap is evaluated against each eligible BUY level's OWN notional
 * (`orderQuantity × level price`) — never the baseline price, an average, or
 * the total divided by the order count. A grid's top level rests at the
 * highest price, so that is the order the cap must judge.
 *
 * The policy is CONFIGURABLE and venue-agnostic: a symbol's cap is looked up
 * by the symbol the strategy stores, and an unmapped symbol falls back to the
 * default cap.
 *
 * FAIL CLOSED WHEN UNCONFIGURED: this is a financial risk control, so a
 * missing policy is NOT "no limit" — it is "cannot decide". An admission with
 * no configured cap is REJECTED with `POLICY_NOT_CONFIGURED`. Shipping an
 * effective default would turn an undocumented assumption into an operational
 * policy, which is exactly how a 1-BTC order reaches the venue.
 *
 * Two DISTINCT controls, never conflated:
 * - the per-order notional limit (this policy), and
 * - the account-wide exposure cap (F1).
 * Configuring one does not imply the other is configured or satisfied.
 */

export interface SymbolNotionalPolicyLimits {
  /**
   * The cap applied to a symbol with no explicit entry, in USD.
   * `null` means "no default cap" — such a symbol falls through to the
   * UNCONFIGURED verdict below (fail closed), never to "allowed".
   */
  defaultMaxOrderNotional: number | null;
  /** Per-symbol caps in USD, keyed by the symbol the strategy stores. */
  maxOrderNotionalBySymbol: Record<string, number>;
}

/** Why an order was refused. */
export type OrderNotionalRejection =
  /** The order's notional exceeds the symbol's cap. */
  | "CAP_EXCEEDED"
  /** No cap is configured for this symbol — the control cannot decide. */
  | "POLICY_NOT_CONFIGURED"
  /** The order's notional is not a usable positive number. */
  | "INVALID_NOTIONAL";

/** The result of evaluating the policy against one order. */
export interface OrderNotionalVerdict {
  /** True when the order is within its cap. */
  allowed: boolean;
  /** The cap that applied, or null when no cap applied. */
  limit: number | null;
  /** The order's notional. */
  notional: number;
  /** Why the order was refused, when it was. */
  rejection?: OrderNotionalRejection;
}

export interface ISymbolNotionalPolicy {
  /**
   * Evaluate ONE order's notional against the symbol's cap.
   *
   * A symbol with no configured cap falls back to `defaultMaxOrderNotional`.
   * When NEITHER applies the verdict is NOT allowed — it is
   * `POLICY_NOT_CONFIGURED`, because an admission that cannot evaluate the
   * control must not pass it.
   */
  evaluateOrder(symbol: string, orderNotional: number): OrderNotionalVerdict;

  /**
   * The cap that applies to a symbol — exposed so the rejection message can
   * name the limit the operator has to beat.
   */
  limitFor(symbol: string): number | null;
}

/**
 * Build the policy from its limits.
 *
 * A non-positive or non-finite configured cap is REJECTED at construction
 * time — a cap of 0 or NaN would either block everything or (for NaN) compare
 * false and silently disable the control.
 */
export function createSymbolNotionalPolicy(
  limits: SymbolNotionalPolicyLimits
): ISymbolNotionalPolicy {
  const validate = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `${label} must be a positive finite number (got ${String(value)})`
      );
    }
  };
  for (const [symbol, cap] of Object.entries(limits.maxOrderNotionalBySymbol)) {
    validate(cap, `maxOrderNotionalBySymbol["${symbol}"]`);
  }
  if (
    limits.defaultMaxOrderNotional !== null &&
    limits.defaultMaxOrderNotional !== undefined
  ) {
    validate(limits.defaultMaxOrderNotional, "defaultMaxOrderNotional");
  }

  const limitFor = (symbol: string): number | null => {
    const key = symbol.trim().toUpperCase();
    for (const [configured, cap] of Object.entries(
      limits.maxOrderNotionalBySymbol
    )) {
      if (configured.trim().toUpperCase() === key) return cap;
    }
    return limits.defaultMaxOrderNotional ?? null;
  };

  return {
    limitFor,
    evaluateOrder(symbol, orderNotional) {
      const limit = limitFor(symbol);
      if (limit === null) {
        // No cap is configured for this symbol — the control cannot decide,
        // so the order is NOT admitted. Fail closed.
        return {
          allowed: false,
          limit: null,
          notional: orderNotional,
          rejection: "POLICY_NOT_CONFIGURED",
        };
      }
      if (!Number.isFinite(orderNotional) || orderNotional <= 0) {
        // A non-positive order notional is a pricing defect, not a policy
        // decision — refuse it.
        return {
          allowed: false,
          limit,
          notional: orderNotional,
          rejection: "INVALID_NOTIONAL",
        };
      }
      return {
        allowed: orderNotional <= limit,
        limit,
        notional: orderNotional,
        ...(orderNotional <= limit
          ? {}
          : { rejection: "CAP_EXCEEDED" as const }),
      };
    },
  };
}
