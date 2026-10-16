/** @format */

/**
 * DTO for the local trade-ledger read (`GET /api/trades`) — the unified row
 * shape behind the Dashboard's "all recent trades" table and the
 * strategy-card fills list.
 *
 * Moved from `trade-repository.adapter.ts` (dependency inversion — review P1,
 * 2026-10-15) so the use case and route can speak the row shape without
 * importing the infrastructure adapter; the adapter imports it back from here.
 *
 * `fee`/`pnl` are NULL when the engine could not source them (F2: unknown ≠
 * zero); attribution fields are NULL when the row has no strategy/bot link.
 */
export interface FilteredTrade {
  id: string;
  strategyId: string | null;
  strategyName: string | null;
  botId: string | null;
  exchangeAccountId: string | null;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number | null;
  pnl: number | null;
  status: string;
  executedAt: Date;
}
