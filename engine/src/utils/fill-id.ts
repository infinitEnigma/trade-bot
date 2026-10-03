/**
 * Fill Id - deterministic fill identity for the durable ledger.
 *
 * The Phase 4 ledger dedups on `(bot_id, client_order_id, exchange_order_id,
 * fill_id)`. None of the venues the engine talks to exposes a stable fill id
 * through the `ExchangeClient` contract yet (Lighter's fills endpoints are
 * unreachable — Gate 1 report §3.5), so the engine synthesizes one.
 *
 * Two shapes (Phase 4 partial fills):
 *
 * - **Whole-order fill** — no prior partial booked for this order and the
 *   segment spans it start to finish:
 *       fill_id = sha256(`${botId}:${clientOrderId}:${exchangeOrderId}`)
 *   byte-identical to the pre-Phase-4 synthesis, so every fill booked before
 *   the upgrade keeps deduping against a re-detection of the same fill (risk
 *   A6: ledger idempotency must survive the code change).
 *
 * - **Cumulative-qty segment** — anything else (risk A1):
 *       fill_id = sha256(
 *         `${botId}:${clientOrderId}:${exchangeOrderId}:${from8}->${to8}`)
 *   Gate 4 fixed this identity: a partially-filled resting order reports
 *   status `open` with a *cumulative, monotonic* `filled_base_amount`, no
 *   per-trade id exists, and `order_id` even mutates across fills — so the
 *   segment bounds keyed on the stable client order identity are the only
 *   viable per-fill identity. Bounds are quantized to fixed 8 dp so float
 *   drift in `cum − booked` can never mint a second id for one segment
 *   (risk A5).
 *
 * The synthesis MUST stay a pure function of the order identity + segment:
 * when the same fill is detected again (history lookup after a restart, a
 * redelivered event, a live-gate replay) it must produce the identical value
 * so the backend's unique key collapses it to one ledger row. When a venue
 * later supplies real fill ids, pass those instead — the column is plain TEXT.
 *
 * @format
 */

import { createHash } from "crypto";

/**
 * Absolute tolerance for "does this segment cover the whole order".
 * Comfortably above float noise on 8-dp quantities, far below any venue's
 * minimum size step — a real partial can never fall into the whole-order
 * bucket, and a whole order can never be mistaken for a partial.
 */
const WHOLE_ORDER_EPSILON = 1e-8;

/**
 * The cumulative-qty segment one fill books (Phase 4 identity, Gate 4).
 *
 * - `from` — cumulative quantity already booked for this order before this
 *   fill (0 when nothing was booked yet).
 * - `to`   — cumulative quantity booked after this fill (the venue's
 *   cumulative as observed).
 * - `full` — the slot's **configured** `orderQuantity`. MUST be a value
 *   stable across restarts: `OrderManager.adopt` zeroes `record.quantity`
 *   for a restored record, so deriving `full` from the record would mint a
 *   different id for the same fill after a restart and defeat dedup.
 */
export interface FillSegment {
  from: number;
  to: number;
  full: number;
}

/** Fixed 8-dp quantization of a segment bound (identity must be stable). */
function bound(value: number): string {
  return value.toFixed(8);
}

/**
 * True when the segment covers the entire order from its start — the one
 * case that keeps the legacy per-order identity (see file header).
 *
 * A non-positive `full` is treated as *not* whole-order: an unknown order
 * size must degrade to the segment form (unique per bounds), never to a
 * shared per-order hash that could collapse distinct segments (A1).
 */
export function isWholeOrderSegment(segment: FillSegment): boolean {
  return (
    segment.full > 0 &&
    segment.from <= WHOLE_ORDER_EPSILON &&
    segment.to >= segment.full - WHOLE_ORDER_EPSILON
  );
}

export function synthesizeFillId(
  botId: string,
  clientOrderId: string,
  exchangeOrderId: string,
  segment?: FillSegment
): string {
  const base = `${botId}:${clientOrderId}:${exchangeOrderId}`;
  // Whole-order (or a pre-Phase-4 caller passing no segment): legacy identity.
  if (!segment || isWholeOrderSegment(segment)) {
    return createHash("sha256").update(base).digest("hex");
  }
  return createHash("sha256")
    .update(`${base}:${bound(segment.from)}->${bound(segment.to)}`)
    .digest("hex");
}
