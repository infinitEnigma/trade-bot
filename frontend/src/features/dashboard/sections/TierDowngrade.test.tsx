/** @format */

/**
 * Tier downgrade presentation (Stage 4): VERIFIED → REGISTERED must not
 * strand. The trading section collapses to the exchange explainer, System
 * Status vanishes, and no bot query fires (render-gated panel never mounts).
 * Upgrade reactivity is already covered by the enabled-gates; this pins the
 * unlink path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseBotsList = vi.fn();
vi.mock("../../bots/hooks", () => ({
  useBotsList: () => mockUseBotsList(),
}));
vi.mock("../../../shared/components/user/RecentTrades", () => ({
  RecentTradesTable: () => <div data-testid="trades-table" />,
}));

import { TradingActivitySection } from "./TradingActivitySection";
import { resolveDashboardAccess } from "../utils/dashboardAccess";
import { UserLevel } from "../../../shared/types";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";

const summary = (): PortfolioSummary =>
  ({
    walletBalance: 5,
    exchangeBalance: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalAcrossExchanges: 5,
    positions: [],
    positionsLoading: false,
    positionsUpdatedAt: 0,
    walletBalanceUpdatedAt: Date.now(),
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
  }) as PortfolioSummary;

const propsFor = (userLevel: UserLevel) => ({
  access: resolveDashboardAccess({ userLevel }),
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

describe("Tier downgrade presentation (Stage 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBotsList.mockReturnValue({ bots: [], isLoading: false });
  });

  it("VERIFIED → REGISTERED: explainer + Settings link, no System Status, no bot fetch", () => {
    // Before: VERIFIED operational.
    const { rerender } = render(
      <MemoryRouter>
        <TradingActivitySection {...propsFor(UserLevel.VERIFIED)} />
      </MemoryRouter>
    );
    expect(screen.getByText("System Status")).toBeInTheDocument();

    // After unlink: REGISTERED explainer names the exact next step…
    // (clear the VERIFIED render's legitimate panel mount first — the
    // assertion is that the downgraded tier mounts no panel at all).
    mockUseBotsList.mockClear();
    rerender(
      <MemoryRouter>
        <TradingActivitySection {...propsFor(UserLevel.REGISTERED)} />
      </MemoryRouter>
    );
    expect(
      screen.getByText("Trading unlocks after exchange verification")
    ).toBeInTheDocument();
    const link = screen.getByText("Open Settings");
    expect(link.getAttribute("href")).toBe("/settings");

    // …System Status is gone, and the bot panel (the query owner) never
    // mounted, so no bot fetch could fire on the downgraded tier.
    expect(screen.queryByText("System Status")).not.toBeInTheDocument();
    expect(mockUseBotsList).not.toHaveBeenCalled();
  });

  it("REGISTERED → BASIC: wallet-first explainer, still no stranded content", () => {
    render(
      <MemoryRouter>
        <TradingActivitySection {...propsFor(UserLevel.BASIC)} />
      </MemoryRouter>
    );

    expect(
      screen.getByText("Trading unlocks after wallet + exchange setup")
    ).toBeInTheDocument();
    expect(screen.getByText("Go to Wallet")).toBeInTheDocument();
    expect(screen.queryByText("System Status")).not.toBeInTheDocument();
    expect(mockUseBotsList).not.toHaveBeenCalled();
  });
});
