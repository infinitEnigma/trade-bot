/** @format */

/**
 * Pure open-order mappers (Phase 3 slice 1) — Orderly row → OpenOrderRow,
 * Lighter row → OpenOrderRow, and venue-envelope row extraction. No I/O:
 * these pin the exact wire→table translation the two venue readers
 * (`kodiakIntegrationService.getOrders`, `getLighterOrders`) delegate here.
 */

import {
  mapKodiakOrderRow,
  mapLighterOrderRow,
  orderRowsFromEnvelope,
} from "../../src/infrastructure/external/open-orders";

const DIRECTORY = new Map<number, string>([[4095, "ETH"]]);

describe("orderRowsFromEnvelope", () => {
  it("unwraps the Orderly { success, data: { rows } } envelope", () => {
    expect(
      orderRowsFromEnvelope({ success: true, data: { rows: ["a", "b"] } })
    ).toEqual(["a", "b"]);
  });

  it("accepts a bare array and a flat { rows } bag", () => {
    expect(orderRowsFromEnvelope([1, 2])).toEqual([1, 2]);
    expect(orderRowsFromEnvelope({ rows: [3] })).toEqual([3]);
  });

  it("degrades unrecognised payloads to an empty book", () => {
    expect(orderRowsFromEnvelope(null)).toEqual([]);
    expect(orderRowsFromEnvelope("boom")).toEqual([]);
    expect(orderRowsFromEnvelope({ success: false })).toEqual([]);
    expect(orderRowsFromEnvelope({ data: {} })).toEqual([]);
  });
});

describe("mapKodiakOrderRow", () => {
  const ORDERLY_ROW = {
    order_id: "o-1",
    client_order_id: "bot-a-3-B",
    symbol: "PERP_ETH_USDC",
    side: "SELL",
    order_type: "LIMIT",
    order_price: "2745.14",
    order_quantity: "0.0100",
    executed_quantity: "0.0025",
    status: "NEW",
    created_time: 1790116529366,
  };

  it("maps an Orderly row onto OpenOrderRow (human units preserved)", () => {
    expect(mapKodiakOrderRow(ORDERLY_ROW)).toEqual({
      orderId: "o-1",
      clientOrderId: "bot-a-3-B",
      symbol: "PERP_ETH_USDC",
      side: "SELL",
      orderType: "LIMIT",
      price: 2745.14,
      quantity: 0.01,
      filledQuantity: 0.0025,
      status: "NEW",
      createdAtMs: 1790116529366,
      exchange: "kodiak",
    });
  });

  it("normalises seconds to ms, defaults status and the BUY side", () => {
    const row = mapKodiakOrderRow({
      order_id: "o-2",
      side: "buy",
      created_time: 1790116529,
    });
    expect(row).toEqual({
      orderId: "o-2",
      clientOrderId: null,
      symbol: "",
      side: "BUY",
      orderType: "",
      price: null,
      quantity: null,
      filledQuantity: 0,
      status: "OPEN",
      createdAtMs: 1790116529000,
      exchange: "kodiak",
    });
  });

  it("falls back to the requested symbol when the row omits one", () => {
    const row = mapKodiakOrderRow({ order_id: "o-3" }, "PERP_BTC_USDC");
    expect(row?.symbol).toBe("PERP_BTC_USDC");
  });

  it("returns null for rows that cannot be keyed", () => {
    expect(mapKodiakOrderRow(null)).toBeNull();
    expect(mapKodiakOrderRow("row")).toBeNull();
    expect(mapKodiakOrderRow([])).toBeNull();
    expect(mapKodiakOrderRow({})).toBeNull();
    expect(mapKodiakOrderRow({ symbol: "PERP_ETH_USDC" })).toBeNull();
  });
});

describe("mapLighterOrderRow", () => {
  const LIGHTER_ROW = {
    order_id: "560123456789000",
    client_order_index: "31",
    client_order_id: "bot-a-3-B",
    market_id: 4095,
    status: "open",
    is_ask: true,
    price: "2600",
    initial_base_amount: "1",
    remaining_base_amount: "0.75",
    filled_base_amount: "0.25",
    transaction_time: 1790116529366,
  };

  it("maps an active order with the client index as handle (engine parity)", () => {
    expect(mapLighterOrderRow(LIGHTER_ROW, DIRECTORY)).toEqual({
      orderId: "31",
      clientOrderId: "bot-a-3-B",
      symbol: "PERP_ETH_USDC",
      side: "SELL",
      orderType: "",
      price: 2600,
      quantity: 1,
      filledQuantity: 0.25,
      status: "OPEN",
      createdAtMs: 1790116529366,
      exchange: "lighter",
    });
  });

  it("reads human units, keeping filled/size distinct", () => {
    const row = mapLighterOrderRow(
      {
        order_id: "999",
        market_id: 4095,
        is_ask: false,
        price: "65000.5",
        initial_base_amount: "0.01",
        filled_base_amount: "0.004",
        status: "partially_filled",
      },
      DIRECTORY
    );
    expect(row).toEqual({
      orderId: "999",
      clientOrderId: null,
      symbol: "PERP_ETH_USDC",
      side: "BUY",
      orderType: "",
      price: 65000.5,
      quantity: 0.01,
      filledQuantity: 0.004,
      status: "PARTIALLY_FILLED",
      createdAtMs: null,
      exchange: "lighter",
    });
  });

  it("falls back: remaining quantity, side via `side`, directory miss → raw id", () => {
    const row = mapLighterOrderRow(
      {
        order_id: "888",
        market_id: 4096,
        side: "ask",
        price: "100",
        remaining_base_amount: "0.75",
      },
      DIRECTORY
    );
    expect(row).toEqual({
      orderId: "888",
      clientOrderId: null,
      symbol: "PERP_4096_USDC",
      side: "SELL",
      orderType: "",
      price: 100,
      quantity: 0.75,
      filledQuantity: 0,
      status: "OPEN",
      createdAtMs: null,
      exchange: "lighter",
    });
  });

  it("returns null for rows without any handle", () => {
    expect(mapLighterOrderRow(null, DIRECTORY)).toBeNull();
    expect(mapLighterOrderRow({ price: "1" }, DIRECTORY)).toBeNull();
    expect(mapLighterOrderRow({ is_ask: true }, DIRECTORY)).toBeNull();
  });
});
