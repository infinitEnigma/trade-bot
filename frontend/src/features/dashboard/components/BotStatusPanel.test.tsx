/** @format */

/**
 * BotStatusPanel (Stage 3): VERIFIED's operational summary head.
 * Needs-attention first with reasons; counts row; account labels shown
 * where present, bots never filtered; links only, no controls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BotInstance } from "../../strategies/types/strategies.types";

const mockUseBotsList = vi.fn();
vi.mock("../../bots/hooks", () => ({
  useBotsList: () => mockUseBotsList(),
}));

import { BotStatusPanel } from "./BotStatusPanel";

const bot = (overrides: Partial<BotInstance> = {}): BotInstance =>
  ({
    id: "bot-1",
    status: "STOPPED",
    total_trades: 0,
    total_pnl: 0,
    last_updated: "2026-10-13T10:00:00.000Z",
    config: { type: "GRID", config: { symbol: "PERP_ETH_USDC" } },
    runs: [],
    ...overrides,
  }) as unknown as BotInstance;

const renderPanel = (accountLabels: Record<string, string> = {}) =>
  render(
    <MemoryRouter>
      <BotStatusPanel accountLabels={accountLabels} />
    </MemoryRouter>
  );

describe("BotStatusPanel (Stage 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("0 bots → empty state with a Strategies link, no counts", () => {
    mockUseBotsList.mockReturnValue({ bots: [], isLoading: false });
    renderPanel();

    expect(screen.getByText("No bots yet")).toBeInTheDocument();
    expect(screen.getByText("Open Strategies")).toBeInTheDocument();
    expect(screen.queryByText(/running/)).not.toBeInTheDocument();
  });

  it("all-running → counts row, no attention list", () => {
    mockUseBotsList.mockReturnValue({
      bots: [
        bot({ id: "a", status: "RUNNING" }),
        bot({ id: "b", status: "RUNNING" }),
      ],
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByText("2 bots")).toBeInTheDocument();
    expect(screen.getByText("2 running")).toBeInTheDocument();
    expect(screen.queryByText(/needs attention/)).not.toBeInTheDocument();
  });

  it("needs-attention renders FIRST with the reason shown", () => {
    mockUseBotsList.mockReturnValue({
      bots: [
        bot({ id: "ok-1", status: "RUNNING" }),
        bot({
          id: "bad-1",
          status: "ERROR",
          needsUserAction: true,
          needsUserActionReason: "engine_lost",
        }),
      ],
      isLoading: false,
    });
    renderPanel();

    // Counts row still disjoint: 1 running + 1 needs-attention of 2.
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("1 needs attention")).toBeInTheDocument();
    // The reason surfaces — never a bare red badge.
    expect(screen.getByText("engine_lost")).toBeInTheDocument();
    // Attention list comes before the manage link in DOM order.
    const reason = screen.getByText("engine_lost");
    const manage = screen.getByText("Manage Strategies");
    expect(
      reason.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("UNKNOWN without an explicit reason still explains the next action", () => {
    mockUseBotsList.mockReturnValue({
      bots: [bot({ id: "u1", status: "UNKNOWN" })],
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByText("1 needs attention")).toBeInTheDocument();
    expect(
      screen.getByText(/Connection to the trading engine was lost/)
    ).toBeInTheDocument();
  });

  it("transitional buckets stay disjoint from running and stopped", () => {
    mockUseBotsList.mockReturnValue({
      bots: [
        bot({ id: "s1", status: "STARTING" }),
        bot({ id: "s2", status: "STOPPING" }),
        bot({ id: "r1", status: "RUNNING" }),
        bot({ id: "x1", status: "STOPPED" }),
      ],
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByText("4 bots")).toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("2 starting / stopping")).toBeInTheDocument();
    expect(screen.getByText("1 stopped")).toBeInTheDocument();
  });

  it("shows the account label where present; legacy null-id bots still render", () => {
    mockUseBotsList.mockReturnValue({
      bots: [
        // Account labels render on the needs-attention rows (the operator
        // needs to know WHICH account needs them); healthy rows stay compact.
        bot({
          id: "bound",
          status: "ERROR",
          needsUserAction: true,
          needsUserActionReason: "engine_lost",
          exchange_account_id: "acct-1",
        }),
        bot({ id: "legacy", status: "STOPPED", exchange_account_id: null }),
      ],
      isLoading: false,
    });
    renderPanel({ "acct-1": "lighter (testnet) idx-1" });

    // Bound bot shows its label…
    expect(screen.getByText("lighter (testnet) idx-1")).toBeInTheDocument();
    // …and the legacy unbound bot is NOT filtered out (2 total).
    expect(screen.getByText("2 bots")).toBeInTheDocument();
  });

  it("links into /strategies only — no start/stop controls", () => {
    mockUseBotsList.mockReturnValue({
      bots: [bot({ id: "r1", status: "RUNNING" })],
      isLoading: false,
    });
    renderPanel();

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/strategies");
    }
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
