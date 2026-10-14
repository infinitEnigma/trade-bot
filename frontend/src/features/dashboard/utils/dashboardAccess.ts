/** @format */

/**
 * Dashboard tier → presentation mapping: the single place where tier-driven
 * Dashboard presentation is decided.
 *
 * FRONTEND GATING IS PRESENTATION ONLY — the backend already 401/403s every
 * private endpoint. Nothing here is an access-control surface; it only decides
 * which sections render and which CTA the header shows.
 *
 * Data authority per tier (matches the existing query `enabled` gates — no
 * backend changes needed):
 * - BASIC      — public market data (ticker/klines/TV) + onboarding.
 * - REGISTERED — + linked-wallet balance/identity (the usePortfolioSummary
 *                wallet gate is `userLevel !== "BASIC"`).
 * - VERIFIED   — + exchange balance, positions, PnL, trades, bots, WS/engine
 *                (isVerified gates; ConditionalWebSocketInitializer).
 */

import { User, UserLevel, UserRole } from "../../../shared/types";

export type DashboardTier = "BASIC" | "REGISTERED" | "VERIFIED";

/** The one next step for this tier (header + section CTAs stay consistent). */
export type DashboardPrimaryAction =
  "connect-wallet" | "verify-exchange" | "open-strategies";

/** What the Account overview section renders for this tier. */
export type AccountSectionKind = "connect" | "wallet" | "portfolio";

/** What the Trading activity section renders for this tier. */
export type TradingSectionKind = "explainer" | "operational";

export interface DashboardAccess {
  tier: DashboardTier;
  primaryAction: DashboardPrimaryAction;
  /**
   * Analytics deep link — role-gated exactly like the nav + route
   * (VERIFIED + QUALIFIED_ALPHA). Presentation only; the route 403s.
   */
  canViewAnalytics: boolean;
  sections: {
    account: AccountSectionKind;
    trading: TradingSectionKind;
    /**
     * System Status reflects WS/engine reality — VERIFIED only (the WS
     * initializer never connects below VERIFIED and engine status is
     * meaningless there).
     */
    systemStatus: boolean;
  };
}

export const resolveDashboardAccess = (
  user: Pick<User, "userLevel" | "roles"> | null
): DashboardAccess => {
  const tier: DashboardTier =
    user?.userLevel === UserLevel.VERIFIED
      ? "VERIFIED"
      : user?.userLevel === UserLevel.REGISTERED
        ? "REGISTERED"
        : "BASIC";

  const canViewAnalytics =
    tier === "VERIFIED" &&
    (user?.roles?.includes(UserRole.QUALIFIED_ALPHA) ?? false);

  switch (tier) {
    case "VERIFIED":
      return {
        tier,
        primaryAction: "open-strategies",
        canViewAnalytics,
        sections: {
          account: "portfolio",
          trading: "operational",
          systemStatus: true,
        },
      };
    case "REGISTERED":
      return {
        tier,
        primaryAction: "verify-exchange",
        canViewAnalytics,
        sections: {
          account: "wallet",
          trading: "explainer",
          systemStatus: false,
        },
      };
    case "BASIC":
      return {
        tier,
        primaryAction: "connect-wallet",
        canViewAnalytics,
        sections: {
          account: "connect",
          trading: "explainer",
          systemStatus: false,
        },
      };
  }
};
