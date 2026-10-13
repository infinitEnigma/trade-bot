/** @format */

/**
 * StrategyMasterList (Phase 3 slice 4): the master half — one selectable row
 * per strategy, the workspace's current selection marked via aria-current,
 * clicks reporting the strategy, and each row's live bot state resolved
 * through the hosting session (D4).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Strategy, StrategyType } from "../../../shared/types";
import type { BotInstance } from "../types/strategies.types";
import { StrategyMasterList } from "./StrategyMasterList";

const strategy = (id: string, name: string): Strategy =>
  ({
    id,
    userId: "u1",
    name,
    type: StrategyType.GRID,
    config: { symbol: "PERP_BTC_USDC", leverage: 1 },
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Strategy;

const HOSTED_BOT = {
  id: "b1",
  status: "RUNNING",
  total_trades: 0,
  total_pnl: 0,
  last_updated: "2026-10-12T10:00:00.000Z",
  config: { type: StrategyType.GRID, config: { symbol: "PERP_BTC_USDC" } },
  runs: [
    {
      id: "r1",
      strategy_id: "s1",
      config_version: 1,
      config: {},
      notional_amount: "100",
      state: "RUNNING",
      last_error_code: null,
    },
  ],
} as unknown as BotInstance;

describe("StrategyMasterList", () => {
  it("renders one row per strategy with type and market", () => {
    render(
      <StrategyMasterList
        strategies={[
          strategy("s1", "Grid Alpha"),
          strategy("s2", "Trend Beta"),
        ]}
        bots={[]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText("Grid Alpha")).toBeDefined();
    expect(screen.getByText("Trend Beta")).toBeDefined();
    expect(screen.getAllByText(/BTC/)).toHaveLength(2);
  });

  it("marks the workspace's selection and reports clicks with the strategy", () => {
    const onSelect = vi.fn();
    render(
      <StrategyMasterList
        strategies={[
          strategy("s1", "Grid Alpha"),
          strategy("s2", "Trend Beta"),
        ]}
        bots={[]}
        selectedId="s1"
        onSelect={onSelect}
      />
    );

    expect(
      screen
        .getByText("Grid Alpha")
        .closest("button")
        ?.getAttribute("aria-current")
    ).toBe("true");
    expect(
      screen
        .getByText("Trend Beta")
        .closest("button")
        ?.getAttribute("aria-current")
    ).toBeNull();

    fireEvent.click(screen.getByText("Trend Beta"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("s2");
  });

  it("shows the hosted session's live bot state on the row", () => {
    render(
      <StrategyMasterList
        strategies={[strategy("s1", "Grid Alpha")]}
        bots={[HOSTED_BOT]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText("Running")).toBeDefined();
  });
});
