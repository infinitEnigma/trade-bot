/** @format */

/**
 * Lighter client-order-index derivation (workstream B3).
 *
 * Lighter takes an **int64** `client_order_index` (not Orderly's ≤36-char
 * string). The grid's idempotency story needs the same logical order
 * (bot + level + side) to derive the same index after a crash/restart or a
 * redelivered command, while distinct inputs map to distinct indices.
 *
 * Derivation: sha256(`<key>|<side>`) mod 2^48. The output is always
 * non-negative, exactly representable as a JS `number`, and inside the
 * venue's accepted index range.
 *
 * The 2^48 bound is a hard venue rule, live-verified on testnet
 * (account 123, 2026-09-30):
 * - `create-order` refuses a larger index: "ClientOrderIndex should not be
 *   larger than 281474976710655" (2^48 - 1);
 * - `GET /api/v1/accountOrders?client_order_indexes=<max>` answers
 *   `400 {"code":20001,"message":"invalid param : invalid client order index"}`
 *   for anything above that bound, while 2^48 - 1 returns `200`.
 * A 2^62 index therefore broke the emergency flatten twice over: the venue
 * refused the signed order AND the post-refusal lookup 400'd, which surfaced
 * as "lighter unreachable after refusal" instead of the real refusal.
 */

import { createHash } from "crypto";

/**
 * Upper bound: 2^48 — the venue's maximum accepted `client_order_index`
 * is 281474976710655 (`2 ** 48 - 1`), and every output also stays exactly
 * representable as a JS `number`.
 */
export const LIGHTER_CLIENT_ORDER_INDEX_MOD = 2 ** 48;

export type LighterOrderSide = "BUY" | "SELL";

function hashToIndex(input: string): number {
  const digest = createHash("sha256").update(input).digest();
  const high = digest.readUInt32BE(0);
  const low = digest.readUInt32BE(4);
  // 64-bit value mod 2^48 == low 48 bits; the 16-bit bound is the venue's
  // maximum accepted client order index (see the module header).
  return (high * 2 ** 32 + low) % LIGHTER_CLIENT_ORDER_INDEX_MOD;
}

/**
 * Derive the deterministic client order index for one grid slot.
 *
 * @throws when `levelIndex` is not a non-negative integer.
 */
export function deriveLighterClientOrderIndex(
  botId: string,
  levelIndex: number,
  side: LighterOrderSide
): number {
  if (!botId) throw new Error("deriveLighterClientOrderIndex needs a botId");
  if (!Number.isInteger(levelIndex) || levelIndex < 0) {
    throw new Error(
      `levelIndex must be a non-negative integer, got ${levelIndex}`
    );
  }
  return deriveLighterClientOrderIndexForKey(`${botId}|${levelIndex}`, side);
}

/**
 * Derive the index from an arbitrary **slot key** rather than bot/level.
 *
 * Used when the caller supplies no deterministic `clientOrderId` and the
 * adapter must still invent one: the key has to identify the logical slot
 * (e.g. `<symbol>|<scaled price>`) so it stays stable across restarts and
 * distinct between slots — hashing a constant would make two different
 * resting levels share one index and let the venue adopt the wrong order.
 */
export function deriveLighterClientOrderIndexForKey(
  key: string,
  side: LighterOrderSide
): number {
  if (!key) throw new Error("deriveLighterClientOrderIndexForKey needs a key");
  return hashToIndex(`${key}|${side}`);
}
