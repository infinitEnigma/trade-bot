/**
 * Grid arming state table (Phase 4, risk C1).
 *
 * Arming used to read the derived boolean `filled`, which a partial fill cannot
 * describe. It is now explicit and quantity-based, so this pins the whole
 * table rather than the two happy paths: what the level holds × which orders
 * are live × where price is → what is placed, and for what size. Every case
 * seeds a snapshot (the same restore path production takes), so legacy
 * boolean-only states and Phase-4 quantities are covered alike.
 *
 * @format
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

/** 97.5 | 100 | 102.5. */
const LEVEL_0 = 97.5;
const LEVEL_1 = 100;
const LEVEL_2 = 102.5;
const ABOVE = LEVEL_0 + 0.5;
const BELOW = LEVEL_0 - 0.5;

type MockExchange = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  getPositions: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
};

function makeExchange(handles: string[] = []): MockExchange {
  let seq = 0;
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
    // Whatever we ask about reads as live — the seeded handles are open at the
    // venue, and the arming decision never depends on their executions.
    getOrder: jest.fn().mockImplementation(async (orderId: string) => ({
      orderId,
      status: "OPEN",
    })),
    createOrder: jest.fn().mockImplementation(async () => ({
      orderId: `O${(seq += 1)}`,
      status: "OPEN",
    })),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    getPositions: jest.fn().mockResolvedValue([]),
    listOpenOrders: jest.fn().mockResolvedValue(
      handles.map(orderId => ({
        orderId,
        symbol: CONFIG.symbol,
        status: "OPEN",
      }))
    ),
    queryOrderByClientOrderId: jest
      .fn()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
  };
}

/** What the level looked like in the snapshot before the bot started. */
interface LevelState {
  heldQty?: number;
  buyFilledQty?: number;
  sellFilledQty?: number;
  filled?: boolean;
  entryPrice?: number;
  buyOrderId?: string;
  sellOrderId?: string;
}

async function seedState(botId: string, state: LevelState): Promise<void> {
  await saveGridSnapshot({
    version: 1,
    botId,
    symbol: CONFIG.symbol,
    gridSize: CONFIG.gridSize,
    gridRangePercent: CONFIG.gridRangePercent,
    baselinePrice: 100,
    levels: [
      { price: LEVEL_0, filled: false, ...state },
      { price: LEVEL_1, filled: false },
      { price: LEVEL_2, filled: false },
    ],
    savedAt: new Date().toISOString(),
  });
}

interface Placed {
  side: string;
  orderPrice: number;
  orderQuantity: number;
  clientOrderId: string;
}

function placed(exchange: MockExchange): Placed[] {
  return exchange.createOrder.mock.calls.map(
    c =>
      c[0] as {
        side: string;
        orderPrice: number;
        orderQuantity: number;
        clientOrderId: string;
      }
  );
}

/**
 * Orders placed for one level in that tick, identified by the level index the
 * client order id packs (a level's exit shares a price with the next line's
 * entry, so price alone cannot tell them apart).
 */
function levelOrders(
  exchange: MockExchange,
  level: number,
  side?: "BUY" | "SELL"
): Placed[] {
  const tag = `-0${level}-`;
  return placed(exchange).filter(
    o => o.clientOrderId.includes(tag) && (!side || o.side === side)
  );
}

/** Start a bot over the seeded snapshot and run one tick at `price`. */
async function tickAt(
  botId: string,
  state: LevelState,
  price: number
): Promise<{ exchange: MockExchange; strategy: GridTradingStrategy }> {
  await seedState(botId, state);
  const handles = [state.buyOrderId, state.sellOrderId].filter(
    (id): id is string => Boolean(id)
  );
  const exchange = makeExchange(handles);
  exchange.getTicker.mockResolvedValue({ symbol: CONFIG.symbol, price });
  const strategy = new GridTradingStrategy(
    botId,
    CONFIG,
    exchange as unknown as ExchangeClient
  );
  await strategy.initialize(100);
  await strategy.start();
  await strategy.tick();
  return { exchange, strategy };
}

