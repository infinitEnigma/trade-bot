/**
 * Grid partial-fill lifecycle (Phase 4).
 *
 * Pins the grid half of per-fill accounting: the ledger books **deltas** only
 * (a partial segment, then the remainder — never the whole order twice), a dead
 * order's final executions reach the ledger before the slot clears, arming is
 * quantity-based rather than flag-based, and the quantity state survives a
 * restart without double-applying a cumulative the ledger already has.
 *
 * Risks referenced by id are from `docs/instructions/phase4-partial-fills-plan.md`.
 *
 * @format
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy, isSizeRefusal } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
import { GridStrategyConfig, GridLevel } from "../../types/strategy";
import { SlotOutcome } from "../../domain/order-state";
import {
  FillReport,
  PositionReport,
  TradeReporter,
} from "../../application/trade-reporter";
import { CommandError } from "../../application/command-error";
import { loadGridSnapshot } from "../../infrastructure/state/grid-state";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 2,
  orderQuantity: 1,
  gridRangePercent: 5,
};

/** Levels around 100 at 5% with gridSize 2: 97.5 | 100 | 102.5. */
const LEVEL_0 = 97.5;
const LEVEL_1_SPACING = 2.5;

type MockExchange = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  getPositions: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
};

function makeExchange(): MockExchange {
  let seq = 0;
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
    getOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    createOrder: jest.fn().mockImplementation(async () => ({
      orderId: `O${(seq += 1)}`,
      status: "OPEN",
    })),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    getPositions: jest.fn().mockResolvedValue([]),
    listOpenOrders: jest.fn().mockResolvedValue([]),
    queryOrderByClientOrderId: jest
      .fn()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
  };
}

function makeReporter(): TradeReporter & {
  reportOrderIntent: jest.Mock;
  reportFill: jest.Mock;
  reportPosition: jest.Mock;
  reportPerformance: jest.Mock;
} {
  return {
    reportOrderIntent: jest.fn().mockResolvedValue(true),
    reportFill: jest.fn().mockResolvedValue(undefined),
    reportPosition: jest.fn().mockResolvedValue(undefined),
    reportPerformance: jest.fn().mockResolvedValue(undefined),
  };
}

function makeStrategy(
  botId: string,
  exchange: MockExchange,
  reporter?: TradeReporter,
  config: GridStrategyConfig = CONFIG
): GridTradingStrategy {
  return new GridTradingStrategy(
    botId,
    config,
    exchange as unknown as ExchangeClient,
    reporter
  );
}

function levelsOf(s: GridTradingStrategy) {
  return (
    s as unknown as {
      levels: Array<{
        price: number;
        buyOrderId?: string;
        sellOrderId?: string;
        filled: boolean;
        entryPrice?: number;
        heldQty?: number;
        buyFilledQty?: number;
        sellFilledQty?: number;
        buyGen?: number;
        sellGen?: number;
      }>;
    }
  ).levels;
}

function clearThrottle(s: GridTradingStrategy): void {
  (
    s as unknown as { lastOrderCheck: Map<string, Date> }
  ).lastOrderCheck.clear();
}

function fillsOf(reporter: { reportFill: jest.Mock }): FillReport[] {
  return reporter.reportFill.mock.calls.map(c => c[0] as FillReport);
}

function lastPosition(reporter: { reportPosition: jest.Mock }): PositionReport {
  const calls = reporter.reportPosition.mock.calls;
  return calls[calls.length - 1][0] as PositionReport;
}

/** Requests the strategy placed for one side, in order. */
function placedOrders(
  exchange: MockExchange,
  side: "BUY" | "SELL"
): Array<{ side: string; orderPrice: number; orderQuantity: number }> {
  return exchange.createOrder.mock.calls
    .map(
      c => c[0] as { side: string; orderPrice: number; orderQuantity: number }
    )
    .filter(c => c.side === side);
}

