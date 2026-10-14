/** @format */

import { describe, expect, it } from "vitest";
import { User, UserLevel, UserRole } from "../../../shared/types";
import { resolveDashboardAccess } from "./dashboardAccess";

describe("resolveDashboardAccess", () => {
  it("treats a missing user (auth still loading) as BASIC with the wallet CTA", () => {
    const access = resolveDashboardAccess(null);
    expect(access.tier).toBe("BASIC");
    expect(access.primaryAction).toBe("connect-wallet");
    expect(access.canViewAnalytics).toBe(false);
    expect(access.sections).toEqual({
      account: "connect",
      trading: "explainer",
      systemStatus: false,
    });
  });

  it("BASIC → connect-wallet; account section asks for the wallet; trading is locked", () => {
    const access = resolveDashboardAccess({ userLevel: UserLevel.BASIC });
    expect(access.tier).toBe("BASIC");
    expect(access.primaryAction).toBe("connect-wallet");
    expect(access.canViewAnalytics).toBe(false);
    expect(access.sections).toEqual({
      account: "connect",
      trading: "explainer",
      systemStatus: false,
    });
  });

  it("REGISTERED → verify-exchange; wallet section; trading stays an explainer", () => {
    const access = resolveDashboardAccess({ userLevel: UserLevel.REGISTERED });
    expect(access.tier).toBe("REGISTERED");
    expect(access.primaryAction).toBe("verify-exchange");
    expect(access.canViewAnalytics).toBe(false);
    expect(access.sections).toEqual({
      account: "wallet",
      trading: "explainer",
      systemStatus: false,
    });
  });

  it("VERIFIED → open-strategies; portfolio section; operational trading + system status", () => {
    const access = resolveDashboardAccess({ userLevel: UserLevel.VERIFIED });
    expect(access.tier).toBe("VERIFIED");
    expect(access.primaryAction).toBe("open-strategies");
    expect(access.sections).toEqual({
      account: "portfolio",
      trading: "operational",
      systemStatus: true,
    });
  });

  it("Analytics link needs VERIFIED + QUALIFIED_ALPHA (nav + route parity)", () => {
    expect(
      resolveDashboardAccess({
        userLevel: UserLevel.VERIFIED,
        roles: [UserRole.QUALIFIED_ALPHA],
      }).canViewAnalytics
    ).toBe(true);
    // VERIFIED alone is not enough…
    expect(
      resolveDashboardAccess({ userLevel: UserLevel.VERIFIED }).canViewAnalytics
    ).toBe(false);
    // …and neither is the role on a lower tier.
    expect(
      resolveDashboardAccess({
        userLevel: UserLevel.REGISTERED,
        roles: [UserRole.QUALIFIED_ALPHA],
      }).canViewAnalytics
    ).toBe(false);
  });

  it("an unrecognized userLevel falls back to the BASIC presentation (never crashes)", () => {
    // Backward compatibility: a user object from an older store shape.
    const weird = { userLevel: "SOMETHING_NEW" } as unknown as Pick<
      User,
      "userLevel" | "roles"
    >;
    const access = resolveDashboardAccess(weird);
    expect(access.tier).toBe("BASIC");
    expect(access.sections.account).toBe("connect");
    expect(access.sections.trading).toBe("explainer");
    expect(access.sections.systemStatus).toBe(false);
  });
});
