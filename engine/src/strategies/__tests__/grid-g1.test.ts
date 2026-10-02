/**
 * G1 regression — stale deterministic-id history must never book a phantom
 * fill or block re-placement (Gate 1 report §3.1).
 *
 * The fix is slot id generations: a spent cycle's id is never queried again
 * (legacy snapshots seed handle-less sides at generation 1; a booked fill
 * bumps the generation), so the venue's terminal history row for that id is
 * unreachable by construction.
 *
 * @format
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy } from "../grid";
import { ExchangeClient, OrderLookup } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";
import { FillReport, TradeReporter } from "../../application/trade-reporter";
import { ClientOrderIdGenerator } from "../../utils/client-order-id";
import {
  saveGridSnapshot,
  loadGridSnapshot,
} from "../../infrastructure/state/grid-state";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 2,
  orderQuantity: 1,
  gridRangePercent: 5,
};

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

function levelsOf(s: GridTradingStrategy) {
  return s as unknown as {
    levels: Array<{
      price: number;
      buyOrderId?: string;
      sellOrderId?: string;
      filled: boolean;
      buyGen?: number;
      sellGen?: number;
    }>;
    manager: { idFor(i: number, side: "BUY" | "SELL"): string };
  };
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-g1-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
  jest.clearAllMocks();
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) {
    fs.rmSync(snapTmpDir, { recursive: true, force: true });
  }
});

/** Legacy (pre-G1) snapshot: no generation fields anywhere. */
async function seedLegacySnapshot(
  botId: string,
  midLevelBuyHandle?: string
): Promise<void> {
  await saveGridSnapshot({
    version: 1,
    botId,
    symbol: CONFIG.symbol,
    gridSize: CONFIG.gridSize,
    gridRangePercent: CONFIG.gridRangePercent,
    baselinePrice: 100,
    levels: [
      { price: 97.5, filled: false },
      { price: 100, filled: false, buyOrderId: midLevelBuyHandle },
      { price: 102.5, filled: false },
    ],
    savedAt: new Date().toISOString(),
  });
}

