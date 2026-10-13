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
import { StrategyWorkspace } from "./StrategyWorkspace";

vi.mock("../bots/components/BotControls", () => ({
  BotControls: () => <div data-testid="bot-controls" />,
}));

// The workspace calls the real hook (query-keyed per strategyId); the hook is
// the only seam, mocked at the module boundary with per-key rows.
const fillsByStrategy: Record<string, unknown[]> = {};
vi.mock("../../../shared/hooks", () => ({
  useRecentTrades: (filters?: { strategyId?: string }) => ({
    trades: fillsByStrategy[filters?.strategyId ?? ""] ?? [],
    isLoading: false,
    error: null,
    dataUpdatedAt: 0,
  }),
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
    onEdit: (s: Strategy) => void;
    onDelete: (s: Strategy) => void;
  }> = {}
) => ({
  strategy: STRATEGY,
  bot: BOT,
  orders: [] as OpenOrderRow[],
  ordersLoading: false,
  ordersError: false,
  ordersUpdatedAt: 0,
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onBotStatusChange: vi.fn(),
  ...overrides,
});

describe("StrategyWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(screen.getByText("Never updated")).toBeDefined();
  });
});
