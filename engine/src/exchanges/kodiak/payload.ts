/** @format */

/**
 * Pure mapping between the engine's internal `OrderRequest` (camelCase, shared
 * by all exchange clients) and the Orderly/Kodiak REST create-order contract
 * (snake_case).
 *
 * Wire contract facts (per the repo's archived Orderly API reference and
 * orderly.network docs, "Create order"):
 * - Request body keys are snake_case: `symbol`, `order_type`, `side`,
 *   `order_price`, `order_quantity`, `client_order_id`.
 * - `order_type`: LIMIT / MARKET / IOC / FOK / POST_ONLY / ASK / BID.
 * - `side`: BUY / SELL.
 * - `client_order_id`: max 36 chars; hyphen accepted but not as the first
 *   character; must be unique among the account's open orders.
 * - Order status vocabulary: NEW / CANCELLED / PARTIAL_FILLED / FILLED /
 *   REJECTED / INCOMPLETE / COMPLETED.
 *
 * Keep this module free of I/O so the wire shape can be unit-tested and the
 * signing path can be reasoned about statically.
 */

import { OrderRequest } from "../../types/strategy";

/** snake_case body accepted by POST /v1/order. */
export interface OrderlyOrderPayload {
  symbol: string;
  order_type: "LIMIT" | "MARKET" | "IOC" | "FOK" | "POST_ONLY" | "ASK" | "BID";
  side: "BUY" | "SELL";
  order_price?: number;
  order_quantity?: number;
  order_amount?: number;
  client_order_id?: string;
}

/**
 * Characters the exchange accepts in a `client_order_id`. The documented
 * constraint is: max 36 characters, hyphen allowed but not as the first
 * character.
 */
export const CLIENT_ORDER_ID_MAX_LENGTH = 36;

export function isAcceptedOrderlyClientOrderId(value: string): boolean {
  if (value.length === 0 || value.length > CLIENT_ORDER_ID_MAX_LENGTH) {
    return false;
  }
  if (value.startsWith("-")) {
    return false;
  }
  // The documented charset (alphanumerics + hyphen, non-leading) is what the
  // generator below guarantees; anything else is treated as unaccepted.
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value);
}

/**
 * Map an internal `OrderRequest` onto the exact snake_case body the exchange
 * expects, dropping internal-only fields (e.g. `reduceOnly`).
 *
 * Limit orders require `orderPrice`; market orders must not carry a price.
 * `orderQuantity` is required for every order this engine places.
 *
 * @throws if the request would produce a body the exchange must reject
 *         (missing/invalid required fields, or a clientOrderId outside the
 *         documented charset/length constraints).
 */
export function toOrderlyOrderPayload(
  request: OrderRequest
): OrderlyOrderPayload {
  const orderType = request.orderType;
  if (!["LIMIT", "MARKET"].includes(orderType)) {
    throw new Error(`Unsupported order type: ${String(orderType)}`);
  }

  const payload: OrderlyOrderPayload = {
    symbol: request.symbol,
    order_type: orderType,
    side: request.side,
  };

  if (orderType === "LIMIT") {
    if (
      typeof request.orderPrice !== "number" ||
      !Number.isFinite(request.orderPrice)
    ) {
      throw new Error("LIMIT orders require a finite orderPrice");
    }
    payload.order_price = request.orderPrice;
  }

  if (
    typeof request.orderQuantity !== "number" ||
    !Number.isFinite(request.orderQuantity) ||
    request.orderQuantity <= 0
  ) {
    throw new Error("orderQuantity must be a finite positive number");
  }
  payload.order_quantity = request.orderQuantity;

  if (request.clientOrderId !== undefined) {
    if (!isAcceptedOrderlyClientOrderId(request.clientOrderId)) {
      throw new Error(
        `clientOrderId "${request.clientOrderId}" violates the exchange contract (max ${CLIENT_ORDER_ID_MAX_LENGTH} chars, hyphen allowed but not first)`
      );
    }
    payload.client_order_id = request.clientOrderId;
  }

  return payload;
}
