/** @format */

/**
 * Lighter client-order-index derivation (workstream B3).
 *
 * Lighter takes an **int64** `client_order_index` (not Orderly's ≤36-char
 * string). The grid's idempotency story needs the same logical order
 * (bot + level + side) to derive the same index after a crash/restart or a
 * redelivered command, while distinct inputs map to distinct indices.
 *
 * Derivation: sha256(`<botId>|<levelIndex>|<side>`) mod 2^62. The 2^62
 * bound (not 2^63-1) keeps every output exactly representable as a JS
 * `number` (well under `Number.MAX_SAFE_INTEGER` ≈ 9.0e15) and always
 * non-negative, so it survives JSON without BigInt handling.
 */

import { createHash } from "crypto";

/** Upper bound: 2^62 — every output is a non-negative int64. */
export const LIGHTER_CLIENT_ORDER_INDEX_MOD = 2 ** 62;

/**
 * Largest exactly-representable output: 2^62 - 1 needs 62 bits, but JS
 * `number` holds only 53 bits of integer precision. The adapter therefore
 * emits indices in int64 range on the wire as strings where precision
 * matters — see the client's `String(index)` query path. The derivation
 * itself stays within 2^62 so it is always a valid non-negative int64.
 */

export type LighterOrderSide = "BUY" | "SELL";

function hashToIndex(input: string): number {
  const digest = createHash("sha256").update(input).digest();
  const high = digest.readUInt32BE(0);
  const low = digest.readUInt32BE(4);
  // 64-bit value mod 2^62 == low 62 bits: mask the top two bits of `high`.
  const maskedHigh = high & 0x3fffffff;
  return maskedHigh * 2 ** 32 + low;
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
