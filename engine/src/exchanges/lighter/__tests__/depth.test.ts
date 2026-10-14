/** @format */

/**
 * `parseOrderBookOrders` — the pure parser behind the Lighter depth read
 * (P0.1 panic-flatten sizing). Shapes are pinned to the 2026-10-14 MAINNET
 * probe of `GET /api/v1/orderBookOrders?market_id=1&limit=5` (BTC): per-order
 * rows with human-unit decimal strings, asks ascending (best first), bids
 * descending (best first), `remaining_base_amount` = the fillable size.
 */
import { parseOrderBookOrders } from "../depth";

describe("parseOrderBookOrders (Lighter depth)", () => {
  it("parses probed mainnet rows into best-first levels (human-unit strings)", () => {
    const payload = {
      code: 200,
      total_asks: 2,
      asks: [
        {
          order_index: 562953555245372,
          price: "82227.8",
          remaining_base_amount: "0.00243",
          initial_base_amount: "0.00243",
        },
        {
          order_index: 562953555244514,
          price: "82228.3",
          remaining_base_amount: "4.85824",
          initial_base_amount: "4.86225",
        },
      ],
      total_bids: 2,
      bids: [
        {
          order_index: 844421296165578,
          price: "82220.4",
          remaining_base_amount: "0.33575",
          initial_base_amount: "0.63231",
        },
        {
          order_index: 844421296165566,
          price: "82210.9",
          remaining_base_amount: "0.12161",
          initial_base_amount: "0.12161",
        },
      ],
    };

    expect(parseOrderBookOrders(payload, 50)).toEqual({
      asks: [
        { price: 82227.8, quantity: 0.00243 },
        { price: 82228.3, quantity: 4.85824 },
      ],
      // `remaining_base_amount` (fillable), NOT the posted initial size.
      bids: [
        { price: 82220.4, quantity: 0.33575 },
        { price: 82210.9, quantity: 0.12161 },
      ],
    });
  });

  it("re-sorts rows the venue sent out of order and caps at the limit", () => {
    const payload = {
      code: 200,
      bids: [
        { price: "100.1", remaining_base_amount: "1" },
        { price: "100.3", remaining_base_amount: "3" },
        { price: "100.2", remaining_base_amount: "2" },
      ],
      asks: [] as unknown[],
    };

    const { bids } = parseOrderBookOrders(payload, 2);
    expect(bids).toEqual([
      { price: 100.3, quantity: 3 },
      { price: 100.2, quantity: 2 },
    ]);
  });

  it("skips malformed rows and falls back to the posted size (never guess)", () => {
    const payload = {
      code: 200,
      bids: [
        null,
        "junk",
        { price: "100.1" }, // no size at all
        { price: "0", remaining_base_amount: "5" }, // non-positive price
        { price: "100.0", remaining_base_amount: "abc" }, // unparseable size
        { price: "99.9", initial_base_amount: "0.5" }, // posted-size fallback
      ],
      asks: [{ price: "101.0", remaining_base_amount: "1.5" }],
    };

    expect(parseOrderBookOrders(payload, 50)).toEqual({
      bids: [{ price: 99.9, quantity: 0.5 }],
      asks: [{ price: 101, quantity: 1.5 }],
    });
  });

  it("treats an empty book as venue truth (testnet probe: total_asks 0)", () => {
    expect(
      parseOrderBookOrders(
        { code: 200, total_asks: 0, asks: [], total_bids: 0, bids: [] },
        50
      )
    ).toEqual({ bids: [], asks: [] });
    // A missing side also reads as empty — never a throw.
    expect(parseOrderBookOrders({ code: 200 }, 50)).toEqual({
      bids: [],
      asks: [],
    });
  });

  it("throws on a venue-declared bad code (never an empty book)", () => {
    expect(() => parseOrderBookOrders({ code: 20001 }, 50)).toThrow(/20001/);
  });
});
