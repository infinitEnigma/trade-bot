/** @format */

import { BotRuntime, EngineIdentity } from "../../domain/bot-runtime";
import type { GridTradingStrategy } from "../../strategies/grid";
import { BotManager, CLEANUP_INCOMPLETE_MARKER } from "../bot-manager";

jest.mock("../../protocol/credential-fetcher", () => ({
  fetchCredentials: jest.fn(),
}));

jest.mock("../../exchanges/factory", () => ({
  createExchangeClient: jest.fn(),
}));

function makeStreamOps(): {
  published: Array<{ type: string; payload: Record<string, unknown> }>;
  ops: { publish: jest.Mock; [key: string]: unknown };
} {
  const published: Array<{ type: string; payload: Record<string, unknown> }> =
    [];
  const ops = {
    publish: jest.fn(
      async (_stream: string, message: Record<string, unknown>) => {
        published.push({
          type: String(message.type),
          payload: (message.payload ?? {}) as Record<string, unknown>,
        });
        return { success: true as const };
      }
    ),
  };
  return { published, ops };
}

interface RuntimeHarness {
  runtime: BotRuntime;
  strategyStop: jest.Mock;
  stopTick: jest.Mock;
  client: {
    listOpenOrders: jest.Mock;
    cancelOrder: jest.Mock;
    getPositions: jest.Mock;
    createOrder: jest.Mock;
  };
  manager: BotManager;
}

/**
 * Register a RUNNING bot directly (no strategy runner), so the emergency path
 * can be exercised without the credentials/venue start-up chain.
 */
function registerBot(botId: string, symbol: string): RuntimeHarness {
  const manager = new BotManager({
    engineId: "engine-1",
    epoch: 1,
  } as EngineIdentity);
  const strategyStop = jest.fn().mockResolvedValue([]);
  const stopTick = jest.fn();
  const client = {
    listOpenOrders: jest.fn().mockResolvedValue([]),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    getPositions: jest.fn().mockResolvedValue([]),
    createOrder: jest
      .fn()
      .mockResolvedValue({ orderId: "close-1", status: "SUBMITTED" }),
  };
  const runtime: BotRuntime = {
    botId,
    strategyId: "strategy-1",
    userId: "user-1",
    symbol,
    state: "RUNNING",
    strategy: { stop: strategyStop } as unknown as GridTradingStrategy,
    stopTick,
    exchangeClient: client as unknown as BotRuntime["exchangeClient"],
  };
  manager.getBotRuntimes().set(botId, runtime);
  return { runtime, strategyStop, stopTick, client, manager };
}

/** STATE_CHANGED transitions in publication order, e.g. "RUNNING->STOPPING". */
function transitions(
  published: Array<{ type: string; payload: Record<string, unknown> }>
): string[] {
  return published
    .filter(entry => entry.type === "STATE_CHANGED")
    .map(entry => `${String(entry.payload.from)}->${String(entry.payload.to)}`);
}

/** Reasons of the STATE_CHANGED reports, in publication order. */
function reasons(
  published: Array<{ type: string; payload: Record<string, unknown> }>
): string[] {
  return published
    .filter(entry => entry.type === "STATE_CHANGED")
    .map(entry => String(entry.payload.reason));
}

