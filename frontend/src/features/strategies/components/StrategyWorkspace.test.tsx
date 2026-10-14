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
import type { OpenOrderRow } from "../../../infrastructure/api/market";
import type { AccountPositionRow } from "../../../infrastructure/api/market";
import type { ExchangeAccountDto } from "../../../infrastructure/api/accounts";
import type {
  ChartSelection,
  ChartSymbolGroup,
} from "../utils/chartSymbolPicker";
import { StrategyWorkspace } from "./StrategyWorkspace";

vi.mock("../bots/components/BotControls", () => ({
  BotControls: () => <div data-testid="bot-controls" />,
}));

// The workspace lazy-loads the real chart (lightweight-charts); stub it for a
// fast, stable test that still proves symbol + book forwarding (Phase 3.1).
vi.mock("../../../shared/components/charts/CandlestickChart", () => ({
  default: (props: { symbol?: string; orders?: unknown }) => (
    <div
      data-testid="candlestick-chart"
      data-symbol={props.symbol ?? ""}
      data-orders={JSON.stringify(props.orders ?? null)}
    />
  ),
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
    chartSelection?: ChartSelection;
    chartGroups?: ChartSymbolGroup[];
    chartOptionCount?: number;
    onChartSelectionChange?: (s: ChartSelection) => void;
    onEdit: (s: Strategy) => void;
    onDelete: (s: Strategy) => void;
  }> = {}
) => ({
  strategy: STRATEGY,
  bot: BOT,
  account: null,
  chartSelection: {
    symbol: "PERP_ETH_USDC",
    exchange: "lighter",
    environment: "mainnet",
  } as ChartSelection,
  chartGroups: [] as ChartSymbolGroup[],
  chartOptionCount: 1,
  onChartSelectionChange: vi.fn(),
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
    for (const key of Object.keys(fillsByStrategy)) delete fillsByStrategy[key];
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

  it("shows bot stats with the honest incomplete realized PnL", () => {
    renderWorkspace(<StrategyWorkspace {...workspaceProps()} />);

    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText(/\$12\.50/)).toBeDefined();
    expect(screen.getByText(/incomplete, 2 unknown/)).toBeDefined();
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

  it("charts the strategy's market and forwards the strategy-scoped book", async () => {
    renderWorkspace(
      <StrategyWorkspace {...workspaceProps({ orders: [ORDER] })} />
    );

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-symbol")).toBe("PERP_ETH_USDC");
    expect(chart.getAttribute("data-orders")).toContain("ord-1");
    expect(chart.getAttribute("data-orders")).toContain("2500");
  });

  it("shows the picker when several symbols are offered", async () => {
    renderWorkspace(
      <StrategyWorkspace
        {...workspaceProps({
          chartOptionCount: 2,
          chartGroups: [
            {
              label: "Lighter mainnet",
              exchange: "lighter",
              environment: "mainnet",
              symbols: ["ETH", "BTC"],
            },
          ],
        })}
      />
    );

    expect(screen.getByLabelText("Chart symbol")).toBeDefined();
    await screen.findByTestId("candlestick-chart");
  });

  it("draws no order levels once the chart detaches to another market", async () => {
    renderWorkspace(
      <StrategyWorkspace
        {...workspaceProps({
          orders: [ORDER],
          chartSelection: {
            symbol: "PERP_BTC_USDC",
            exchange: "kodiak",
            environment: "mainnet",
          },
        })}
      />
    );

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-orders")).toBe("[]");
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
