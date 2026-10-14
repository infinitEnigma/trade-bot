/** @format */

/**
 * TradingActivitySection tiers (Stage 3).
 * BASIC/REGISTERED see the explainer + next step (never locked controls);
 * System Status renders VERIFIED-only; Analytics link is role-gated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../components/BotStatusPanel", () => ({
  BotStatusPanel: () => <div data-testid="bot-panel" />,
}));
vi.mock("../../../shared/components/user/RecentTrades", () => ({
  RecentTradesTable: () => <div data-testid="trades-table" />,
}));

import { TradingActivitySection } from "./TradingActivitySection";
import { resolveDashboardAccess } from "../utils/dashboardAccess";
import { UserLevel, UserRole } from "../../../shared/types";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";

const summary = (overrides: Partial<PortfolioSummary> = {}): PortfolioSummary =>
  ({
    walletBalance: 0,
    exchangeBalance: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalAcrossExchanges: 0,
    positions: [],
    positionsLoading: false,
    positionsUpdatedAt: 0,
    walletBalanceUpdatedAt: 0,
    trades: [],
    tradesLoading: false,
    tradesError: null,
    venuePnlPoints: [],
    venuePnlLoading: false,
    activeAccountCount: 0,
    totalIsPartial: false,
    failedAccounts: [],
    loading: false,
    initialLoading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  }) as PortfolioSummary;

const baseProps = () => ({
  portfolioSummary: summary(),
  portfolioData: [],
  activeAccountId: "",
  accountLabels: {},
  ledgerTrades: [],
  ledgerTradesLoading: false,
  ledgerTradesError: null,
  wsStatus: "DISCONNECTED",
  engineRunning: null as boolean | null,
  journalIntegrity: undefined,
  journalIntegrityAlert: undefined,
});

const renderSection = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("TradingActivitySection tiers (Stage 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BASIC sees the wallet-first explainer with a wallet CTA", () => {
    renderSection(
      <TradingActivitySection
        access={resolveDashboardAccess({ userLevel: UserLevel.BASIC })}
        {...baseProps()}
      />
    );

    expect(
      screen.getByText("Trading unlocks after wallet + exchange setup")
    ).toBeInTheDocument();
    expect(screen.getByText("Go to Wallet")).toBeInTheDocument();
    // No operational content, no locked tables.
    expect(screen.queryByTestId("bot-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trades-table")).not.toBeInTheDocument();
    expect(screen.queryByText("System Status")).not.toBeInTheDocument();
  });

  it("REGISTERED sees the exchange explainer with a Settings link", () => {
    renderSection(
      <TradingActivitySection
        access={resolveDashboardAccess({ userLevel: UserLevel.REGISTERED })}
        {...baseProps()}
      />
    );

    expect(
      screen.getByText("Trading unlocks after exchange verification")
    ).toBeInTheDocument();
    const link = screen.getByText("Open Settings");
    expect(link.getAttribute("href")).toBe("/settings");
    expect(screen.queryByTestId("bot-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("System Status")).not.toBeInTheDocument();
  });

  it("VERIFIED renders bot panel → tables → chart → System Status", () => {
    renderSection(
      <TradingActivitySection
        access={resolveDashboardAccess({ userLevel: UserLevel.VERIFIED })}
        {...baseProps()}
      />
    );

    expect(screen.getByTestId("bot-panel")).toBeInTheDocument();
    expect(screen.getByText("Open Positions")).toBeInTheDocument();
    expect(screen.getByTestId("trades-table")).toBeInTheDocument();
    // System Status is VERIFIED-only — and VERIFIED sees it.
    expect(screen.getByText("System Status")).toBeInTheDocument();
  });

  it("Analytics link appears only with QUALIFIED_ALPHA (route parity)", () => {
    const { rerender } = render(
      <MemoryRouter>
        <TradingActivitySection
          access={resolveDashboardAccess({ userLevel: UserLevel.VERIFIED })}
          {...baseProps()}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText("View Analytics")).not.toBeInTheDocument();
    expect(screen.getAllByText("Manage Strategies").length).toBeGreaterThan(0);

    rerender(
      <MemoryRouter>
        <TradingActivitySection
          access={resolveDashboardAccess({
            userLevel: UserLevel.VERIFIED,
            roles: [UserRole.QUALIFIED_ALPHA],
          })}
          {...baseProps()}
        />
      </MemoryRouter>
    );
    const analytics = screen.getByText("View Analytics");
    expect(analytics.getAttribute("href")).toBe("/analytics");
  });
});
