/** @format */

/**
 * StrategyWorkspace (Phase 3 slice 4): the detail half replacing
 * StrategyCard — identity + edit/delete, bot state with the honest realized-PnL figure
 * (incomplete marker, never net), the open-orders view, and the card-era fills
 * section (bot-backed → collapsed toggle; bot-less → no fills section at all,
 * but the BotControls start flow still shows).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Strategy, StrategyType } from "../../../shared/types";
import type { BotInstance } from "../types/strategies.types";
import type { StrategyRun } from "../types/strategies.types";
import type { OpenOrderRow } from "../../../infrastructure/api/market";
import type { AccountPositionRow } from "../../../infrastructure/api/market";
import type { ExchangeAccountDto } from "../../../infrastructure/api/accounts";
import { StrategyWorkspace } from "./StrategyWorkspace";

vi.mock("../bots/components/BotControls", () => ({
  BotControls: () => <div data-testid="bot-controls" />,
}));

// F5: the chart moved to a page-level panel (StrategyChartPanel). Stub it so
// the regression guard below can prove the workspace never mounts it.
vi.mock("../../../shared/components/charts/CandlestickChart", () => ({
  default: () => <div data-testid="candlestick-chart" />,
}));

// The workspace calls the real hook (query-keyed per strategyId); the hook is
// the only seam, mocked at the module boundary with per-key rows.
const fillsByStrategy: Record<string, unknown[]> = {};
const recentTradesCalls: Array<{ strategyId?: string; limit?: number }> = [];
vi.mock("../../../shared/hooks", () => ({
  useRecentTrades: (filters?: { strategyId?: string; limit?: number }) => {
    recentTradesCalls.push(filters ?? {});
    return {
      trades: fillsByStrategy[filters?.strategyId ?? ""] ?? [],
      isLoading: false,
      error: null,
      dataUpdatedAt: 0,
    };
  },
}));

// Phase 1: the lifetime ledger aggregate (mocked at the hook seam, the
// useRecentTrades precedent). Per-strategy records + a mutable query state so
// each test scripts loading/error/data without touching the network.
const perfByStrategy: Record<string, unknown> = {};
const perfState = {
  isLoading: false,
  error: null as unknown,
  dataUpdatedAt: 0,
};
const perfHookCalls: Array<{
  strategyId?: string;
  options?: { enabled?: boolean; live?: boolean };
}> = [];
vi.mock("../hooks/useStrategyPerformance", () => ({
  useStrategyPerformance: (
    strategyId?: string,
    options?: { enabled?: boolean; live?: boolean }
  ) => {
    perfHookCalls.push({ strategyId, options });
    return {
      performance: (strategyId && perfByStrategy[strategyId]) || null,
      isLoading: perfState.isLoading,
      error: perfState.error,
      dataUpdatedAt: perfState.dataUpdatedAt,
    };
  },
  strategyPerformanceQueryKey: (id?: string) => [
    "strategy-performance",
    id ?? null,
  ],
}));

const FILL = {
  id: "t1",
  strategyId: "s1",
  strategyName: "My Grid",
  botId: "b1",
  exchangeAccountId: "acc1",
  orderId: "o1",
  symbol: "PERP_ETH_USDC",
  side: "BUY",
  quantity: 0.01,
  price: 2000.5,
  fee: null,
  pnl: null,
  status: "FILLED",
  executedAt: "2026-10-12T10:00:00.000Z",
};

const ORDER: OpenOrderRow = {
  orderId: "ord-1",
  clientOrderId: null,
  symbol: "PERP_ETH_USDC",
  side: "SELL",
  orderType: "LIMIT",
  price: 2500,
  quantity: 0.5,
  filledQuantity: 0,
  status: "NEW",
  createdAtMs: Date.UTC(2026, 9, 12, 9, 0, 0),
  exchange: "kodiak",
};

const STRATEGY = {
  id: "s1",
  userId: "u1",
  name: "My Grid",
  type: StrategyType.GRID,
  config: {
    symbol: "PERP_ETH_USDC",
    leverage: 1,
    gridSize: 10,
    gridRange: 5,
    orderQuantity: 0.01,
  },
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Strategy;

const BOT = {
  id: "b1",
  strategy_id: "s1",
  status: "RUNNING",
  total_trades: 3,
  total_pnl: 12.5,
  total_pnl_incomplete_fills: 2,
  last_updated: "2026-10-12T10:00:00.000Z",
  config: {
    type: StrategyType.GRID,
    config: { symbol: "PERP_ETH_USDC" },
  },
  runs: [],
} as unknown as BotInstance;

const renderWorkspace = (ui: ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

const workspaceProps = (
  overrides: Partial<{
    bot?: BotInstance;
    orders: OpenOrderRow[];
    ordersLoading: boolean;
    ordersError: boolean;
    ordersUpdatedAt: number;
    account?: ExchangeAccountDto | null;
    positions?: AccountPositionRow[];
    positionsLoading?: boolean;
    positionsError?: boolean;
    positionsUpdatedAt?: number;
    onEdit: (s: Strategy) => void;
    onDelete: (s: Strategy) => void;
  }> = {}
) => ({
  strategy: STRATEGY,
  bot: BOT,
  account: null,
  orders: [] as OpenOrderRow[],
  ordersLoading: false,
  ordersError: false,
  ordersUpdatedAt: 0,
  positions: [] as AccountPositionRow[],
  positionsLoading: false,
  positionsError: false,
  positionsUpdatedAt: 0,
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onBotStatusChange: vi.fn(),
  ...overrides,
});

describe("StrategyWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recentTradesCalls.length = 0;
    perfHookCalls.length = 0;
    for (const key of Object.keys(fillsByStrategy)) delete fillsByStrategy[key];
    for (const key of Object.keys(perfByStrategy)) delete perfByStrategy[key];
    perfState.isLoading = false;
    perfState.error = null;
    perfState.dataUpdatedAt = 0;
  });

  it("shows the strategy identity, enabled state, and wires edit/delete", () => {
    const props = workspaceProps({ bot: undefined });
    renderWorkspace(<StrategyWorkspace {...props} />);

    expect(screen.getByText("My Grid")).toBeDefined();
    expect(screen.getByText("Enabled")).toBeDefined();
    // No bot → the C3a start flow still renders (BotControls without bot).
    expect(screen.getByTestId("bot-controls")).toBeDefined();

    fireEvent.click(screen.getByTitle("Edit Strategy"));
    expect(props.onEdit).toHaveBeenCalledWith(STRATEGY);
    fireEvent.click(screen.getByTitle("Delete Strategy"));
    expect(props.onDelete).toHaveBeenCalledWith(STRATEGY);
  });

  it("falls back to the session counters while the aggregate is unavailable, honestly scoped", () => {
    // No aggregate loaded (fresh fetch pending elsewhere / error) → the
    // session counters fill in with the same F2 incomplete marker; the
    // labels say "(lifetime)" so the fallback's scope is a tooltip away.
    renderWorkspace(<StrategyWorkspace {...workspaceProps()} />);

    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText(/\$12\.50/)).toBeDefined();
    expect(screen.getByText(/incomplete, 2 unknown/)).toBeDefined();
  });

  it("shows the LIFETIME ledger aggregate over a zeroed fresh session (restart-survival)", () => {
    // The Phase 1 bug this fixes: every start inserts a NEW session row, so
    // bot.total_pnl resets to 0 after a stop/start while the strategy's real
    // PnL history sits in the ledger. The aggregate must win.
    const freshSessionBot = {
      ...(BOT as unknown as Record<string, unknown>),
      total_trades: 0,
      total_pnl: 0,
      total_pnl_incomplete_fills: 0,
    } as unknown as BotInstance;
    perfByStrategy["s1"] = {
      totalTrades: 5,
      totalPnL: 12.5,
      unknownPnlFills: 1,
    };
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ bot: freshSessionBot })} />
    );

    // Lifetime figures from the ledger — not the session's fresh 0/0.
    expect(screen.getByText("5")).toBeDefined();
    expect(screen.getByText(/\$12\.50/)).toBeDefined();
    // The F2 marker comes from the aggregate's unknown count, not the
    // session counter (which is 0 on this fresh row).
    expect(screen.getByText(/incomplete, 1 unknown/)).toBeDefined();
  });

  it("shows lifetime performance for botless strategies without session fallbacks", () => {
    perfByStrategy["s1"] = {
      totalTrades: 4,
      totalPnL: 5,
      unknownPnlFills: 1,
      winRate: 66.6667,
      avgTrade: 1.6667,
      bestTrade: 10,
      worstTrade: -5,
      totalFees: 1.25,
      unknownFeeFills: 2,
      firstFillAt: "2026-10-01T10:00:00.000Z",
      lastFillAt: "2026-10-12T10:00:00.000Z",
    };

    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ bot: undefined })} />
    );

    expect(
      screen.getByRole("region", { name: "Strategy performance" })
    ).toBeDefined();
    expect(screen.getByText("66.7%")).toBeDefined();
    expect(screen.getByText("$10.00")).toBeDefined();
    expect(screen.getByText("$1.25")).toBeDefined();
    expect(screen.getByText("Unknown fees: 2")).toBeDefined();
    expect(screen.getByText(/Oct 12, 2026/)).toBeDefined();
    expect(perfHookCalls.at(-1)?.options?.enabled).toBe(true);
  });

  it("does not show a zero win rate when no fills have known PnL", () => {
    perfByStrategy["s1"] = {
      totalTrades: 2,
      totalPnL: 0,
      unknownPnlFills: 2,
      winRate: 0,
      avgTrade: 0,
      bestTrade: null,
      worstTrade: null,
      totalFees: 0,
      unknownFeeFills: 1,
      firstFillAt: "2026-10-01T10:00:00.000Z",
      lastFillAt: "2026-10-12T10:00:00.000Z",
    };

    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ bot: undefined })} />
    );

    expect(screen.getByText("No eligible fills")).toBeDefined();
    expect(screen.getByText("Best fill").parentElement?.textContent).toContain(
      "—"
    );
    expect(screen.getByText("Worst fill").parentElement?.textContent).toContain(
      "—"
    );
  });

  it("keeps new ledger metrics unavailable on performance-query errors", () => {
    perfState.error = new Error("ledger unavailable");

    renderWorkspace(<StrategyWorkspace {...workspaceProps()} />);

    expect(
      screen.getByText("Fees recorded").parentElement?.textContent
    ).toContain("—");
    expect(screen.getByText("Last fill").parentElement?.textContent).toContain(
      "—"
    );
  });

  it("renders run history without changing bot-level status semantics", () => {
    const runs: StrategyRun[] = [
      {
        id: "run-1",
        strategy_id: "s1",
        config_version: 1,
        config: {},
        notional_amount: "100",
        state: "ERROR",
        last_error_code: "RUN_FAILED",
        created_at: "2026-10-01T10:00:00.000Z",
      },
    ];
    const botWithRun = { ...BOT, runs };
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ bot: botWithRun })} />
    );

    expect(screen.getByText("Run history")).toBeDefined();
    expect(screen.getByText("1 run")).toBeDefined();
    expect(screen.getByLabelText("Run state: Error")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("hides run history when the bot has no runs or is absent", () => {
    const { rerender } = renderWorkspace(
      <StrategyWorkspace {...workspaceProps()} />
    );
    expect(screen.queryByText("Run history")).toBeNull();

    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <StrategyWorkspace {...workspaceProps({ bot: undefined })} />
      </QueryClientProvider>
    );
    expect(screen.queryByText("Run history")).toBeNull();
  });

  it("shows loading placeholders while the aggregate is in flight", () => {
    perfState.isLoading = true;
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ positionsLoading: true })} />
    );

    // The three existing bot-panel values remain loading placeholders.
    // The lifetime performance section has its own independent placeholders.
    expect(
      screen.getByText("Trades (lifetime):").parentElement?.textContent
    ).toContain("…");
    expect(
      screen.getByText("Realized PnL (lifetime):").parentElement?.textContent
    ).toContain("…");
    expect(
      screen.getByText("Unrealized PnL:").parentElement?.textContent
    ).toContain("…");
  });

  it("sums unrealized PnL over the market-filtered positions and counts unknowns", () => {
    renderWorkspace(
      <StrategyWorkspace
        {...workspaceProps({
          positions: [
            {
              symbol: "PERP_ETH_USDC",
              position_qty: "0.5",
              unsettled_pnl: "10",
              mark_price: "2500",
              average_open_price: "2400",
            },
            {
              symbol: "PERP_ETH_USDC",
              position_qty: "0.1",
              unsettled_pnl: "", // venue gave no figure — UNKNOWN, never 0
              mark_price: "2500",
              average_open_price: "2490",
            },
            {
              symbol: "PERP_BTC_USDC", // foreign market — excluded from the sum
              position_qty: "-1",
              unsettled_pnl: "-100",
              mark_price: "65000",
              average_open_price: "66000",
            },
          ],
        })}
      />
    );

    // $10 from the one known row + the blank counted as unknown — the blank
    // must never fold into the sum as $0.00.
    expect(screen.getByText(/\$10\.00/)).toBeDefined();
    expect(screen.getByText(/incomplete, 1 unknown/)).toBeDefined();
  });

  it("renders a flat zero unrealized when the strategy's market has no open position", () => {
    renderWorkspace(<StrategyWorkspace {...workspaceProps()} />);

    // No positions on this market → $0.00 is the truth, not a fabrication.
    expect(screen.getByText(/\$0\.00/)).toBeDefined();
  });

  it("forwards the scoped open orders to the table", () => {
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ orders: [ORDER] })} />
    );

    expect(
      screen.getByRole("tab", { name: /open orders \(1\)/i })
    ).toBeDefined();
    expect(screen.getByText("2500")).toBeDefined();
    expect(screen.getByText("SELL")).toBeDefined();
  });

  it("shows the open-orders loading state while the venue read is pending", () => {
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ ordersLoading: true })} />
    );

    expect(screen.getByText(/Loading open orders/)).toBeDefined();
  });

  it("bot-less workspace offers no trades tab (nothing could fill it)", () => {
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ bot: undefined })} />
    );

    expect(screen.queryByText("Recent trades")).toBeNull();
  });

  it("offers both execution tabs; switching reveals the fills panel", () => {
    fillsByStrategy["s1"] = [FILL];
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ orders: [ORDER] })} />
    );

    const ordersTab = screen.getByRole("tab", { name: /open orders/i });
    const tradesTab = screen.getByRole("tab", { name: /recent trades/i });
    expect(ordersTab.getAttribute("aria-selected")).toBe("true");
    expect(tradesTab.getAttribute("aria-selected")).toBe("false");
    // Orders panel is the active one; panels swap via the hidden attribute
    // (hidden, not unmounted), so visibility is asserted on the attribute.
    expect(screen.getByText("2500")).toBeDefined();
    expect(
      document.getElementById("workspace-panel-trades")?.hasAttribute("hidden")
    ).toBe(true);

    fireEvent.click(tradesTab);
    expect(tradesTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/2,000\.5/)).toBeDefined();
    expect(
      document.getElementById("workspace-panel-orders")?.hasAttribute("hidden")
    ).toBe(true);
  });

  it("trades tab with no fills reports the honest empty state", () => {
    renderWorkspace(<StrategyWorkspace {...workspaceProps()} />);

    fireEvent.click(screen.getByRole("tab", { name: /recent trades/i }));
    expect(screen.getByText("No recent trades")).toBeDefined();
  });

  it("ages the active tab's source honestly (never-fetched = Never updated)", () => {
    renderWorkspace(<StrategyWorkspace {...workspaceProps()} />);

    // The strip chip (below xl) plus each xl panel header chip — every one
    // must honestly say "Never updated" rather than inventing an age.
    expect(screen.getAllByText("Never updated").length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("renders no chart — it lives in the page-level panel now (F5)", () => {
    // The chart used to be inside this pane, which only renders when a
    // strategy is selected: a fresh account saw no chart at all and the
    // create/edit form covered it. It is now StrategyChartPanel, mounted by
    // the page. This guard keeps it from creeping back in.
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ orders: [ORDER] })} />
    );

    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
    expect(screen.queryByLabelText("Chart symbol")).toBeNull();
  });

  it("narrows the positions book to the strategy's market and labels the attribution", () => {
    renderWorkspace(
      <StrategyWorkspace
        {...workspaceProps({
          positions: [
            {
              symbol: "PERP_ETH_USDC",
              position_qty: "0.5",
              unsettled_pnl: "10",
              mark_price: "2500",
              average_open_price: "2400",
            },
            {
              symbol: "PERP_BTC_USDC",
              position_qty: "-1",
              unsettled_pnl: "",
              mark_price: "65000",
              average_open_price: "66000",
            },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: /positions/i }));
    expect(screen.getByText(/not strategy-attributed/)).toBeDefined();
    // Only the strategy's market survives the filter — the foreign BTC row
    // never renders, and the count badge reflects the filtered book.
    expect(screen.getByText("PERP_ETH_USDC")).toBeDefined();
    expect(screen.queryByText("PERP_BTC_USDC")).toBeNull();
    expect(screen.getByRole("tab", { name: /positions \(1\)/i })).toBeDefined();
  });

  it("positions tab reports the flat state when the market filter empties the book", () => {
    renderWorkspace(
      <StrategyWorkspace
        {...workspaceProps({
          positions: [
            {
              symbol: "PERP_BTC_USDC",
              position_qty: "-1",
              unsettled_pnl: "",
              mark_price: "65000",
              average_open_price: "66000",
            },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: /positions/i }));
    expect(screen.getByText(/No position on this market/)).toBeDefined();
  });

  it("tolerates non-array positions/orders payloads (Lighter envelope) — never throws", () => {
    // Prod 2026-10-14: `q.filter is not a function` blanked /strategies when
    // the positions payload arrived as `{ rows }` instead of a bare array.
    // The workspace must degrade to empty books, not unmount the page.
    renderWorkspace(
      <StrategyWorkspace
        {...workspaceProps({
          positions: { rows: [] } as unknown as [],
          orders: { data: [] } as unknown as [],
        })}
      />
    );

    expect(screen.getByText("My Grid")).toBeDefined();
    expect(
      screen.getByRole("tab", { name: /open orders \(0\)/i })
    ).toBeDefined();
  });

  it("reads up to 25 recent fills for the trades view (review P2-3)", () => {
    renderWorkspace(<StrategyWorkspace {...workspaceProps()} />);

    expect(recentTradesCalls[recentTradesCalls.length - 1]?.limit).toBe(25);
  });

  it("names the bound venue account in the header (review P2-5)", () => {
    renderWorkspace(
      <StrategyWorkspace
        {...workspaceProps({
          account: {
            id: "acct-7",
            userId: "u1",
            exchange: "lighter",
            environment: "testnet",
            accountRef: "42",
            status: "ACTIVE",
            createdAt: "",
            updatedAt: "",
          },
        })}
      />
    );

    expect(screen.getByText("Lighter testnet · 42")).toBeDefined();
  });

  it("says plainly when no venue account is bound", () => {
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ account: null })} />
    );

    expect(screen.getByText("No venue account bound")).toBeDefined();
  });
});
