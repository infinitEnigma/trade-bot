/** @format */

/**
 * AccountOverviewSection per tier (Stage 2).
 * REGISTERED sees the on-chain wallet balance; VERIFIED sees the five
 * figure cards; BASIC sees the connect CTA instead of $0 cards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockUseConnection = vi.fn();
const mockUseChainId = vi.fn();
vi.mock("wagmi", () => ({
  useConnection: () => mockUseConnection(),
  useChainId: () => mockUseChainId(),
}));

vi.mock("../../../shared/components/user/UserProgressCard", () => ({
  UserProgressCard: () => <div data-testid="progress-card" />,
}));
vi.mock("../../../shared/components/layout", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../shared/components/layout")>();
  return {
    ...actual,
    ElectricalNetworkBackground: () => <div data-testid="bg" />,
  };
});

import { AccountOverviewSection } from "./AccountOverviewSection";
import { resolveDashboardAccess } from "../utils/dashboardAccess";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";
import type { ExchangeAccountDto } from "../../../infrastructure/api/accounts";

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

const ACCOUNTS: ExchangeAccountDto[] = [
  {
    id: "acct-new",
    userId: "user-1",
    exchange: "lighter",
    environment: "testnet",
    accountRef: "idx-new",
    status: "ACTIVE",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
];
const LABELS = { "acct-new": "lighter (testnet) idx-new" };

const renderSection = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("AccountOverviewSection per tier (Stage 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseConnection.mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    mockUseChainId.mockReturnValue(undefined);
  });

  it("BASIC sees the wallet CTA instead of fabricated $0 cards", () => {
    const onSelect = vi.fn();
    renderSection(
      <AccountOverviewSection
        access={resolveDashboardAccess(null)}
        portfolioSummary={summary()}
        portfolioAccounts={[]}
        activeAccountId=""
        onAccountSelect={onSelect}
        accountLabels={{}}
      />
    );

    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
    expect(screen.getByText("Go to Wallet")).toBeInTheDocument();
    expect(screen.queryByText("Wallet (on-chain)")).not.toBeInTheDocument();
    expect(screen.queryByText("Exchange balance")).not.toBeInTheDocument();
  });

  it("REGISTERED sees the on-chain balance with identity + network", () => {
    mockUseConnection.mockReturnValue({
      address: "0xabc123",
      isConnected: true,
    });
    mockUseChainId.mockReturnValue(1);
    renderSection(
      <AccountOverviewSection
        access={resolveDashboardAccess({ userLevel: "REGISTERED" } as never)}
        portfolioSummary={summary({ walletBalance: 42.5 })}
        portfolioAccounts={[]}
        activeAccountId=""
        onAccountSelect={vi.fn()}
        accountLabels={{}}
      />
    );

    expect(screen.getByText("Your Wallet (on-chain)")).toBeInTheDocument();
    expect(screen.getByText("0xabc123")).toBeInTheDocument();
    expect(screen.getByText("Ethereum mainnet")).toBeInTheDocument();
    expect(screen.getByText("$42.5")).toBeInTheDocument();
    expect(
      screen.getByText("Connect Your Trading Account")
    ).toBeInTheDocument();
  });

  it("VERIFIED sees the five figure cards and the single selector", () => {
    const onSelect = vi.fn();
    renderSection(
      <AccountOverviewSection
        access={resolveDashboardAccess({ userLevel: "VERIFIED" } as never)}
        portfolioSummary={summary({
          walletBalance: 10,
          exchangeBalance: 20,
          unrealizedPnl: 3,
          realizedPnl: -1,
          totalAcrossExchanges: 30,
          activeAccountCount: 1,
        })}
        portfolioAccounts={ACCOUNTS}
        activeAccountId="acct-new"
        onAccountSelect={onSelect}
        accountLabels={LABELS}
      />
    );

    for (const title of [
      "Wallet (on-chain)",
      "Exchange balance",
      "Unrealized PnL (open positions)",
      "Realized PnL (7d, venue)",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText(/Total across /)).toBeInTheDocument();
    // One selector only (the positions/trades in-card selectors are gone).
    expect(screen.getAllByLabelText("Select exchange account")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Select exchange account"), {
      target: { value: "acct-new" },
    });
    expect(onSelect).toHaveBeenCalledWith("acct-new");
  });

  it("VERIFIED discloses a partial total instead of a silent undercount", () => {
    renderSection(
      <AccountOverviewSection
        access={resolveDashboardAccess({ userLevel: "VERIFIED" } as never)}
        portfolioSummary={summary({
          totalAcrossExchanges: 30,
          activeAccountCount: 2,
          totalIsPartial: true,
          failedAccounts: [{ accountId: "x", label: "lighter (testnet) x" }],
        })}
        portfolioAccounts={ACCOUNTS}
        activeAccountId="acct-new"
        onAccountSelect={vi.fn()}
        accountLabels={LABELS}
      />
    );

    expect(screen.getByText(/Partial — 1 of /)).toBeInTheDocument();
    expect(screen.getByText(/lighter \(testnet\) x/)).toBeInTheDocument();
  });
});
