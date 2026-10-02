/**
 * Fill Id - deterministic fill identity for the durable ledger.
 *
 * The Phase 4 ledger dedups on `(bot_id, client_order_id, exchange_order_id,
 * fill_id)`. None of the venues the engine talks to exposes a stable fill id
 * through the `ExchangeClient` contract yet (Lighter's fills endpoints are
 * unreachable — Gate 1 report §3.5), so the engine synthesizes one:
 *
 *   fill_id = sha256(`${botId}:${clientOrderId}:${exchangeOrderId}`)
 *
 * The synthesis MUST stay a pure function of the order identity: when the
 * same fill is detected again (history lookup after a restart, a redelivered
 * event, a live-gate replay) it must produce the identical value so the
 * backend's unique key collapses it to one ledger row. When a venue later
 * supplies real fill ids, pass those instead — the column is plain TEXT.
 *
 * @format
 */

import { createHash } from "crypto";

export function synthesizeFillId(
  botId: string,
  clientOrderId: string,
  exchangeOrderId: string
): string {
  return createHash("sha256")
    .update(`${botId}:${clientOrderId}:${exchangeOrderId}`)
    .digest("hex");
}
