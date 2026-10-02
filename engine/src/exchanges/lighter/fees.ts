/** @format */

/**
 * Lighter fee sourcing (accounting track, Phase 1).
 *
 * Fee *rates* come from the account's venue-reported tier — never from a
 * per-fill field — because the venue exposes no per-fill fee. Verified
 * read-only on 2026-10-02 (probe session `scripts/lighter-probe` + an
 * authenticated proxy on the same credentials):
 *
 * - **No REST tape carries a fee.** `/api/v1/trades` answers the same key set
 *   publicly and under authentication (`account_index`, `order_index` and
 *   `client_id` filters all return 200): order ids, sizes, prices,
 *   `ask_/bid_account_pnl` — and no `maker_fee`/`taker_fee` keys, even though
 *   the L1 `Trade` event does carry `tf`/`mf`
 *   (https://apidocs.lighter.xyz/docs/data-structures-constants-and-errors).
 * - **Market metadata is a placeholder.** `orderBookDetails.maker_fee` and
 *   `taker_fee` read `0.0000` for all 237 mainnet markets and every testnet
 *   market sampled, so the market row cannot be the fee source either.
 * - **`GET /api/v1/accountLimits` (auth) is the only account-scoped fee
 *   signal** (https://apidocs.lighter.xyz/reference/accountlimits): `user_tier`
 *   / `user_tier_name` (this testnet account: `"standard"`),
 *   `current_maker_fee_tick` / `current_taker_fee_tick` (int32, `0` here — the
 *   tick→rate scale is undocumented and cannot be calibrated live because a
 *   Standard account is charged nothing) and `effective_lit_stakes`.
 *
 * So the engine derives the rate from the *tier* via the published schedule
 * below and computes each fill's fee as `notional × rate`. Scheduled rates
 * (https://docs.lighter.xyz/trading/trading-fees and
 * https://apidocs.lighter.xyz/docs/account-types, retrieved 2026-10-02):
 * Standard 0 / 0; Plus 0.005% both sides; Premium 0.0040% maker / 0.0280%
 * taker, further discounted by staked LIT (2.5% off at 1,000 LIT up to 30% off
 * at 500,000). The staking discount is deliberately **not** applied — see
 * `exact` on the result.
 */

import { ExchangeFeeRates } from "../../domain/exchange";

/** The three account tiers the venue names. */
export type LighterAccountTier = "standard" | "plus" | "premium";

/**
 * Published maker/taker rates as fractions of notional (`0.00005` = 0.005%).
 * `premium` is the *undiscounted* base: a staking discount only lowers it, so
 * using it never understates the fee.
 */
export const LIGHTER_FEE_SCHEDULE: Record<
  LighterAccountTier,
  ExchangeFeeRates
> = {
  standard: { makerRate: 0, takerRate: 0 },
  plus: { makerRate: 0.00005, takerRate: 0.00005 },
  premium: { makerRate: 0.00004, takerRate: 0.00028 },
};

/** Worst published rate — assumed only when the tier cannot be mapped. */
const WORST_PUBLISHED = LIGHTER_FEE_SCHEDULE.premium;

/**
 * Map a venue tier label onto a known tier. The venue uses `"std"` in its
 * OpenAPI example but answers `"standard"` live, so both spellings map.
 */
export function parseLighterAccountTier(
  raw: unknown
): LighterAccountTier | undefined {
  if (typeof raw !== "string") return undefined;
  switch (raw.trim().toLowerCase()) {
    case "std":
    case "standard":
      return "standard";
    case "plus":
      return "plus";
    case "premium":
      return "premium";
    default:
      return undefined;
  }
}

function stakesOf(body: Record<string, unknown>): number | undefined {
  const raw = body.effective_lit_stakes;
  if (raw === undefined || raw === null) return undefined;
  const stakes = Number(raw);
  return Number.isFinite(stakes) ? stakes : undefined;
}

/**
 * Map an `/api/v1/accountLimits` body onto fee rates.
 *
 * Never throws, and never guesses *zero*: an unmapped tier falls back to the
 * worst published rate with `venueReported: false`, so a caller booking the
 * result understates profit rather than inventing a rebate.
 */
export function resolveLighterFeeRates(payload: unknown): ExchangeFeeRates {
  const body = (payload ?? {}) as Record<string, unknown>;
  const named = typeof body.user_tier_name === "string" && body.user_tier_name;
  const raw = named || (typeof body.user_tier === "string" && body.user_tier);
  const tier = parseLighterAccountTier(raw);
  if (!tier) {
    return {
      ...WORST_PUBLISHED,
      tier: typeof raw === "string" ? raw : undefined,
      venueReported: false,
      exact: false,
      basis: `accountLimits: unmapped tier ${JSON.stringify(
        raw || null
      )} — worst published rate assumed`,
    };
  }
  const schedule = LIGHTER_FEE_SCHEDULE[tier];
  const stakes = stakesOf(body);
  const discounted = tier === "premium" && stakes !== undefined && stakes > 0;
  return {
    ...schedule,
    tier,
    venueReported: true,
    exact: !discounted,
    basis: discounted
      ? `accountLimits: tier=premium, lit_stakes=${stakes} — staking discount NOT applied (rate is an upper bound)`
      : `accountLimits: tier=${tier}`,
  };
}
