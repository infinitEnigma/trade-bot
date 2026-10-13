/** @format */

/**
 * BotStatusBadge contract (P1 lifecycle clarity): every real bot state gets
 * its own label — transitional STARTING/STOPPING are NOT rendered as failures
 * — and the two operator-action conditions (reconcile-park `needsUserAction`
 * and a lost-engine `UNKNOWN`) collapse to a distinct "Needs attention" state
 * that carries an explanation of the next safe action, never a bare red badge.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BotInstance } from "../types/strategies.types";
import { BotStatusBadge } from "./BotStatusBadge";

const bot = (overrides: Partial<BotInstance> = {}): BotInstance =>
  ({
    id: "b1",
    status: "RUNNING",
    total_trades: 0,
    total_pnl: 0,
    last_updated: "2026-10-12T10:00:00.000Z",
    config: { type: "GRID", config: { symbol: "PERP_ETH_USDC" } },
    runs: [],
    ...overrides,
  }) as unknown as BotInstance;

describe("BotStatusBadge", () => {
  it("labels RUNNING as Running with its own (success) styling", () => {
    render(<BotStatusBadge bot={bot({ status: "RUNNING" })} />);
    expect(screen.getByText("Running")).toBeDefined();
  });

  it("does NOT render transitional STARTING/STOPPING as failures", () => {
    const { rerender } = render(
      <BotStatusBadge bot={bot({ status: "STARTING" })} />
    );
    expect(screen.getByText("Starting…")).toBeDefined();
    rerender(<BotStatusBadge bot={bot({ status: "STOPPING" })} />);
    expect(screen.getByText("Stopping…")).toBeDefined();
    // Neither reads as "Needs attention".
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("labels STOPPED distinctly from the transitional states", () => {
    render(<BotStatusBadge bot={bot({ status: "STOPPED" })} />);
    expect(screen.getByText("Stopped")).toBeDefined();
  });

  it("maps a lost-engine UNKNOWN to 'Needs attention' with an explanation", () => {
    render(<BotStatusBadge bot={bot({ status: "UNKNOWN" })} />);
    expect(screen.getByText("Needs attention")).toBeDefined();
    expect(screen.getByText(/without duplicating it/i)).toBeDefined();
  });

  it("maps a reconcile-park (needsUserAction) to 'Needs attention' with the reason", () => {
    render(
      <BotStatusBadge
        bot={bot({
          status: "ERROR",
          needsUserAction: true,
          needsUserActionReason: "engine_lost",
        })}
      />
    );
    expect(screen.getByText("Needs attention")).toBeDefined();
    expect(screen.getByText("engine_lost")).toBeDefined();
  });

  it("hides the explanation line when hideDetail is set", () => {
    render(<BotStatusBadge bot={bot({ status: "UNKNOWN" })} hideDetail />);
    expect(screen.getByText("Needs attention")).toBeDefined();
    expect(screen.queryByText(/without duplicating it/i)).toBeNull();
  });
});
