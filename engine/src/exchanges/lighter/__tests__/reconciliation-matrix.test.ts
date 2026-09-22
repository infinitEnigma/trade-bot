/** @format */
/**
 * B5 grid slot matrix — scripted fake exchange, no network.
 */
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy } from "../../../strategies/grid";
import {
  ExchangeClient,
  ExchangeOrderRequest,
  OrderLookup,
} from "../../../domain/exchange";
import { GridStrategyConfig } from "../../../types/strategy";

const CONFIG: GridStrategyConfig = {
  symbol: "ETH",
  gridSize: 2,
  orderQuantity: 0.01,
  gridRangePercent: 5,
};

type Script = {
  query: (clientOrderId: string) => Promise<OrderLookup>;
  create?: (request: ExchangeOrderRequest) => Promise<never>;
};

function fakeExchange(script: Script): ExchangeClient & {
  created: ExchangeOrderRequest[];
} {
  const created: ExchangeOrderRequest[] = [];
  return {
    created,
    getTicker: async () => ({ symbol: CONFIG.symbol, price: 2500 }),
    getOrder: async (orderId: string) => ({ orderId, status: "OPEN" }),
    createOrder: async (request: ExchangeOrderRequest) => {
      created.push(request);
      if (script.create) return script.create(request);
      return { orderId: `live-${created.length}`, status: "OPEN" };
    },
    cancelOrder: async () => ({ status: "CANCELLED" }),
    getPositions: async () => [],
    getAccountInfo: async () => ({ total_value: 0, max_leverage: 1 }),
    listOpenOrders: async () => [],
    queryOrderByClientOrderId: async (_symbol: string, id: string) =>
      script.query(id),
  };
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "b5-matrix-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

describe("B5 grid slot matrix", () => {
  it("accept-then-drop: live order is adopted, nothing placed", async () => {
    const exchange = fakeExchange({
      query: async () => ({
        kind: "FOUND_OPEN",
        order: { orderId: "live-9", symbol: "ETH", status: "OPEN" },
      }),
      create: async () => {
        throw new Error("lost after accept");
      },
    });
    const s = new GridTradingStrategy("bot-b5a", CONFIG, exchange);
    await s.initialize(2500);
    await s.start();
    await s.tick();
    expect(exchange.created).toHaveLength(0);
  });
  it("duplicate-id: pre-existing live order is adopted", async () => {
    const exchange = fakeExchange({
      query: async id => ({
        kind: "FOUND_OPEN",
        order: {
          orderId: "live-dup",
          clientOrderId: id,
          symbol: "ETH",
          status: "OPEN",
        },
      }),
    });
    const s = new GridTradingStrategy("bot-b5b", CONFIG, exchange);
    await s.initialize(2500);
    await s.start();
    await s.tick();
    expect(exchange.created).toHaveLength(0);
  });
  it("NOT_FOUND: absent slots are placed exactly once", async () => {
    const exchange = fakeExchange({
      query: async () => ({ kind: "NOT_FOUND" }),
    });
    const s = new GridTradingStrategy("bot-b5c", CONFIG, exchange);
    await s.initialize(2500);
    await s.start();
    await s.tick();
    expect(exchange.created.length).toBeGreaterThan(0);
    const first = exchange.created.length;
    await s.tick();
    expect(exchange.created.length).toBe(first);
  });
  it("FOUND_CANCELED: terminal orders are re-placed", async () => {
    const exchange = fakeExchange({
      query: async id => ({
        kind: "FOUND_CANCELED",
        order: {
          orderId: "old-1",
          clientOrderId: id,
          symbol: "ETH",
          status: "CANCELLED",
        },
      }),
    });
    const s = new GridTradingStrategy("bot-b5d", CONFIG, exchange);
    await s.initialize(2500);
    await s.start();
    await s.tick();
    expect(exchange.created.length).toBeGreaterThan(0);
  });
  it("FOUND_FILLED: fills recorded, never re-placed", async () => {
    const exchange = fakeExchange({
      query: async id => ({
        kind: "FOUND_FILLED",
        order: {
          orderId: "f-1",
          clientOrderId: id,
          symbol: "ETH",
          status: "FILLED",
          quantity: 0.01,
        },
      }),
    });
    const s = new GridTradingStrategy("bot-b5e", CONFIG, exchange);
    await s.initialize(2500);
    await s.start();
    await s.tick();
    expect(exchange.created).toHaveLength(0);
    expect(s.getTrades().length).toBeGreaterThan(0);
  });
  it("UNREACHABLE timeout: slot freezes", async () => {
    const exchange = fakeExchange({
      query: async () => ({ kind: "UNREACHABLE", reason: "timed out" }),
    });
    const s = new GridTradingStrategy("bot-b5f", CONFIG, exchange);
    await s.initialize(2500);
    await s.start();
    await s.tick();
    expect(exchange.created).toHaveLength(0);
  });
  it("UNREACHABLE 500: slot freezes", async () => {
    const exchange = fakeExchange({
      query: async () => ({ kind: "UNREACHABLE", reason: "responded 500" }),
    });
    const s = new GridTradingStrategy("bot-b5g", CONFIG, exchange);
    await s.initialize(2500);
    await s.start();
    await s.tick();
    expect(exchange.created).toHaveLength(0);
  });
});