/** Move the ticker and run one tick. */
async function tickAt(
  s: GridTradingStrategy,
  exchange: MockExchange,
  price: number
): Promise<void> {
  exchange.getTicker.mockResolvedValue({ symbol: CONFIG.symbol, price });
  await s.tick();
}

/**
 * Make the order behind `orderId` observe as `status` with the venue's
 * cumulative `executedQuantity`, then run one reconciling tick.
 */
async function observe(
  s: GridTradingStrategy,
  exchange: MockExchange,
  orderId: string,
  observed: {
    status: string;
    executedQuantity?: number;
    executedPrice?: number;
  }
): Promise<void> {
  exchange.getOrder.mockImplementation(async (id: string) =>
    id === orderId
      ? { orderId: id, ...observed }
      : { orderId: id, status: "OPEN" }
  );
  clearThrottle(s);
  await s.tick();
}

/** The BUY handle level `index` currently has live. */
function buyHandle(s: GridTradingStrategy, index: number): string {
  return levelsOf(s)[index].buyOrderId as string;
}

/** The client order id the strategy derives for a slot's *current* generation. */
function deriveId(
  s: GridTradingStrategy,
  index: number,
  side: "BUY" | "SELL"
): string {
  return (
    s as unknown as {
      generateClientOrderId(i: number, s: "BUY" | "SELL"): string;
    }
  ).generateClientOrderId(index, side);
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-partial-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
  jest.clearAllMocks();
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

describe("GridTradingStrategy partial-fill lifecycle (Phase 4)", () => {
  it("books a live partial segment and keeps the slot on the order (A2/B1)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-a", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick(); // one entry per level

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });

    expect(fillsOf(reporter)).toHaveLength(1);
    expect(fillsOf(reporter)[0]).toMatchObject({
      side: "BUY",
      price: LEVEL_0 - 0.1,
      quantity: 0.4,
      status: "PARTIALLY_FILLED",
      exchangeOrderId: handle,
      segment: { from: 0, to: 0.4, full: 1 },
    });
    // The order stays on the slot — a partial does not spend the id, and the
    // resting order keeps its option value.
    expect(levelsOf(s)[0].buyOrderId).toBe(handle);
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(0.4, 8);
    expect(levelsOf(s)[0].filled).toBe(false);
    expect(levelsOf(s)[0].buyGen).toBeUndefined();
    // The position view follows the booked quantity, not the level count.
    expect(lastPosition(reporter).quantity).toBeCloseTo(0.4, 8);
    expect(lastPosition(reporter).side).toBe("LONG");
    // Nothing was re-placed over the live handle.
    expect(
      placedOrders(exchange, "BUY").filter(o => o.orderPrice === LEVEL_0)
    ).toHaveLength(1);
  });

  it("books nothing when the same cumulative is observed again (idempotent re-poll)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-b", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });

    expect(reporter.reportFill).toHaveBeenCalledTimes(1);
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(0.4, 8);
    expect(lastPosition(reporter).quantity).toBeCloseTo(0.4, 8);
  });

  it("books only the remainder when the order completes, never the whole order (A2)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-c", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });
    await observe(s, exchange, handle, {
      status: "FILLED",
      executedQuantity: 1,
      executedPrice: LEVEL_0 - 0.1,
    });

    const fills = fillsOf(reporter);
    expect(fills).toHaveLength(2);
    expect(fills[1]).toMatchObject({
      quantity: 0.6,
      status: "FILLED",
      segment: { from: 0.4, to: 1, full: 1 },
    });
    // The two segments sum to exactly one slot — the ledger and the quantity
    // projection agree, which is the invariant the whole phase exists for.
    expect(fills.reduce((sum, f) => sum + f.quantity, 0)).toBeCloseTo(1, 8);
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(1, 8);
    expect(levelsOf(s)[0].filled).toBe(true);
    expect(levelsOf(s)[0].buyOrderId).toBeUndefined();
    expect(levelsOf(s)[0].buyGen).toBe(1);
  });

  it("books nothing for a re-detected terminal cumulative (A2/G1 phantom row)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-d", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "FILLED",
      executedQuantity: 1,
      executedPrice: LEVEL_0 - 0.1,
    });
    expect(reporter.reportFill).toHaveBeenCalledTimes(1);

    // A history lookup that finds the same terminal order again (a stale
    // deterministic id, a redelivered observation) must not book a second row.
    const view = s as unknown as {
      bookOutcome(
        i: number,
        level: GridLevel,
        side: "BUY" | "SELL",
        outcome: SlotOutcome
      ): Promise<void>;
    };
    await view.bookOutcome(0, levelsOf(s)[0] as unknown as GridLevel, "BUY", {
      kind: "FILLED",
      orderId: handle,
      filledQty: 1,
      delta: 0,
      clientOrderId: "botg-partial-d-00-B",
      executedPrice: LEVEL_0 - 0.1,
    });

    expect(reporter.reportFill).toHaveBeenCalledTimes(1);
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(1, 8);
  });

  it("books the fill that landed before a cancel, then tops up the remainder (A3/B1/C2)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-e", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    const spentId = deriveId(s, 0, "BUY");
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });
    // The venue admits to 0.6 by the time the order is cancelled: the 0.2 that
    // landed between the last poll and the cancel must not vanish (A3).
    await observe(s, exchange, handle, {
      status: "CANCELLED",
      executedQuantity: 0.6,
      executedPrice: LEVEL_0 - 0.1,
    });

    const fills = fillsOf(reporter);
    expect(fills).toHaveLength(2);
    expect(fills[1]).toMatchObject({
      quantity: 0.2,
      status: "PARTIALLY_FILLED",
      exchangeOrderId: handle,
      segment: { from: 0.4, to: 0.6, full: 1 },
    });
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(0.6, 8);
    expect(levelsOf(s)[0].buyOrderId).toBeUndefined();
    // The instance booked fills, so its id is spent (B1): the next cycle can
    // never mint the same segment bounds under the same client order id.
    expect(levelsOf(s)[0].buyGen).toBe(1);
    expect(deriveId(s, 0, "BUY")).not.toBe(spentId);

    // Only the shortfall is bought, under the fresh id.
    const buysBefore = placedOrders(exchange, "BUY").length;
    await tickAt(s, exchange, 1);
    const buys = placedOrders(exchange, "BUY");
    expect(buys).toHaveLength(buysBefore + 1);
    expect(buys[buys.length - 1].orderQuantity).toBeCloseTo(0.4, 8);
    const placedId = exchange.createOrder.mock.calls.at(-1)?.[0] as {
      clientOrderId: string;
    };
    expect(placedId.clientOrderId).toBe(deriveId(s, 0, "BUY"));
  });

  it("arms on held quantity: no exit below a full slot, no entry beside a live exit (C1)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-f", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    // A partial long with its entry still live: no exit can be armed yet…
    const buy = buyHandle(s, 0);
    await observe(s, exchange, buy, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });
    await tickAt(s, exchange, LEVEL_0 + 0.5);
    expect(placedOrders(exchange, "SELL")).toHaveLength(0);

    // …and once the entry completes and the exit rests, a partial exit may not
    // arm a second entry next to it (the long would double).
    await observe(s, exchange, buy, {
      status: "FILLED",
      executedQuantity: 1,
      executedPrice: LEVEL_0 - 0.1,
    });
    await tickAt(s, exchange, LEVEL_0);
    const sellHandle = levelsOf(s)[0].sellOrderId as string;
    expect(sellHandle).toBeTruthy();
    await observe(s, exchange, sellHandle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: 100,
    });
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(0.6, 8);
    expect(levelsOf(s)[0].sellOrderId).toBe(sellHandle);

    const buysAtLevel = placedOrders(exchange, "BUY").filter(
      o => o.orderPrice === LEVEL_0
    ).length;
    await tickAt(s, exchange, LEVEL_0 - 1);
    expect(
      placedOrders(exchange, "BUY").filter(o => o.orderPrice === LEVEL_0)
    ).toHaveLength(buysAtLevel);
  });

  it("declares the level long when a below-minimum remainder is refused (C2)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-g", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.96,
      executedPrice: LEVEL_0 - 0.1,
    });
    // Cancelled with nothing further executed: the level is left holding 0.96
    // and owes a 0.04 top-up it can never place at this venue.
    await observe(s, exchange, handle, {
      status: "CANCELLED",
      executedQuantity: 0.96,
    });
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(0.96, 8);
    expect(fillsOf(reporter)).toHaveLength(1);

    exchange.createOrder.mockRejectedValueOnce(
      new CommandError(
        false,
        "lighter create refused: 21706 order size is below the minimum 0.01"
      )
    );
    await tickAt(s, exchange, LEVEL_0);

    // Declared long, so the reduce-only exit arms and the venue caps it to the
    // true position — the level is not wedged holding an unexitable long.
    expect(levelsOf(s)[0].heldQty).toBe(1);
    expect(levelsOf(s)[0].filled).toBe(true);
    // Nothing was booked for the refused remainder: no fill happened.
    expect(fillsOf(reporter)).toHaveLength(1);
    const sells = placedOrders(exchange, "SELL");
    expect(sells).toHaveLength(1);
    expect(sells[0].orderPrice).toBe(LEVEL_0 + LEVEL_1_SPACING);
  });

  it("restores a partial long with its entry and never re-books its cumulative (A4/E3/C3)", async () => {
    const botId = "bot-partial-restart";
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy(botId, exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });

    // The quantity state is persisted beside the flags, no version bump (E3).
    const snapshot = loadGridSnapshot(botId);
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.levels[0]).toEqual(
      expect.objectContaining({
        heldQty: 0.4,
        buyFilledQty: 0.4,
        entryPrice: LEVEL_0 - 0.1,
        filled: false,
        buyOrderId: handle,
      })
    );

    // The venue still shows the same order with the same cumulative.
    const restarted = makeExchange();
    restarted.getOrder.mockImplementation(async (id: string) =>
      id === handle
        ? {
            orderId: id,
            status: "OPEN",
            executedQuantity: 0.4,
            executedPrice: LEVEL_0 - 0.1,
          }
        : { orderId: id, status: "OPEN" }
    );
    const reporter2 = makeReporter();
    const s2 = makeStrategy(botId, restarted, reporter2);
    await s2.initialize(100);
    await s2.start();

    // The partial long survives with its entry — `filled` is false here, so a
    // boolean-only restore would have dropped the entry and re-priced the exit
    // from the level line (C3).
    expect(levelsOf(s2)[0].heldQty).toBeCloseTo(0.4, 8);
    expect(levelsOf(s2)[0].entryPrice).toBe(LEVEL_0 - 0.1);
    expect(levelsOf(s2)[0].buyOrderId).toBe(handle);
    // The startup pass re-observed the cumulative and booked nothing: the
    // ledger already holds it, and the projection must not double-apply it (A4).
    expect(reporter2.reportFill).not.toHaveBeenCalled();

    clearThrottle(s2);
    await s2.tick();
    expect(reporter2.reportFill).not.toHaveBeenCalled();
    expect(levelsOf(s2)[0].heldQty).toBeCloseTo(0.4, 8);
  });

  it("books a fill the startup pass resolved while the engine was down (A2/A3)", async () => {
    const botId = "bot-partial-startup";
    const exchange = makeExchange();
    const s = makeStrategy(botId, exchange, makeReporter());
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    const spentId = deriveId(s, 0, "BUY");
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });

    // …and the rest of the order executes while the engine is down.
    const restarted = makeExchange();
    restarted.getOrder.mockImplementation(async (id: string) =>
      id === handle
        ? {
            orderId: id,
            status: "FILLED",
            executedQuantity: 1,
            executedPrice: LEVEL_0 - 0.1,
          }
        : { orderId: id, status: "OPEN" }
    );
    const reporter2 = makeReporter();
    const s2 = makeStrategy(botId, restarted, reporter2);
    await s2.initialize(100);

    // The remainder reaches the ledger once, under the id it happened under —
    // a fill resolved at startup must not exist in the position alone.
    const fills = fillsOf(reporter2);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      side: "BUY",
      quantity: 0.6,
      status: "FILLED",
      clientOrderId: spentId,
      exchangeOrderId: handle,
      segment: { from: 0.4, to: 1, full: 1 },
    });
    expect(levelsOf(s2)[0].filled).toBe(true);
    expect(levelsOf(s2)[0].heldQty).toBeCloseTo(1, 8);
  });

  it("weights the entry across a level's segments and prices the exit from it (C3)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-h", exchange, reporter, {
      ...CONFIG,
      takeProfitPercent: 2,
    });
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: 97.4,
    });
    await observe(s, exchange, handle, {
      status: "FILLED",
      executedQuantity: 1,
      executedPrice: 98.4,
    });

    // (97.4 × 0.4 + 98.4 × 0.6) / 1 = 98.0 — neither the last segment's 98.4
    // nor the level line 97.5.
    expect(levelsOf(s)[0].entryPrice).toBeCloseTo(98, 8);
    expect(lastPosition(reporter).entryPrice).toBeCloseTo(98, 8);

    await tickAt(s, exchange, LEVEL_0);
    const sells = placedOrders(exchange, "SELL");
    expect(sells).toHaveLength(1);
    expect(sells[0].orderPrice).toBe(Number((98 * 1.02).toFixed(2)));
  });

  it("books a confirmed cancel's remainder before the slot clears on stop (A3)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-partial-stop", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const handle = buyHandle(s, 0);
    await observe(s, exchange, handle, {
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: LEVEL_0 - 0.1,
    });
    expect(fillsOf(reporter)).toHaveLength(1);

    // The cancel confirms, but the terminal row admits to a further 0.2.
    exchange.getOrder.mockImplementation(async (id: string) =>
      id === handle
        ? {
            orderId: id,
            status: "CANCELLED",
            executedQuantity: 0.6,
            executedPrice: LEVEL_0 - 0.1,
          }
        : { orderId: id, status: "OPEN" }
    );
    const problems = await s.stop();

    expect(problems).toEqual([]);
    const fills = fillsOf(reporter);
    expect(fills).toHaveLength(2);
    expect(fills[1]).toMatchObject({
      quantity: 0.2,
      status: "PARTIALLY_FILLED",
      exchangeOrderId: handle,
      segment: { from: 0.4, to: 0.6, full: 1 },
    });
    expect(levelsOf(s)[0].heldQty).toBeCloseTo(0.6, 8);
    expect(levelsOf(s)[0].buyOrderId).toBeUndefined();
  });
});

describe("isSizeRefusal (C2 classifier)", () => {
  it("recognizes a venue minimum-size refusal", () => {
    expect(
      isSizeRefusal("lighter create refused: 21706 below the minimum size")
    ).toBe(true);
    expect(isSizeRefusal("Order size is too small")).toBe(true);
    expect(isSizeRefusal("amount less than minimum order amount")).toBe(true);
  });

  it("never mistakes a transport or unrelated business failure for one", () => {
    // A freeze must not be read as "declare the level long".
    expect(isSizeRefusal("lighter unreachable (create timed out)")).toBe(false);
    expect(
      isSizeRefusal("lighter create refused: 21733 accidental price")
    ).toBe(false);
    expect(isSizeRefusal("insufficient margin")).toBe(false);
    // Nonce drift is explicitly NOT a size refusal — it has its own retryable path.
    expect(isSizeRefusal("lighter nonce drift: 21104 invalid nonce")).toBe(
      false
    );
  });
});
