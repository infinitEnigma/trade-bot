import {
  toOrderlyOrderPayload,
  isAcceptedOrderlyClientOrderId,
} from "../payload";
import { OrderRequest } from "../../../types/strategy";

const BASE: OrderRequest = {
  symbol: "PERP_BTC_USDC",
  orderType: "LIMIT",
  side: "BUY",
  orderPrice: 100.5,
  orderQuantity: 2,
  clientOrderId: "abc123",
};

describe("toOrderlyOrderPayload", () => {
  it("maps the camelCase domain request onto the documented snake_case body", () => {
    expect(toOrderlyOrderPayload(BASE)).toEqual({
      symbol: "PERP_BTC_USDC",
      order_type: "LIMIT",
      side: "BUY",
      order_price: 100.5,
      order_quantity: 2,
      client_order_id: "abc123",
    });
  });

  it("emits exactly the wire keys with no camelCase remnants", () => {
    const payload = toOrderlyOrderPayload(BASE) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "symbol",
        "order_type",
        "side",
        "order_price",
        "order_quantity",
        "client_order_id",
      ].sort()
    );
    expect(Object.keys(payload)).not.toContain("orderType");
    expect(Object.keys(payload)).not.toContain("orderPrice");
    expect(Object.keys(payload)).not.toContain("orderQuantity");
    expect(Object.keys(payload)).not.toContain("clientOrderId");
  });

  it("throws when a LIMIT order has no finite price", () => {
    expect(() =>
      toOrderlyOrderPayload({ ...BASE, orderPrice: undefined })
    ).toThrow(/orderPrice/);
    expect(() => toOrderlyOrderPayload({ ...BASE, orderPrice: NaN })).toThrow(
      /orderPrice/
    );
  });

  it("throws when orderQuantity is missing or non-positive", () => {
    expect(() => toOrderlyOrderPayload({ ...BASE, orderQuantity: 0 })).toThrow(
      /orderQuantity/
    );
    expect(() =>
      toOrderlyOrderPayload({
        ...BASE,
        orderQuantity: undefined as unknown as number,
      })
    ).toThrow(/orderQuantity/);
  });

  it("throws on an unsupported order type instead of emitting it verbatim", () => {
    expect(() =>
      toOrderlyOrderPayload({
        ...BASE,
        orderType: "POST_ONLY" as unknown as OrderRequest["orderType"],
      })
    ).toThrow(/order type/i);
  });

  it("rejects a clientOrderId outside the exchange contract", () => {
    expect(() => toOrderlyOrderPayload({ ...BASE, clientOrderId: "" })).toThrow(
      /clientOrderId/
    );
    expect(() =>
      toOrderlyOrderPayload({
        ...BASE,
        clientOrderId: "-leading-hyphen",
      })
    ).toThrow(/clientOrderId/);
    expect(() =>
      toOrderlyOrderPayload({ ...BASE, clientOrderId: "a".repeat(37) })
    ).toThrow(/clientOrderId/);
  });
});

describe("isAcceptedOrderlyClientOrderId", () => {
  it("accepts a 36-char id that does not start with a hyphen", () => {
    const uuid = "8f14e45f-ceea-467f-abf5-ee02d76df6b2";
    expect(uuid.length).toBe(36);
    expect(isAcceptedOrderlyClientOrderId(uuid)).toBe(true);
  });

  it("rejects empty, oversized, colon-bearing and leading-hyphen ids", () => {
    expect(isAcceptedOrderlyClientOrderId("")).toBe(false);
    expect(isAcceptedOrderlyClientOrderId("a".repeat(37))).toBe(false);
    expect(isAcceptedOrderlyClientOrderId("bot-1:0:BUY")).toBe(false);
    expect(isAcceptedOrderlyClientOrderId("-abc")).toBe(false);
  });
});
