/** @format */

/**
 * StrategyOverview contract (Phase 2 IA): a real operational strip whose four
 * buckets are DISJOINT (needs-attention > running > transitional > stopped) so
 * they always sum to the total and never double-count. Zero-count tiles are
 * dimmed, and the header states the true bot total.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BotInstance } from "../types/strategies.types";
import { summarizeBotStates } from "../utils/summarizeBotStates";
import { StrategyOverview } from "./StrategyOverview";

const bot = (overrides: Partial<BotInstance> = {}): BotInstance =>
  ({
    id: "b1",
    status: "STOPPED",
    total_trades: 0,
    total_pnl: 0,
    last_updated: "2026-10-13T10:00:00.000Z",
    config: { type: "GRID", config: { symbol: "PERP_ETH_USDC" } },
    runs: [],
    ...overrides,
  }) as unknown as BotInstance;

describe("summarizeBotStates", () => {
  it("returns all-zero buckets for an empty list", () => {
    expect(summarizeBotStates([])).toEqual({
      running: 0,
      transitional: 0,
      stopped: 0,
      needsAttention: 0,
      total: 0,
    });
  });

  it("buckets each real status into exactly one field", () => {
    const summary = summarizeBotStates([
      bot({ status: "RUNNING" }),
      bot({ status: "STOPPED" }),
      bot({ status: "STARTING" }),
      bot({ status: "STOPPING" }),
    ]);
    expect(summary).toEqual({
      running: 1,
      transitional: 2,
      stopped: 1,
      needsAttention: 0,
      total: 4,
    });
  });

  it("prioritises needs-attention over every other bucket (disjoint)", () => {
    // UNKNOWN / ERROR are lost-engine states; needsUserAction parks ANY state.
    const summary = summarizeBotStates([
      bot({ status: "UNKNOWN" }),
      bot({ status: "ERROR" }),
      bot({ status: "RUNNING", needsUserAction: true }),
      bot({ status: "STOPPED", needsUserAction: true }),
      bot({ status: "RUNNING" }),
    ]);
    expect(summary.needsAttention).toBe(4);
    expect(summary.running).toBe(1);
    expect(summary.transitional).toBe(0);
    expect(summary.stopped).toBe(0);
    expect(summary.total).toBe(5);
  });

  it("keeps transitional (STARTING/STOPPING) out of running and stopped", () => {
    const summary = summarizeBotStates([
      bot({ status: "STARTING" }),
      bot({ status: "STOPPING" }),
    ]);
    expect(summary.transitional).toBe(2);
    expect(summary.running).toBe(0);
    expect(summary.stopped).toBe(0);
  });

  it("always sums the four buckets to the total", () => {
    const bots = [
      bot({ status: "RUNNING" }),
      bot({ status: "UNKNOWN" }),
      bot({ status: "STARTING" }),
      bot({ status: "STOPPED" }),
      bot({ status: "ERROR", needsUserAction: true }),
    ];
    const s = summarizeBotStates(bots);
    expect(s.running + s.transitional + s.stopped + s.needsAttention).toBe(
      s.total
    );
  });
});

describe("StrategyOverview", () => {
  it("renders the header with the real bot total (pluralisation)", () => {
    render(<StrategyOverview bots={[bot(), bot()]} />);
    expect(screen.getByText("Overview")).toBeDefined();
    expect(screen.getByText("2 bots total")).toBeDefined();
  });

  it("uses singular '1 bot total' for a single bot", () => {
    render(<StrategyOverview bots={[bot({ status: "RUNNING" })]} />);
    expect(screen.getByText("1 bot total")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();
  });

  it("shows a zero total with correct pluralisation when there are no bots", () => {
    render(<StrategyOverview bots={[]} />);
    expect(screen.getByText("0 bots total")).toBeDefined();
  });

  it("renders all four tile labels", () => {
    render(<StrategyOverview bots={[]} />);
    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.getByText("Starting / stopping")).toBeDefined();
    expect(screen.getByText("Needs attention")).toBeDefined();
    expect(screen.getByText("Stopped")).toBeDefined();
  });

  it("renders the live counts from the summarizer", () => {
    render(
      <StrategyOverview
        bots={[
          bot({ status: "RUNNING" }),
          bot({ status: "RUNNING" }),
          bot({ status: "UNKNOWN" }),
        ]}
      />
    );
    // Two running, one needs-attention, none stopped/transitional.
    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.getByText("Needs attention")).toBeDefined();
    // Counts appear as the bold number in each tile.
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });
});
