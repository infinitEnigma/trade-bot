import { GridTradingStrategy } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
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

type MockExchange = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
};

function makeExchange(): MockExchange {
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
    getOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    createOrder: jest.fn().mockResolvedValue({ orderId: "O1", status: "OPEN" }),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    queryOrderByClientOrderId: jest
      .fn()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
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

function makeStrategy(
  botId: string,
  exchange: MockExchange,
  config: GridStrategyConfig = CONFIG
): GridTradingStrategy {
  return new GridTradingStrategy(
    botId,
    config,
    exchange as unknown as ExchangeClient
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
      }>;
    }
  ).levels;
}

/** The client order id the strategy derives for one slot. */
function deriveId(s: GridTradingStrategy, index: number, side: "BUY" | "SELL") {
  return (
    s as unknown as {
      generateClientOrderId(i: number, s: "BUY" | "SELL"): string;
    }
  ).generateClientOrderId(index, side);
}

describe("GridTradingStrategy order idempotency", () => {
  it("generates a deterministic clientOrderId for the same bot/level/side", () => {
    const a = makeStrategy("bot-1", makeExchange());
    const b = makeStrategy("bot-1", makeExchange());

    const idA = deriveId(a, 0, "BUY");
    const idB = deriveId(b, 0, "BUY");

    expect(idA).toBe(idB);
    // Contract-compliant format: <botKey>-<level>-<side>, no colons.
    expect(idA).toBe("bot1-00-B");
    expect(idA.length).toBeLessThanOrEqual(36);
    expect(idA).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
  });

  it("derives a different clientOrderId for a different botId", async () => {
    const a = makeExchange();
    const sA = makeStrategy("bot-1", a);
    await sA.initialize(100);
    await sA.start();
    await sA.tick();
    const idA = a.createOrder.mock.calls[0][0].clientOrderId as string;

    const b = makeExchange();
    const sB = makeStrategy("bot-2", b);
    await sB.initialize(100);
    await sB.start();
    await sB.tick();
    const idB = b.createOrder.mock.calls[0][0].clientOrderId as string;

    expect(idA).not.toBe(idB);
  });

  it("adopts an existing live order via get-before-create instead of re-submitting", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-1", exchange);
    await s.initialize(100);
    await s.start();

    const slotId = deriveId(s, 0, "BUY");
    exchange.queryOrderByClientOrderId.mockImplementation(
      async (_symbol: string, clientOrderId: string) =>
        clientOrderId === slotId
          ? {
              kind: "FOUND_OPEN",
              order: { orderId: "existing-1", clientOrderId: slotId },
            }
          : { kind: "NOT_FOUND" }
    );

    await s.tick();

    // The slot was reconciled against the exchange and adopted, never placed.
    expect(exchange.queryOrderByClientOrderId).toHaveBeenCalledWith(
      CONFIG.symbol,
      slotId
    );
    const placedIds = exchange.createOrder.mock.calls.map(
      c => c[0].clientOrderId
    );
    expect(placedIds).not.toContain(slotId);
    expect(levelsOf(s)[0].buyOrderId).toBe("existing-1");
  });

  it("freezes a slot (never places) when the lookup is UNREACHABLE", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-1", exchange);
    await s.initialize(100);
    await s.start();

    const slotId = deriveId(s, 0, "BUY");
    exchange.queryOrderByClientOrderId.mockImplementation(
      async (_symbol: string, clientOrderId: string) =>
        clientOrderId === slotId
          ? { kind: "UNREACHABLE", reason: "responded 500" }
          : { kind: "NOT_FOUND" }
    );

    await s.tick();

    // The exchange could not be asked: the slot stays untouched rather than
    // risking a duplicate order.
    expect(
      exchange.createOrder.mock.calls.map(c => c[0].clientOrderId)
    ).not.toContain(slotId);
    expect(levelsOf(s)[0].buyOrderId).toBeUndefined();
  });

  it("records a fill when the lookup resolves FOUND_FILLED", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-1", exchange);
    await s.initialize(100);
    await s.start();

    const slotId = deriveId(s, 0, "BUY");
    exchange.queryOrderByClientOrderId.mockImplementation(
      async (_symbol: string, clientOrderId: string) =>
        clientOrderId === slotId
          ? {
              kind: "FOUND_FILLED",
              order: { orderId: "filled-1", clientOrderId: slotId },
            }
          : { kind: "NOT_FOUND" }
    );

    await s.tick();

    expect(levelsOf(s)[0].filled).toBe(true);
    expect(levelsOf(s)[0].buyOrderId).toBeUndefined();
  });

  it("restores from snapshot: levels with a live buyOrderId are not re-placed", async () => {
    const first = makeExchange();
    const s1 = makeStrategy("bot-1", first);
    await s1.initialize(100);
    await s1.start();
    await s1.tick();
    expect(first.createOrder).toHaveBeenCalled();

    // A second instance restores from snapshot. Levels that already have a
    // buyOrderId must NOT be re-placed.
    const second = makeExchange();
    const s2 = makeStrategy("bot-1", second);
    await s2.initialize(100);
    await s2.start();
    await s2.tick();

    expect(second.createOrder).not.toHaveBeenCalled();
  });

  it("preserves a filled level across restart (never re-places it)", async () => {
    const first = makeExchange();
    first.getOrder.mockResolvedValue({ orderId: "O1", status: "FILLED" });
    const s1 = makeStrategy("bot-1", first);
    await s1.initialize(100);
    await s1.start();
    await s1.tick();

    expect(levelsOf(s1)[0].filled).toBe(true);
    expect(levelsOf(s1)[0].buyOrderId).toBeUndefined();

    const second = makeExchange();
    const s2 = makeStrategy("bot-1", second);
    await s2.initialize(100);
    await s2.start();
    await s2.tick();

    expect(levelsOf(s2)[0].filled).toBe(true);
    expect(levelsOf(s2)[0].buyOrderId).toBeUndefined();
    expect(second.createOrder).not.toHaveBeenCalled();
  });

  it("rebuilds fresh when the persisted snapshot shape (symbol) mismatches", async () => {
    const first = makeExchange();
    const s1 = makeStrategy("bot-1", first);
    await s1.initialize(100);
    await s1.start();
    await s1.tick();
    expect(first.createOrder).toHaveBeenCalled();

    const second = makeExchange();
    const s2 = makeStrategy("bot-1", second, {
      ...CONFIG,
      symbol: "PERP_ETH_USDC",
    });
    await s2.initialize(100);
    await s2.start();
    await s2.tick();

    expect(second.createOrder).toHaveBeenCalled();
  });

  it("persists a snapshot after a tick", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-1", exchange);
    await s.initialize(100);
    await s.start();
    await s.tick();

    const snap = loadGridSnapshot("bot-1");
    expect(snap).not.toBeNull();
    expect(snap?.baselinePrice).toBe(100);
    expect(snap?.levels.length).toBeGreaterThan(0);
  });

  it("persists a snapshot when stopped", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-1", exchange);
    await s.initialize(100);
    await s.start();
    await s.tick();
    await s.stop();

    const snap = loadGridSnapshot("bot-1");
    expect(snap).not.toBeNull();
    expect(snap?.botId).toBe("bot-1");
    expect(snap?.levels.length).toBeGreaterThan(0);
  });
});
