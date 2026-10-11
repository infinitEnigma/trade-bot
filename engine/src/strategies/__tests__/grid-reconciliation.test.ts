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
  getPositions?: () => Promise<unknown[]>;
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
    getPositions: jest.fn(overrides.getPositions ?? (async () => [])),
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
    version: 2,
    botId,
    symbol: CONFIG.symbol,
    gridSize: CONFIG.gridSize,
    gridRangePercent: CONFIG.gridRangePercent,
    orderQuantity: CONFIG.orderQuantity,
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
describe("Phase 1 — snapshot restore requires execution-config match", () => {
  /** A v2 snapshot with a chosen slot size, one resting handle at level 1. */
  async function seedV2(botId: string, orderQuantity: number): Promise<void> {
    await saveGridSnapshot({
      version: 2,
      botId,
      symbol: CONFIG.symbol,
      gridSize: CONFIG.gridSize,
      gridRangePercent: CONFIG.gridRangePercent,
      orderQuantity,
      baselinePrice: 100,
      levels: [
        { price: 97.5, filled: false },
        { price: 100, filled: false, buyOrderId: "H1" },
        { price: 102.5, filled: false },
      ],
      savedAt: new Date().toISOString(),
    });
  }

  it("restores a v2 snapshot whose orderQuantity matches the config", async () => {
    await seedV2("bot-p1-match", CONFIG.orderQuantity);
    const exchange = makeExchange({
      listOpenOrders: async () => [
        { orderId: "H1", symbol: CONFIG.symbol, status: "OPEN" },
      ],
      getOrder: async (orderId: string) => ({ orderId, status: "OPEN" }),
    });
    const s = new GridTradingStrategy("bot-p1-match", CONFIG, exchange);
    await s.initialize(100);
    // The saved handle is adopted onto level 1 (a restore, not a rebuild).
    expect(levelsOf(s)[1].buyOrderId).toBe("H1");
  });

  it("does NOT restore when orderQuantity differs — treats it as untrusted", async () => {
    // Snapshot was built at slot 0.01; the bot now runs at 1 (CONFIG).
    await seedV2("bot-p1-mismatch", 0.01);
    const exchange = makeExchange();
    const s = new GridTradingStrategy("bot-p1-mismatch", CONFIG, exchange);
    // Untrusted path requires an empty book + flat; here it is empty/flat, so it
    // rebuilds fresh rather than adopting the stale H1 handle.
    await s.initialize(100);
    expect(levelsOf(s)[1].buyOrderId).toBeUndefined();
  });

  it("refuses to build over a live order when orderQuantity differs", async () => {
    await seedV2("bot-p1-mismatch-live", 0.01);
    const exchange = makeExchange({
      listOpenOrders: async () => [
        { orderId: "H1", symbol: CONFIG.symbol, status: "OPEN" },
      ],
    });
    const s = new GridTradingStrategy("bot-p1-mismatch-live", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(/Refusing to start/);
  });

  it("does NOT restore a legacy (v1) snapshot — routes through the safe gate", async () => {
    await saveGridSnapshot({
      version: 1,
      botId: "bot-p1-legacy",
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
    const exchange = makeExchange();
    const s = new GridTradingStrategy("bot-p1-legacy", CONFIG, exchange);
    await s.initialize(100);
    // A v1 snapshot is never trusted to restore: fresh grid, no adopted handle.
    expect(levelsOf(s)[1].buyOrderId).toBeUndefined();
  });
});
describe("Phase 2 — position-aware recovery gate (untrusted snapshot)", () => {
  // These all take the untrusted path (no snapshot seeded), so the startup gate
  // must verify BOTH an empty order book AND a flat account before building.

  it("refuses to build a fresh grid when the account holds exposure", async () => {
    const exchange = makeExchange({
      getPositions: async () => [
        { symbol: CONFIG.symbol, position_qty: 0.5, mark_price: 100 },
      ],
    });
    const s = new GridTradingStrategy("bot-p2-position", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(
      /non-zero.*position|reconcile the existing exposure/i
    );
  });

  it("does NOT auto-flatten: it refuses and places no orders", async () => {
    const exchange = makeExchange({
      getPositions: async () => [
        { symbol: CONFIG.symbol, position_qty: 1, mark_price: 100 },
      ],
    });
    const s = new GridTradingStrategy("bot-p2-noflatten", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(/Refusing to start/);
    // Refusal happens before any order placement — no exposure manipulation.
    expect(exchange.createOrder).not.toHaveBeenCalled();
    expect(exchange.cancelOrder).not.toHaveBeenCalled();
  });

  it("fails closed when the position read cannot be completed", async () => {
    const exchange = makeExchange({
      getPositions: async () => {
        throw new Error("positions unreachable");
      },
    });
    const s = new GridTradingStrategy("bot-p2-posfail", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(/cannot verify positions/);
  });

  it("fails closed on a malformed / non-finite position quantity", async () => {
    const exchange = makeExchange({
      getPositions: async () => [
        {
          symbol: CONFIG.symbol,
          position_qty: "not-a-number",
          mark_price: 100,
        },
      ],
    });
    const s = new GridTradingStrategy("bot-p2-posmalformed", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(/not a finite number/);
  });

  it("ignores a position for an unrelated symbol (case-insensitive match)", async () => {
    const exchange = makeExchange({
      getPositions: async () => [
        { symbol: "SOME_OTHER_PERP", position_qty: 5, mark_price: 100 },
      ],
    });
    const s = new GridTradingStrategy("bot-p2-othersym", CONFIG, exchange);
    // Unrelated exposure does not block a legitimate flat cold start.
    await expect(s.initialize(100)).resolves.toBeUndefined();
  });

  it("matches the configured symbol case-insensitively when checking exposure", async () => {
    const exchange = makeExchange({
      getPositions: async () => [
        {
          symbol: CONFIG.symbol.toLowerCase(),
          position_qty: 0.3,
          mark_price: 100,
        },
      ],
    });
    const s = new GridTradingStrategy("bot-p2-case", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(
      /non-zero.*position|reconcile the existing exposure/i
    );
  });

  it("builds a fresh grid on a legitimately flat + empty cold start", async () => {
    const exchange = makeExchange({
      listOpenOrders: async () => [],
      getPositions: async () => [
        { symbol: CONFIG.symbol, position_qty: 0, mark_price: 100 },
      ],
    });
    const s = new GridTradingStrategy("bot-p2-flat", CONFIG, exchange);
    await expect(s.initialize(100)).resolves.toBeUndefined();
    expect(levelsOf(s).length).toBe(CONFIG.gridSize + 1);
  });

  it("still refuses on live orders even when the account is flat", async () => {
    const exchange = makeExchange({
      listOpenOrders: async () => [{ orderId: "live-1", status: "OPEN" }],
      getPositions: async () => [],
    });
    const s = new GridTradingStrategy("bot-p2-orders", CONFIG, exchange);
    await expect(s.initialize(100)).rejects.toThrow(/Refusing to start/);
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