/** Orders placed for level 0 in that tick. */
function level0Orders(exchange: MockExchange): Placed[] {
  return levelOrders(exchange, 0);
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-arming-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

describe("GridTradingStrategy arming state table (C1)", () => {
  it("places a full-slot entry on a level that holds nothing", async () => {
    const { exchange } = await tickAt("bot-arm-1", {}, BELOW);

    expect(level0Orders(exchange)).toMatchObject([
      { side: "BUY", orderPrice: LEVEL_0, orderQuantity: 1 },
    ]);
  });

  it("places nothing for that level when price is above it", async () => {
    const { exchange } = await tickAt("bot-arm-2", {}, ABOVE);

    // No entry (price is above the line) and no exit (nothing is long).
    expect(level0Orders(exchange)).toEqual([]);
  });

  it("keeps a live partial entry and never arms its exit (partial-buy live)", async () => {
    const { exchange } = await tickAt(
      "bot-arm-3",
      {
        heldQty: 0.4,
        buyFilledQty: 0.4,
        entryPrice: LEVEL_0,
        buyOrderId: "H-buy",
      },
      ABOVE
    );

    // The handle is live (nothing is placed over it) and 0.4 is not a slot.
    expect(level0Orders(exchange)).toEqual([]);
  });

  it("tops up the shortfall, not the slot, once a partial entry is gone", async () => {
    const { exchange } = await tickAt(
      "bot-arm-4",
      { heldQty: 0.4, buyFilledQty: 0.4, entryPrice: LEVEL_0 },
      BELOW
    );

    expect(level0Orders(exchange)).toMatchObject([
      { side: "BUY", orderPrice: LEVEL_0, orderQuantity: 0.6 },
    ]);
  });

  it("arms exactly one exit per full slot and no second entry (full long)", async () => {
    const { exchange } = await tickAt(
      "bot-arm-5",
      { heldQty: 1, filled: true, entryPrice: LEVEL_0 },
      ABOVE
    );

    expect(level0Orders(exchange)).toMatchObject([
      { side: "SELL", orderPrice: LEVEL_1, orderQuantity: 1 },
    ]);
  });

  it("places nothing for a full long when price has not reached it", async () => {
    const { exchange } = await tickAt(
      "bot-arm-6",
      { heldQty: 1, filled: true, entryPrice: LEVEL_0 },
      BELOW
    );

    // Fully long: no entry. Below the line: no exit.
    expect(level0Orders(exchange)).toEqual([]);
  });

  it("keeps a live partial exit and blocks an entry beside it (partial-sell live)", async () => {
    const { exchange } = await tickAt(
      "bot-arm-7",
      {
        heldQty: 0.6,
        filled: false,
        entryPrice: LEVEL_0,
        sellFilledQty: 0.4,
        sellOrderId: "H-sell",
      },
      BELOW
    );

    // A resting exit means the level already holds what it can: an entry here
    // would open a second long next to it.
    expect(level0Orders(exchange)).toEqual([]);
  });

  it("re-enters the shortfall after a partial exit is gone (partial-sell → cancel)", async () => {
    const { exchange } = await tickAt(
      "bot-arm-8",
      { heldQty: 0.6, filled: false, entryPrice: LEVEL_0 },
      BELOW
    );

    expect(level0Orders(exchange)).toMatchObject([
      { side: "BUY", orderPrice: LEVEL_0, orderQuantity: 0.4 },
    ]);
  });

  it("re-enters after a cancel that booked nothing (cancel-with-no-fill)", async () => {
    const { exchange } = await tickAt("bot-arm-9", {}, BELOW);

    // Nothing was booked by the vanished order, so the level is untouched and
    // the entry is placed for the full slot as before.
    expect(level0Orders(exchange)).toMatchObject([
      { side: "BUY", orderPrice: LEVEL_0, orderQuantity: 1 },
    ]);
  });

  it("treats a legacy boolean-only empty level as holding nothing", async () => {
    const { exchange } = await tickAt("bot-arm-10", { filled: false }, BELOW);

    expect(level0Orders(exchange)).toMatchObject([
      { side: "BUY", orderPrice: LEVEL_0, orderQuantity: 1 },
    ]);
  });

  it("treats a legacy boolean-only filled level as one full slot", async () => {
    const { exchange } = await tickAt(
      "bot-arm-11",
      { filled: true, entryPrice: LEVEL_0 },
      ABOVE
    );

    expect(level0Orders(exchange)).toMatchObject([
      { side: "SELL", orderPrice: LEVEL_1, orderQuantity: 1 },
    ]);
  });
});
