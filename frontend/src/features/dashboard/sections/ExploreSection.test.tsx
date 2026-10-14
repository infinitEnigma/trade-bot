/** @format */

/**
 * ExploreSection (Stage 4): always-last tier-aware next steps.
 * No dead ends: Strategies VERIFIED-only, Analytics role-gated, Settings for
 * all, refresh wired to the portfolio figures. No help link exists.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ExploreSection } from "./ExploreSection";
import { resolveDashboardAccess } from "../utils/dashboardAccess";
import { UserLevel, UserRole } from "../../../shared/types";

const renderSection = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("ExploreSection (Stage 4)", () => {
  it("BASIC: wallet CTA + verification explainer + settings, no Strategies", () => {
    renderSection(
      <ExploreSection
        access={resolveDashboardAccess({ userLevel: UserLevel.BASIC })}
        onRefresh={vi.fn()}
        refreshing={false}
      />
    );

    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
    expect(screen.getByText("How verification works")).toBeInTheDocument();
    expect(screen.queryByText("Manage Strategies")).not.toBeInTheDocument();
    expect(screen.queryByText("View Analytics")).not.toBeInTheDocument();
  });

  it("REGISTERED: exchange CTA + settings, no Strategies", () => {
    renderSection(
      <ExploreSection
        access={resolveDashboardAccess({ userLevel: UserLevel.REGISTERED })}
        onRefresh={vi.fn()}
        refreshing={false}
      />
    );

    expect(screen.getByText("Connect exchange account")).toBeInTheDocument();
    expect(screen.queryByText("Manage Strategies")).not.toBeInTheDocument();
  });

  it("VERIFIED: Strategies always, Analytics only with the role", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ExploreSection
          access={resolveDashboardAccess({ userLevel: UserLevel.VERIFIED })}
          onRefresh={vi.fn()}
          refreshing={false}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Manage Strategies")).toBeInTheDocument();
    expect(screen.queryByText("View Analytics")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ExploreSection
          access={resolveDashboardAccess({
            userLevel: UserLevel.VERIFIED,
            roles: [UserRole.QUALIFIED_ALPHA],
          })}
          onRefresh={vi.fn()}
          refreshing={false}
        />
      </MemoryRouter>
    );
    const analytics = screen.getByText("View Analytics");
    expect(analytics.getAttribute("href")).toBe("/analytics");
  });

  it("refresh button calls onRefresh and spins while refreshing", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <ExploreSection
          access={resolveDashboardAccess({ userLevel: UserLevel.VERIFIED })}
          onRefresh={onRefresh}
          refreshing={false}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Refresh figures"));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <ExploreSection
          access={resolveDashboardAccess({ userLevel: UserLevel.VERIFIED })}
          onRefresh={onRefresh}
          refreshing={true}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Refresh figures")).toBeDisabled();
  });

  it("never renders a help link (no help surface exists)", () => {
    renderSection(
      <ExploreSection
        access={resolveDashboardAccess({
          userLevel: UserLevel.VERIFIED,
          roles: [UserRole.QUALIFIED_ALPHA],
        })}
        onRefresh={vi.fn()}
        refreshing={false}
      />
    );

    expect(screen.queryByText(/help/i)).not.toBeInTheDocument();
  });
});
