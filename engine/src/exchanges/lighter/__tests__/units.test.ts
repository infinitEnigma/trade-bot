/** @format */

/**
 * B3 unit tests: status vocabulary, market directory, int64 derivation.
 * Pure modules — no network, no sidecar.
 */

import { normalizeLighterStatus, resolveLighterStatus } from "../status-map";
import { LighterMarketDirectory, UnknownMarketError } from "../market-map";
import {
  LIGHTER_CLIENT_ORDER_INDEX_MOD,
  deriveLighterClientOrderIndex,
} from "../client-order-id";

describe("status-map (Phase-0 vocabulary)", () => {
  it.each([
    ["open", "OPEN"],
    ["OPEN", "OPEN"],
    ["partially_filled", "OPEN"],
    ["filled", "FILLED"],
    ["canceled", "CANCELED"],
    ["cancelled", "CANCELED"],
    ["expired", "CANCELED"],
    ["rejected", "CANCELED"],
    [2, "OPEN"],
    [3, "FILLED"],
    [4, "CANCELED"],
  ])("resolves %p to %p", (status, expected) => {
    expect(resolveLighterStatus(status)).toBe(expected);
  });

  it("treats unknown values as UNRESOLVED (never absent)", () => {
    expect(resolveLighterStatus("mystery")).toBe("UNRESOLVED");
    expect(resolveLighterStatus(99)).toBe("UNRESOLVED");
    expect(resolveLighterStatus(null)).toBe("UNRESOLVED");
    expect(normalizeLighterStatus("mystery")).toBeNull();
  });
});

describe("deriveLighterClientOrderIndex", () => {
  it("is deterministic per bot/level/side and distinct across inputs", () => {
    const a = deriveLighterClientOrderIndex("bot-1", 3, "BUY");
    expect(deriveLighterClientOrderIndex("bot-1", 3, "BUY")).toBe(a);
    expect(deriveLighterClientOrderIndex("bot-1", 3, "SELL")).not.toBe(a);
    expect(deriveLighterClientOrderIndex("bot-1", 4, "BUY")).not.toBe(a);
    expect(deriveLighterClientOrderIndex("bot-2", 3, "BUY")).not.toBe(a);
  });

  it("stays a non-negative int64 below 2^62", () => {
    for (let level = 0; level < 25; level++) {
      for (const side of ["BUY", "SELL"] as const) {
        const index = deriveLighterClientOrderIndex("bot-uuid-1", level, side);
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(LIGHTER_CLIENT_ORDER_INDEX_MOD);
      }
    }
  });
});

describe("LighterMarketDirectory", () => {
  const BOOKS = {
    order_books: [{ symbol: "ETH", market_id: 1 }],
  };
  const DETAILS = {
    order_book_details: [
      {
        symbol: "ETH",
        market_id: 1,
        supported_price_decimals: 2,
        supported_size_decimals: 4,
        min_base_amount: 100,
        mark_price: "2500.5",
      },
    ],
  };

  function reader() {
    const calls: string[] = [];
    return {
      calls,
      get: async (path: string) => {
        calls.push(path);
        if (path === "/api/v1/orderBooks") return { data: BOOKS };
        return { data: DETAILS };
      },
    };
  }

  it("resolves ETH with decimals and caches within TTL", async () => {
    const stub = reader();
    const dir = new LighterMarketDirectory(stub, 60_000);
    const first = await dir.get("eth");
    expect(first).toMatchObject({
      marketIndex: 1,
      symbol: "ETH",
      priceDecimals: 2,
      sizeDecimals: 4,
    });
    await dir.get("ETH");
    expect(stub.calls.filter(c => c === "/api/v1/orderBooks")).toHaveLength(1);
  });

  it("throws UnknownMarketError (never a guess) for unknown symbols", async () => {
    const dir = new LighterMarketDirectory(reader(), 60_000);
    await expect(dir.get("NOPE")).rejects.toBeInstanceOf(UnknownMarketError);
  });
});
