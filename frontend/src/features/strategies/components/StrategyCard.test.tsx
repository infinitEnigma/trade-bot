/** @format */

/**
 * StrategyCard fills section (Batch 4): a bot-backed card offers a collapsed
 * "Recent trades" section with the strategy's latest ledger fills (compact
 * variant); a bot-less card offers NO fills section (nothing could fill it).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Strategy, StrategyType } from "../../../shared/types";
import type { BotInstance } from "../types/strategies.types";
import { StrategyCard } from "./StrategyCard";

vi.mock("../bots/components/BotControls", () => ({
  BotControls: () => null,
}));

// The card calls the real hook (query-keyed per strategyId); the hook is the
// only seam, mocked at the module boundary with per-key rows.
const rowsByStrategy: Record<string, unknown[]> = {};
vi.mock("../../../shared/hooks", () => ({
  useRecentTrades: (filters?: { strategyId?: string }) => ({
    trades: rowsByStrategy[filters?.strategyId ?? ""] ?? [],
    isLoading: false,
    error: null,
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
  total_pnl: 0,
  last_updated: "2026-10-12T10:00:00.000Z",
  config: {
    type: StrategyType.GRID,
    config: { symbol: "PERP_ETH_USDC" },
  },
  runs: [],
} as unknown as BotInstance;

const renderCard = (ui: ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

const cardProps = (overrides: Partial<{ bot?: BotInstance }> = {}) => ({
  strategy: STRATEGY,
  bot: BOT,
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onBotStatusChange: vi.fn(),
  formatCurrency: (v: number) => `$${v}`,
  getStrategyTypeColor: () => "",
  formatStrategyType: () => "Grid",
  ...overrides,
});

describe("StrategyCard fills section (Batch 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(rowsByStrategy)) delete rowsByStrategy[key];
  });

  it("bot-less card shows NO fills section (nothing could fill it)", () => {
    renderCard(<StrategyCard {...cardProps({ bot: undefined })} />);

    expect(screen.queryByText("Recent trades")).toBeNull();
  });

  it("bot-backed card shows a collapsed section that expands to the strategy fills", () => {
    rowsByStrategy["s1"] = [FILL];
    renderCard(<StrategyCard {...cardProps()} />);

    const toggle = screen.getByRole("button", { name: /recent trades/i });
    expect(toggle).toBeDefined();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: the fill's price is not in the document yet.
    expect(screen.queryByText(/2,000\.5/)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/2,000\.5/)).toBeDefined();
  });

  it("bot-backed card with no fills reports the honest empty state on expand", () => {
    renderCard(<StrategyCard {...cardProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /recent trades/i }));
    expect(screen.getByText("No recent trades")).toBeDefined();
  });
});
