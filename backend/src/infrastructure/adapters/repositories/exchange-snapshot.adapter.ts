/**
 * Exchange snapshot writer — C3b venue sync.
 *
 * Persists the per-account position/balance snapshots produced by the live
 * venue reads (`external/kodiak/private-data`) into the generic tables from
 * migration 013: `exchange_positions` / `exchange_balances`, both keyed by
 * `exchange_account_id` — the whole point of C3b, since legacy `kodiak_*`
 * rows were keyed per user and collided as soon as one user held two
 * accounts holding the same symbol.
 *
 * Each write replaces the account's rows wholesale inside one transaction,
 * so positions/assets that disappeared from the venue disappear from the
 * snapshot. Column set is intentionally the 013 subset with real venue
 * sources; the remaining columns (cost_position, leverage, imr, mmr, …) keep
 * their table defaults until a venue actually reports them.
 *
 * Callers treat this as best-effort: a snapshot failure must never fail the
 * read that triggered it (they log and continue).
 */
import { transaction } from "../../../database/pool";

/** Normalized position row — venue-agnostic, mirrors 013's written subset. */
export interface PositionSnapshot {
  symbol: string;
  positionQty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
}

/** Normalized balance row — venue-agnostic, mirrors 013's written subset. */
export interface BalanceSnapshot {
  asset: string;
  holding: number;
  frozen: number;
}

function isUsableSymbol(symbol: unknown): symbol is string {
  return typeof symbol === "string" && symbol.trim().length > 0;
}

export class ExchangeSnapshotAdapter {
  /**
   * Replace the account's position snapshot. Empty array clears it — the
   * venue reporting "no positions" is data, not a failure to preserve.
   */
  async replacePositions(
    exchangeAccountId: string,
    positions: PositionSnapshot[]
  ): Promise<void> {
    if (!exchangeAccountId) {
      throw new Error("exchangeAccountId is required for a position snapshot");
    }
    const rows = positions.filter(p => isUsableSymbol(p.symbol));
    await transaction(async client => {
      await client.query(
        "DELETE FROM exchange_positions WHERE exchange_account_id = $1",
        [exchangeAccountId]
      );
      if (rows.length === 0) return;
      await client.query(
        `INSERT INTO exchange_positions
           (exchange_account_id, symbol, position_qty, average_open_price,
            mark_price, unsettled_pnl)
         SELECT $1, s.symbol, s.qty, s.entry, s.mark, s.pnl
         FROM unnest($2::text[], $3::numeric[], $4::numeric[], $5::numeric[],
                     $6::numeric[])
           AS s(symbol, qty, entry, mark, pnl)
         ON CONFLICT (exchange_account_id, symbol) DO UPDATE SET
           position_qty = EXCLUDED.position_qty,
           average_open_price = EXCLUDED.average_open_price,
           mark_price = EXCLUDED.mark_price,
           unsettled_pnl = EXCLUDED.unsettled_pnl,
           updated_at = now()`,
        [
          exchangeAccountId,
          rows.map(r => r.symbol),
          rows.map(r => r.positionQty),
          rows.map(r => r.entryPrice),
          rows.map(r => r.markPrice),
          rows.map(r => r.unrealizedPnl),
        ]
      );
    });
  }

  /** Replace the account's balance snapshot (same replace semantics). */
  async replaceBalances(
    exchangeAccountId: string,
    balances: BalanceSnapshot[]
  ): Promise<void> {
    if (!exchangeAccountId) {
      throw new Error("exchangeAccountId is required for a balance snapshot");
    }
    const rows = balances.filter(b => isUsableSymbol(b.asset));
    await transaction(async client => {
      await client.query(
        "DELETE FROM exchange_balances WHERE exchange_account_id = $1",
        [exchangeAccountId]
      );
      if (rows.length === 0) return;
      await client.query(
        `INSERT INTO exchange_balances
           (exchange_account_id, asset, holding, frozen)
         SELECT $1, s.asset, s.holding, s.frozen
         FROM unnest($2::text[], $3::numeric[], $4::numeric[])
           AS s(asset, holding, frozen)
         ON CONFLICT (exchange_account_id, asset) DO UPDATE SET
           holding = EXCLUDED.holding,
           frozen = EXCLUDED.frozen,
           updated_at = now()`,
        [
          exchangeAccountId,
          rows.map(r => r.asset),
          rows.map(r => r.holding),
          rows.map(r => r.frozen),
        ]
      );
    });
  }
}

// Export singleton instance
export const exchangeSnapshotAdapter = new ExchangeSnapshotAdapter();