describe("BotManager.handleEmergencyStop (M1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stops the runner, cancels orphans and flattens a long position", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    harness.client.listOpenOrders.mockResolvedValue([
      { orderId: "o-1", symbol: "ETH", status: "OPEN" },
      { orderId: "o-2", symbol: "ETH", status: "OPEN" },
    ]);
    harness.client.getPositions.mockResolvedValue([
      { symbol: "eth", position_qty: 2.5, mark_price: 3000 },
      { symbol: "BTC", position_qty: 1, mark_price: 60000 },
    ]);

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-1"
    );

    expect(harness.strategyStop).toHaveBeenCalledTimes(1);
    expect(harness.stopTick).toHaveBeenCalledTimes(1);
    expect(harness.manager.hasBot("bot-1")).toBe(false);
    // Orphan sweep for the bot's symbol only.
    expect(harness.client.listOpenOrders).toHaveBeenCalledWith("ETH");
    expect(harness.client.cancelOrder).toHaveBeenCalledTimes(2);
    expect(harness.client.cancelOrder).toHaveBeenCalledWith("o-1", "ETH");
    // Opposite MARKET order sized to the absolute position; other symbols
    // untouched.
    expect(harness.client.createOrder).toHaveBeenCalledWith({
      symbol: "ETH",
      side: "SELL",
      orderType: "MARKET",
      orderQuantity: 2.5,
    });
    expect(transitions(published)).toEqual([
      "RUNNING->STOPPING",
      "STOPPING->STOPPED",
    ]);
  });

  it("flattens a short position with a BUY", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { ops } = makeStreamOps();
    harness.client.getPositions.mockResolvedValue([
      { symbol: "ETH", position_qty: -0.4, mark_price: 3000 },
    ]);

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "CLOSE_POSITIONS",
      "corr-2"
    );

    expect(harness.client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        side: "BUY",
        orderQuantity: 0.4,
      })
    );
  });

  it("CANCEL_ALL_ORDERS cancels but never touches positions", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    harness.client.listOpenOrders.mockResolvedValue([
      { orderId: "o-1", symbol: "ETH", status: "OPEN" },
    ]);

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "CANCEL_ALL_ORDERS",
      "corr-3"
    );

    expect(harness.client.cancelOrder).toHaveBeenCalledTimes(1);
    expect(harness.client.getPositions).not.toHaveBeenCalled();
    expect(harness.client.createOrder).not.toHaveBeenCalled();
    expect(transitions(published)).toEqual([
      "RUNNING->STOPPING",
      "STOPPING->STOPPED",
    ]);
  });

  it("skips the flatten while another bot trades the same symbol", async () => {
    const first = registerBot("bot-1", "ETH");
    // Same account, same symbol: the sibling owns the position too.
    first.manager
      .getBotRuntimes()
      .set("bot-2", { ...first.runtime, botId: "bot-2" });
    const { ops } = makeStreamOps();

    await first.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-4"
    );

    expect(first.client.getPositions).not.toHaveBeenCalled();
    expect(first.client.createOrder).not.toHaveBeenCalled();
    // Orders are still cancelled - only the shared position is left alone.
    expect(first.client.listOpenOrders).toHaveBeenCalledWith("ETH");
  });

  it("completes with the terminal STOPPED report even when cleanup fails", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    harness.strategyStop.mockRejectedValue(new Error("venue down"));
    harness.client.listOpenOrders.mockRejectedValue(new Error("listing down"));

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-5"
    );

    expect(transitions(published)).toEqual([
      "RUNNING->STOPPING",
      "STOPPING->STOPPED",
    ]);
    expect(harness.manager.hasBot("bot-1")).toBe(false);
    // The stop genuinely happened, but the reason must carry the unfinished
    // cleanup so the backend can keep it visible next to the STOPPED row.
    const [stopping, stopped] = reasons(published);
    expect(stopping).toBe("emergency_stop:FULL_SHUTDOWN");
    expect(stopped).toContain("cleanup_incomplete");
    expect(stopped).toContain("open-order listing failed: listing down");
  });

  it("reports a failed flatten in the terminal reason (exposure may remain)", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    harness.client.getPositions.mockResolvedValue([
      { symbol: "ETH", position_qty: 2.5, mark_price: 3000 },
    ]);
    harness.client.createOrder.mockRejectedValue(
      new Error("lighter adapter supports LIMIT orders only, got MARKET")
    );

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-7"
    );

    const [, stopped] = reasons(published);
    expect(stopped).toContain("cleanup_incomplete");
    expect(stopped).toContain("2.5");
    expect(stopped).toContain("not flattened");
    // The badge-clearing report still goes out: a stuck FORCE_STOPPING badge
    // would hide the very fact the operator has to act on.
    expect(transitions(published)).toEqual([
      "RUNNING->STOPPING",
      "STOPPING->STOPPED",
    ]);
  });

  it("keeps the terminal reason clean when every cleanup step succeeds", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-8"
    );

    expect(reasons(published)).toEqual([
      "emergency_stop:FULL_SHUTDOWN",
      "emergency_stop:FULL_SHUTDOWN",
    ]);
  });

  it("reports COMMAND_FAILED for an unknown bot and emits no state change", async () => {
    const { published, ops } = makeStreamOps();
    const manager = new BotManager({
      engineId: "engine-1",
      epoch: 1,
    } as EngineIdentity);

    await manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "ghost",
      "FULL_SHUTDOWN",
      "corr-6"
    );

    const failures = published.filter(entry => entry.type === "COMMAND_FAILED");
    expect(failures).toHaveLength(1);
    expect(failures[0].payload.errorCode).toBe("BOT_NOT_FOUND");
    expect(transitions(published)).toEqual([]);
  });
});

describe("BotManager.handleStop (N5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks the stop incomplete when a cancel is not confirmed", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    harness.strategyStop.mockResolvedValue(["BUY@100 not cancelled: timeout"]);

    await harness.manager.handleStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "corr-la"
    );

    expect(transitions(published)).toEqual([
      "RUNNING->STOPPING",
      "STOPPING->STOPPED",
    ]);
    const [, stopped] = reasons(published);
    expect(stopped).toContain(CLEANUP_INCOMPLETE_MARKER);
    expect(stopped).toContain("not cancelled");
    expect(harness.manager.hasBot("bot-1")).toBe(false);
  });

  it("keeps normal_stop clean when every cancel is confirmed", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();

    await harness.manager.handleStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "corr-lb"
    );

    expect(reasons(published)).toEqual(["normal_stop", "normal_stop"]);
  });
});
