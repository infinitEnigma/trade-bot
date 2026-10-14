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
    /** Absent under `{ withoutDepth: true }` — the legacy-fake shape. */
    getMarketDepth?: jest.Mock;
  };
  manager: BotManager;
}

interface RegisterOptions {
  /** Omit `getMarketDepth` so the "adapter without depth" fallback is testable. */
  withoutDepth?: boolean;
  /**
   * Account identity the fake client reports (the `getAccountIdentity` seam).
   * Omit to exercise the "adapter cannot report an account" path, where the
   * co-tenant guard must treat the sibling as sharing the position.
   */
  accountIdentity?: string;
}

/**
 * Register a RUNNING bot directly (no strategy runner), so the emergency path
 * can be exercised without the credentials/venue start-up chain.
 */
function registerBot(
  botId: string,
  symbol: string,
  options: RegisterOptions = {}
): RuntimeHarness {
  const manager = new BotManager({
    engineId: "engine-1",
    epoch: 1,
  } as EngineIdentity);
  const strategyStop = jest.fn().mockResolvedValue([]);
  const stopTick = jest.fn();
  const accountIdentity = options.accountIdentity;
  const client = {
    listOpenOrders: jest.fn().mockResolvedValue([]),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    getPositions: jest.fn().mockResolvedValue([]),
    createOrder: jest
      .fn()
      .mockResolvedValue({ orderId: "close-1", status: "SUBMITTED" }),
    // The account-identity seam: present only when the test asks for it, so
    // the "adapter cannot report an account" path stays exercisable.
    ...(accountIdentity !== undefined
      ? { getAccountIdentity: (): string => accountIdentity }
      : {}),
    // Deep book (100 ETH inside every band around the tests' 3000 mark):
    // slices stay FULL-size unless a test scripts a thin book.
    ...(options.withoutDepth
      ? {}
      : {
          getMarketDepth: jest.fn().mockResolvedValue({
            symbol,
            bids: [{ price: 2990, quantity: 100 }],
            asks: [{ price: 3010, quantity: 100 }],
          }),
        }),
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

/**
 * Script a live position that SHRINKS by each flatten slice's quantity (the
 * venue fills every submitted slice) — under the P0.1 discipline the loop's
 * own re-reads verify the flat, so this is the happy path. The row reports
 * `eth` (lowercase) to keep symbolsMatch's case-insensitivity covered.
 */
function scriptShrinkingPosition(
  harness: RuntimeHarness,
  initialQty: number,
  extraRows: Array<{
    symbol: string;
    position_qty: number;
    mark_price: number;
  }> = []
): void {
  let live = initialQty;
  harness.client.getPositions.mockImplementation(async () => [
    ...(live === 0
      ? []
      : [{ symbol: "eth", position_qty: live, mark_price: 3000 }]),
    ...extraRows,
  ]);
  harness.client.createOrder.mockImplementation(
    async (request: { orderQuantity: number }) => {
      live =
        live > 0
          ? Math.max(0, live - request.orderQuantity)
          : Math.min(0, live + request.orderQuantity);
      return { orderId: "close-1", status: "FILLED" };
    }
  );
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
    // The venue fills the full-size slice (deep book) and the loop's re-read
    // verifies the flat — other symbols' rows are never matched.
    scriptShrinkingPosition(harness, 2.5, [
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
    // Opposite MARKET slice sized to the position (deep book keeps it
    // full-size), reduce-only, base-band — other symbols untouched.
    expect(harness.client.createOrder).toHaveBeenCalledWith({
      symbol: "ETH",
      side: "SELL",
      orderType: "MARKET",
      orderQuantity: 2.5,
      reduceOnly: true,
      maxSlippageBps: 100,
    });
    expect(transitions(published)).toEqual([
      "RUNNING->STOPPING",
      "STOPPING->STOPPED",
    ]);
    // Venue-verified flat: the terminal reason stays CLEAN (no residue marker).
    expect(reasons(published)).toEqual([
      "emergency_stop:FULL_SHUTDOWN",
      "emergency_stop:FULL_SHUTDOWN",
    ]);
  });

  it("flattens a short position with a BUY", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    scriptShrinkingPosition(harness, -0.4);

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
        reduceOnly: true,
        maxSlippageBps: 100,
      })
    );
    // Venue-verified flat → clean terminal report.
    expect(reasons(published)).toEqual([
      "emergency_stop:CLOSE_POSITIONS",
      "emergency_stop:CLOSE_POSITIONS",
    ]);
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

  it("skips the flatten while a sibling bot shares the account and symbol", async () => {
    const first = registerBot("bot-1", "ETH", { accountIdentity: "acct-A" });
    // Same account, same symbol: the sibling owns the position too.
    first.manager.getBotRuntimes().set("bot-2", {
      ...first.runtime,
      botId: "bot-2",
    });
    const { ops } = makeStreamOps();

    await first.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-4"
    );

    // Orders are still cancelled - only the shared position is left alone.
    expect(first.client.listOpenOrders).toHaveBeenCalledWith("ETH");
    expect(first.client.createOrder).not.toHaveBeenCalled();
    // The venue IS read: a skip must know whether anything is still open
    // rather than claiming a clean stop blindly.
    expect(first.client.getPositions).toHaveBeenCalled();
  });

  it("reports the shared position a skipped flatten leaves open", async () => {
    // The silent-success bug: the guard used to return "no problems" while a
    // 2 ETH position sat open, so no cleanup_incomplete marker and no banner.
    const first = registerBot("bot-1", "ETH", { accountIdentity: "acct-A" });
    first.manager.getBotRuntimes().set("bot-2", {
      ...first.runtime,
      botId: "bot-2",
    });
    first.client.getPositions.mockResolvedValue([
      { symbol: "ETH", position_qty: 2, mark_price: 3000 },
    ]);
    const { published, ops } = makeStreamOps();

    await first.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-4b"
    );

    const [, stopped] = reasons(published);
    expect(stopped).toContain("cleanup_incomplete");
    expect(stopped).toContain("2 ETH still open");
    // Names the bot that owns closing it - the operator's next action.
    expect(stopped).toContain("bot-2");
    expect(first.client.createOrder).not.toHaveBeenCalled();
  });

  it("treats an unreportable account identity as shared (never distinct)", async () => {
    // Guessing "different account" here would close the sibling's position.
    const first = registerBot("bot-1", "ETH");
    first.manager.getBotRuntimes().set("bot-2", {
      ...first.runtime,
      botId: "bot-2",
    });
    first.client.getPositions.mockResolvedValue([
      { symbol: "ETH", position_qty: 1.5, mark_price: 3000 },
    ]);
    const { published, ops } = makeStreamOps();

    await first.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-4c"
    );

    const [, stopped] = reasons(published);
    expect(stopped).toContain("1.5 ETH still open");
    expect(first.client.createOrder).not.toHaveBeenCalled();
  });

  it("flattens when the sibling bot trades the same symbol on ANOTHER account", async () => {
    // The two-account case: independent positions, so this bot's exposure is
    // its own to close. Keyed on account identity, not symbol alone.
    const first = registerBot("bot-1", "ETH", { accountIdentity: "acct-A" });
    first.manager.getBotRuntimes().set("bot-2", {
      ...first.runtime,
      botId: "bot-2",
    });
    const secondClient = {
      ...first.client,
      getAccountIdentity: (): string => "acct-B",
    };
    first.manager.getBotRuntimes().set("bot-2", {
      ...first.runtime,
      botId: "bot-2",
      exchangeClient: secondClient as unknown as BotRuntime["exchangeClient"],
    });
    scriptShrinkingPosition(first, 3);
    const { published, ops } = makeStreamOps();

    await first.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-4d"
    );

    expect(first.client.createOrder).toHaveBeenCalled();
    expect(reasons(published)[1]).not.toContain("cleanup_incomplete");
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

  it("walks a thin book in depth-sized clips until the venue reads flat", async () => {
    // The 2026-10-14 incident shape: only 0.5 ETH rests inside the crossing
    // band — a full-size order fills 0.5 and cancels the rest. The loop must
    // clip each slice to the reported depth and re-read until flat.
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    let live = 2;
    harness.client.getPositions.mockImplementation(async () =>
      live === 0
        ? []
        : [{ symbol: "ETH", position_qty: live, mark_price: 3000 }]
    );
    harness.client.getMarketDepth?.mockResolvedValue({
      symbol: "ETH",
      bids: [{ price: 2995, quantity: 0.5 }],
      asks: [],
    });
    harness.client.createOrder.mockImplementation(
      async (request: { orderQuantity: number }) => {
        live -= request.orderQuantity;
        return { orderId: `slice-${request.orderQuantity}`, status: "FILLED" };
      }
    );

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-thin"
    );

    // Four clips of the resting 0.5 — every slice shrank the position, so
    // the band stays at the base rung throughout.
    expect(harness.client.createOrder).toHaveBeenCalledTimes(4);
    for (const [request] of harness.client.createOrder.mock.calls) {
      expect(request).toMatchObject({
        symbol: "ETH",
        side: "SELL",
        orderType: "MARKET",
        orderQuantity: 0.5,
        reduceOnly: true,
        maxSlippageBps: 100,
      });
    }
    // Venue-verified flat → clean terminal report, no residue marker.
    expect(reasons(published)).toEqual([
      "emergency_stop:FULL_SHUTDOWN",
      "emergency_stop:FULL_SHUTDOWN",
    ]);
  });

  it("adopts a submitted-but-unconfirmed slice when the position actually shrank", async () => {
    // The engine's adapter reported UNRESOLVED (submitted, not yet visible)
    // while the venue DID execute — the position delta is the ground truth,
    // so the loop ends clean instead of blind-failing the flatten.
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    let live = 2;
    harness.client.getPositions.mockImplementation(async () =>
      live === 0
        ? []
        : [{ symbol: "ETH", position_qty: live, mark_price: 3000 }]
    );
    harness.client.createOrder.mockImplementation(async () => {
      live = 0; // the venue executed despite the engine's UNRESOLVED
      throw new Error(
        "lighter create UNRESOLVED for 42 (submitted, not yet visible)"
      );
    });

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-late"
    );

    expect(reasons(published)).toEqual([
      "emergency_stop:FULL_SHUTDOWN",
      "emergency_stop:FULL_SHUTDOWN",
    ]);
  });

  it("escalates the band only on no-progress, then reports the verified residual", async () => {
    // Nothing shrinks: every slice fails the same way. The band climbs the
    // bounded ladder [100, 150, 225, 300], then the loop reports the EXACT
    // residual the venue still holds — never a silent success.
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    harness.client.getPositions.mockResolvedValue([
      { symbol: "ETH", position_qty: 2.5, mark_price: 3000 },
    ]);
    harness.client.createOrder.mockRejectedValue(
      new Error("venue refused the order")
    );

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-band"
    );

    expect(
      harness.client.createOrder.mock.calls.map(([request]) => {
        const { maxSlippageBps } = request as { maxSlippageBps: number };
        return maxSlippageBps;
      })
    ).toEqual([100, 150, 225, 300]);
    const [, stopped] = reasons(published);
    expect(stopped).toContain("cleanup_incomplete");
    expect(stopped).toContain("position 2.5 ETH not flattened");
    expect(stopped).toContain("venue refused the order");
  });

  it("verifies flat on the final read when the last slice filled late", async () => {
    // Reads 1-5 still see the position (the submits never confirm); the
    // FINAL verification read after the loop sees the venue flat — a late
    // fill is adopted, never reported as residue.
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    let reads = 0;
    harness.client.getPositions.mockImplementation(async () => {
      reads += 1;
      return reads <= 5
        ? [{ symbol: "ETH", position_qty: 2.5, mark_price: 3000 }]
        : [];
    });
    harness.client.createOrder.mockRejectedValue(
      new Error("lighter create UNRESOLVED for 7 (submitted, not yet visible)")
    );

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-late-final"
    );

    expect(reasons(published)).toEqual([
      "emergency_stop:FULL_SHUTDOWN",
      "emergency_stop:FULL_SHUTDOWN",
    ]);
  });

  it("falls back to a full-size slice when the adapter cannot report depth", async () => {
    // Legacy adapters (and fakes) have no getMarketDepth — the flatten must
    // still work, sized to the position (the pre-P0.1 behaviour, now verified).
    const harness = registerBot("bot-1", "ETH", { withoutDepth: true });
    const { published, ops } = makeStreamOps();
    scriptShrinkingPosition(harness, 0.4);

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-nodepth"
    );

    expect(harness.client.createOrder).toHaveBeenCalledTimes(1);
    expect(harness.client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderQuantity: 0.4, maxSlippageBps: 100 })
    );
    expect(reasons(published)).toEqual([
      "emergency_stop:FULL_SHUTDOWN",
      "emergency_stop:FULL_SHUTDOWN",
    ]);
  });

  it("degrades a failing depth read to a full-size slice, never a skip", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    scriptShrinkingPosition(harness, 0.4);
    harness.client.getMarketDepth?.mockRejectedValue(
      new Error("lighter unreachable (depth): connect ECONNREFUSED")
    );

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-depthdown"
    );

    expect(harness.client.createOrder).toHaveBeenCalledTimes(1);
    expect(harness.client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderQuantity: 0.4 })
    );
    expect(reasons(published)).toEqual([
      "emergency_stop:FULL_SHUTDOWN",
      "emergency_stop:FULL_SHUTDOWN",
    ]);
  });

  it("reports the initial position fetch failure as exposure unknown", async () => {
    const harness = registerBot("bot-1", "ETH");
    const { published, ops } = makeStreamOps();
    harness.client.getPositions.mockRejectedValue(new Error("venue down"));

    await harness.manager.handleEmergencyStop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-fetchfail"
    );

    const [, stopped] = reasons(published);
    expect(stopped).toContain("cleanup_incomplete");
    expect(stopped).toContain(
      "position fetch failed (exposure unknown): venue down"
    );
    expect(harness.client.createOrder).not.toHaveBeenCalled();
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