describe("G1 — stale history cannot book a phantom fill", () => {
  it("places with a fresh generation instead of re-querying a spent id", async () => {
    const botId = "bot-g1a";
    await seedLegacySnapshot(botId);
    const ids = new ClientOrderIdGenerator(botId);
    // Every generation-0 id of this bot carries a FILLED history row at the
    // venue (the G1 precondition: cycle N booked, cycle N+1 re-derives the id).
    const staleIds = new Set<string>();
    for (let i = 0; i < 3; i++) {
      staleIds.add(ids.generate(i, "BUY", 0));
      staleIds.add(ids.generate(i, "SELL", 0));
    }

    const exchange = makeExchange();
    exchange.queryOrderByClientOrderId.mockImplementation(
      async (_symbol: string, clientOrderId: string): Promise<OrderLookup> =>
        staleIds.has(clientOrderId)
          ? {
              kind: "FOUND_FILLED",
              order: {
                orderId: `stale-${clientOrderId}`,
                clientOrderId,
                symbol: CONFIG.symbol,
                status: "FILLED",
              },
            }
          : { kind: "NOT_FOUND" }
    );
    const reporter = makeReporter();
    const s = new GridTradingStrategy(
      botId,
      CONFIG,
      exchange as unknown as ExchangeClient,
      reporter
    );
    await s.initialize(100);
    await s.start();
    await s.tick();

    // Pre-fix this tick short-circuited into FOUND_FILLED for every level:
    // phantom fills, flipped `filled` flags, zero submissions. Now every
    // level must submit a real order under a fresh (generation-1) id.
    const created = exchange.createOrder.mock.calls.map(
      call => (call[0] as { clientOrderId: string }).clientOrderId
    );
    expect(created).toHaveLength(3);
    for (const clientOrderId of created) {
      expect(staleIds.has(clientOrderId)).toBe(false);
      expect(clientOrderId.endsWith("-1")).toBe(true);
    }
    expect(reporter.reportFill).not.toHaveBeenCalled();
    for (const level of levelsOf(s).levels) {
      expect(level.filled).toBe(false);
      expect(level.buyGen).toBe(1); // legacy handle-less seed bump
    }
  });

  it("keeps generation 0 for a legacy slot that still holds a live handle", async () => {
    const botId = "bot-g1b";
    await seedLegacySnapshot(botId, "H1");
    const ids = new ClientOrderIdGenerator(botId);
    const exchange = makeExchange();
    exchange.listOpenOrders.mockResolvedValue([
      { orderId: "H1", symbol: CONFIG.symbol, status: "OPEN" },
    ]);
    exchange.getOrder.mockResolvedValue({ orderId: "H1", status: "OPEN" });
    const s = new GridTradingStrategy(
      botId,
      CONFIG,
      exchange as unknown as ExchangeClient,
      makeReporter()
    );
    await s.initialize(100);

    const view = levelsOf(s);
    // Level index 1 (price 100) carries the live handle: its id must stay at
    // generation 0 so the venue order keeps resolving — while the handle-less
    // sides start at generation 1 (their spent gen-0 history is what G1 read).
    expect(view.manager.idFor(1, "BUY")).toBe(ids.generate(1, "BUY", 0));
    expect(view.levels[1].buyGen).toBe(0);
    expect(view.levels[1].sellGen).toBe(1);
    expect(view.levels[0].buyGen).toBe(1);
    expect(view.levels[0].sellGen).toBe(1);
    expect(exchange.getOrder).toHaveBeenCalledWith("H1");
  });

  it("spends the id on a booked fill, persists the generation, and restarts fresh", async () => {
    const botId = "bot-g1c";
    const ids = new ClientOrderIdGenerator(botId);
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = new GridTradingStrategy(
      botId,
      CONFIG,
      exchange as unknown as ExchangeClient,
      reporter
    );
    await s.initialize(100);
    await s.start();
    await s.tick();
    expect(exchange.createOrder).toHaveBeenCalledTimes(3);
    const filledId = ids.generate(0, "BUY", 0);
    expect(
      (exchange.createOrder.mock.calls[0][0] as { clientOrderId: string })
        .clientOrderId
    ).toBe(filledId);

    // The level-0 buy fills on the next verification pass.
    const handle0 = levelsOf(s).levels[0].buyOrderId as string;
    exchange.getOrder.mockImplementation(async (orderId: string) =>
      orderId === handle0
        ? { orderId, status: "FILLED" }
        : { orderId, status: "OPEN" }
    );
    (
      s as unknown as { lastOrderCheck: Map<string, Date> }
    ).lastOrderCheck.clear();
    await s.tick();

    const view = levelsOf(s);
    expect(view.levels[0].filled).toBe(true);
    expect(view.levels[0].buyGen).toBe(1);
    expect(view.levels[0].buyOrderId).toBeUndefined();
    // The ledger books the id the fill happened under — generation 0.
    expect(reporter.reportFill).toHaveBeenCalled();
    const fill = reporter.reportFill.mock.calls.at(-1)?.[0] as FillReport;
    expect(fill.clientOrderId).toBe(filledId);

    // The generation survives the restart via the snapshot…
    const snapshot = loadGridSnapshot(botId);
    expect(snapshot?.levels[0].buyGen).toBe(1);
    expect(snapshot?.levels[0].sellGen).toBe(0);

    // …and the restarted grid derives a FRESH buy id for the next cycle
    // (never the spent gen-0 id whose history row is on the venue).
    const exchange2 = makeExchange();
    const s2 = new GridTradingStrategy(
      botId,
      CONFIG,
      exchange2 as unknown as ExchangeClient,
      makeReporter()
    );
    await s2.initialize(100);
    const view2 = levelsOf(s2);
    expect(view2.manager.idFor(0, "BUY")).toBe(ids.generate(0, "BUY", 1));
    expect(view2.levels[0].buyOrderId).toBeUndefined();
    expect(view2.levels[0].buyGen).toBe(1);
  });
});
