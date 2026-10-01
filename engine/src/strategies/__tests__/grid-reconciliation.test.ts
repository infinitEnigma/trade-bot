/** @format */

/**
 * Grid ↔ exchange reconciliation integration (Phase 2): N3 (a vanished order
 * frees the slot), N4 (startup never rebuilds over live orders), N5 (stop
 * reports unconfirmed cancellations).
 */
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";
import { saveGridSnapshot } from "../../infrastructure/state/grid-state";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 2,
  orderQuantity: 1,
  gridRangePercent: 5,
};

/** A thrown axios-shaped 404 (axios.isAxiosError only checks the flag). */
function httpError(status: number): unknown {
  return {
    isAxiosError: true,
    message: `status ${status}`,
    response: { status },
  };
}

type Overrides = {
  getOrder?: (orderId: string) => Promise<{ orderId: string; status: string }>;
  createOrder?: () => Promise<{ orderId: string }>;
  cancelOrder?: () => Promise<{ status: string }>;
  listOpenOrders?: () => Promise<unknown[]>;
};

type MockExchange = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  getPositions: jest.Mock;
  getAccountInfo: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
};

function makeExchange(
  overrides: Overrides = {}
): MockExchange & ExchangeClient {
  let created = 0;
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
    getOrder: jest.fn(
      overrides.getOrder ??
        (async (orderId: string) => ({ orderId, status: "OPEN" }))
    ),
    createOrder: jest.fn(
      overrides.createOrder ??
        (async () => ({ orderId: `new-${(created += 1)}` }))
    ),
    cancelOrder: jest.fn(
      overrides.cancelOrder ?? (async () => ({ status: "CANCELLED" }))
    ),
    getPositions: jest.fn().mockResolvedValue([]),
    getAccountInfo: jest
      .fn()
      .mockResolvedValue({ total_value: 0, max_leverage: 1 }),
    listOpenOrders: jest.fn(overrides.listOpenOrders ?? (async () => [])),
    queryOrderByClientOrderId: jest
      .fn()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
  } as unknown as MockExchange & ExchangeClient;
}

function levelsOf(s: GridTradingStrategy) {
  return (
    s as unknown as {
      levels: Array<{
        price: number;
        buyOrderId?: string;
        sellOrderId?: string;
        filled: boolean;
      }>;
    }
  ).levels;
}

function clearThrottle(s: GridTradingStrategy): void {
  (
    s as unknown as { lastOrderCheck: Map<string, Date> }
  ).lastOrderCheck.clear();
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-recon-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

describe("N3 — a vanished order frees its slot", () => {
  it("clears the handle on a 404 and re-places the level", async () => {
    const exchange = makeExchange();
    const s = new GridTradingStrategy("bot-n3", CONFIG, exchange);
    await s.initialize(100);
    await s.start();
    await s.tick();

    expect(levelsOf(s)[0].buyOrderId).toBeTruthy();

    // The order is gone at the exchange (404), then absent on the re-place.
    exchange.getOrder.mockImplementation(async () => {
      throw httpError(404);
    });
    clearThrottle(s);
    await s.tick();
    expect(levelsOf(s)[0].buyOrderId).toBeUndefined();

    const before = exchange.createOrder.mock.calls.length;
    exchange.getOrder.mockResolvedValue({ orderId: "x", status: "OPEN" });
    clearThrottle(s);
    await s.tick();
    expect(exchange.createOrder.mock.calls.length).toBeGreaterThan(before);
  });
});

async function seedSnapshot(botId: string): Promise<void> {
  await saveGridSnapshot({
    version: 1,
    botId,
    symbol: CONFIG.symbol,
    gridSize: CONFIG.gridSize,
    gridRangePercent: CONFIG.gridRangePercent,
    baselinePrice: 100,
    levels: [
      { price: 97.5, filled: false },
      { price: 100, filled: false, buyOrderId: "H1" },
      { price: 102.5, filled: false },
    ],
    savedAt: new Date().toISOString(),
  });
}

describe("N4 — startup never rebuilds over live orders", () => {
  it("refuses to start when the snapshot is missing but orders are live", async () => {
    const exchange = makeExchange({
      listOpenOrders: async () => [{ orderId: "live-1", status: "OPEN" }],
    });
    const s = new GridTradingStrategy("bot-n4a", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(/Refusing to start/);
  });

  it("refuses to start when the book cannot be verified (fail closed)", async () => {
    const exchange = makeExchange({
      listOpenOrders: async () => {
        throw new Error("listing down");
      },
    });
    const s = new GridTradingStrategy("bot-n4b", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(
      /cannot verify open orders/
    );
  });

  it("adopts a restored handle at startup", async () => {
    await seedSnapshot("bot-n4c");
    const exchange = makeExchange({
      listOpenOrders: async () => [
        { orderId: "H1", symbol: CONFIG.symbol, status: "OPEN" },
      ],
      getOrder: async (orderId: string) => ({ orderId, status: "OPEN" }),
    });
    const s = new GridTradingStrategy("bot-n4c", CONFIG, exchange);
    await s.initialize(100);

    expect(exchange.listOpenOrders).toHaveBeenCalledWith(CONFIG.symbol);
    expect(exchange.getOrder).toHaveBeenCalledWith("H1");
    expect(levelsOf(s)[1].buyOrderId).toBe("H1");
  });

  it("refuses when a restored grid cannot be reconciled", async () => {
    await seedSnapshot("bot-n4d");
    const exchange = makeExchange({
      listOpenOrders: async () => {
        throw new Error("exchange down");
      },
    });
    const s = new GridTradingStrategy("bot-n4d", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(
      /could not reach the exchange/
    );
  });
});

describe("N5 — stop surfaces unconfirmed cancellations", () => {
  it("returns a problem per order whose cancel is not confirmed", async () => {
    const exchange = makeExchange({
      cancelOrder: async () => {
        throw new Error("cancel unconfirmed");
      },
    });
    const s = new GridTradingStrategy("bot-n5", CONFIG, exchange);
    await s.initialize(100);
    await s.start();
    await s.tick();
    expect(levelsOf(s)[0].buyOrderId).toBeTruthy();

    const problems = await s.stop();
    expect(problems.length).toBeGreaterThan(0);
  });

  it("returns no problems when every cancel is confirmed", async () => {
    const exchange = makeExchange();
    const s = new GridTradingStrategy("bot-n5b", CONFIG, exchange);
    await s.initialize(100);
    await s.start();
    await s.tick();
    expect(await s.stop()).toEqual([]);
  });
});
