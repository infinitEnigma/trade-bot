import { GridTradingStrategy } from "../grid";
import { OrderlyClient } from "../../exchanges/kodiak/client";
import { GridStrategyConfig } from "../../types/strategy";
import { loadGridSnapshot } from "../../infrastructure/state/grid-state";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 2,
  orderQuantity: 1,
  gridRangePercent: 5,
};

type MockOrderly = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  findOrderByClientOrderId: jest.Mock;
};

function makeOrderly(): MockOrderly {
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
    getOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    createOrder: jest.fn().mockResolvedValue({ orderId: "O1", status: "OPEN" }),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    findOrderByClientOrderId: jest.fn().mockResolvedValue(null),
  };
}

// Isolate each test in its own snapshot directory so persisted slot state
// never leaks across tests or into the repo working directory.
let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-test-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) {
    fs.rmSync(snapTmpDir, { recursive: true, force: true });
  }
});

describe("GridTradingStrategy order idempotency", () => {
  it("generates a deterministic clientOrderId for the same bot/level/side", () => {
    const a = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      makeOrderly() as unknown as OrderlyClient
    );
    const b = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      makeOrderly() as unknown as OrderlyClient
    );

    const gen = (s: GridTradingStrategy) =>
      (
        s as unknown as {
          generateClientOrderId(i: number, s: "BUY" | "SELL"): string;
        }
      ).generateClientOrderId(0, "BUY");

    const idA = gen(a);
    const idB = gen(b);

    expect(idA).toBe(idB);
    // Contract-compliant format: <botKey>-<level>-<side>, no colons.
    expect(idA).toBe("bot1-00-B");
    expect(idA.length).toBeLessThanOrEqual(36);
    expect(idA).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
  });

  it("derives a different clientOrderId for a different botId", async () => {
    const a = makeOrderly();
    const sA = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      a as unknown as OrderlyClient
    );
    await sA.initialize(100);
    await sA.start();
    await sA.tick();
    const idA = a.createOrder.mock.calls[0][0].clientOrderId as string;

    const b = makeOrderly();
    const sB = new GridTradingStrategy(
      "bot-2",
      CONFIG,
      b as unknown as OrderlyClient
    );
    await sB.initialize(100);
    await sB.start();
    await sB.tick();
    const idB = b.createOrder.mock.calls[0][0].clientOrderId as string;

    expect(idA).not.toBe(idB);
  });

  it("adopts an existing order via get-before-create instead of submitting again", async () => {
    const orderly = makeOrderly();
    orderly.findOrderByClientOrderId.mockResolvedValue({
      orderId: "existing-1",
      status: "OPEN",
    });

    const strategy = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      orderly as unknown as OrderlyClient
    );
    await strategy.initialize(100);
    await strategy.start();
    await strategy.tick();

    expect(orderly.findOrderByClientOrderId).toHaveBeenCalledWith(
      CONFIG.symbol,
      "bot1-00-B"
    );
    expect(orderly.createOrder).not.toHaveBeenCalled();
  });

  it("reconciles via findOrderByClientOrderId after a create-order error (lost response)", async () => {
    const orderly = makeOrderly();
    const config: GridStrategyConfig = { ...CONFIG, gridSize: 1 };
    orderly.getTicker.mockResolvedValue({ symbol: CONFIG.symbol, price: 100 });

    orderly.findOrderByClientOrderId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ orderId: "recovered-7", status: "OPEN" });
    orderly.createOrder.mockRejectedValue(new Error("network lost"));

    const strategy = new GridTradingStrategy(
      "bot-1",
      config,
      orderly as unknown as OrderlyClient
    );
    await strategy.initialize(100);
    await strategy.start();
    await strategy.tick();

    expect(orderly.createOrder).toHaveBeenCalledTimes(1);
    expect(orderly.findOrderByClientOrderId).toHaveBeenCalledTimes(2);
  });
});

describe("GridTradingStrategy slot-state persistence", () => {
  it("restores slot state from a persisted snapshot instead of rebuilding", async () => {
    // First instance: fresh build places buys, then persists a snapshot.
    const first = makeOrderly();
    const s1 = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      first as unknown as OrderlyClient
    );
    await s1.initialize(100);
    await s1.start();
    await s1.tick();
    expect(first.createOrder).toHaveBeenCalled();

    // Second instance, same botId: restores from snapshot. Levels that
    // already have a buyOrderId must NOT be re-placed.
    const second = makeOrderly();
    const s2 = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      second as unknown as OrderlyClient
    );
    await s2.initialize(100);
    await s2.start();
    await s2.tick();

    expect(second.createOrder).not.toHaveBeenCalled();
  });

  it("preserves a filled level across restart (never re-places it)", async () => {
    const first = makeOrderly();
    first.getOrder.mockResolvedValue({ orderId: "O1", status: "FILLED" });
    const s1 = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      first as unknown as OrderlyClient
    );
    await s1.initialize(100);
    await s1.start();
    await s1.tick();

    const levels1 = (
      s1 as unknown as {
        levels: Array<{ filled: boolean; buyOrderId?: string }>;
      }
    ).levels;
    expect(levels1[0].filled).toBe(true);
    expect(levels1[0].buyOrderId).toBeUndefined();

    const second = makeOrderly();
    const s2 = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      second as unknown as OrderlyClient
    );
    await s2.initialize(100);
    await s2.start();
    await s2.tick();

    const levels2 = (
      s2 as unknown as {
        levels: Array<{ filled: boolean; buyOrderId?: string }>;
      }
    ).levels;
    expect(levels2[0].filled).toBe(true);
    expect(levels2[0].buyOrderId).toBeUndefined();
    expect(second.createOrder).not.toHaveBeenCalled();
  });

  it("rebuilds fresh when the persisted snapshot shape (symbol) mismatches", async () => {
    const first = makeOrderly();
    const s1 = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      first as unknown as OrderlyClient
    );
    await s1.initialize(100);
    await s1.start();
    await s1.tick();
    expect(first.createOrder).toHaveBeenCalled();

    const second = makeOrderly();
    const differentConfig: GridStrategyConfig = {
      ...CONFIG,
      symbol: "PERP_ETH_USDC",
    };
    const s2 = new GridTradingStrategy(
      "bot-1",
      differentConfig,
      second as unknown as OrderlyClient
    );
    await s2.initialize(100);
    await s2.start();
    await s2.tick();

    expect(second.createOrder).toHaveBeenCalled();
  });

  it("persists a snapshot after a tick", async () => {
    const orderly = makeOrderly();
    const strategy = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      orderly as unknown as OrderlyClient
    );
    await strategy.initialize(100);
    await strategy.start();
    await strategy.tick();

    const snap = loadGridSnapshot("bot-1");
    expect(snap).not.toBeNull();
    expect(snap?.baselinePrice).toBe(100);
    expect(snap?.levels.length).toBeGreaterThan(0);
  });

  it("persists a snapshot when stopped", async () => {
    const orderly = makeOrderly();
    const strategy = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      orderly as unknown as OrderlyClient
    );
    await strategy.initialize(100);
    await strategy.start();
    await strategy.tick();
    await strategy.stop();

    const snap = loadGridSnapshot("bot-1");
    expect(snap).not.toBeNull();
    expect(snap?.botId).toBe("bot-1");
    expect(snap?.levels.length).toBeGreaterThan(0);
  });
});
