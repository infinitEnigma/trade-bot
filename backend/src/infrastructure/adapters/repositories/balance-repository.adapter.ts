/**
 * Balance Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IBalanceRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for balance data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { IBalanceRepository, Balance, BalanceHistory } from "@trade-bot/shared";
import { databaseLogger as logger } from "../../../core/logging/context-aware-logger.service";
import { query } from "../../../database/pool";

/**
 * Balance Repository Adapter
 *
 * Implements the IBalanceRepository interface using PostgreSQL database operations.
 * Provides balance data access with proper error handling and type safety.
 */
export class BalanceRepositoryAdapter implements IBalanceRepository {
  // Allow injection of query function for testing
  constructor(private readonly queryFn = query) {}

  /**
   * Get user's current balance (C3b: aggregated from `exchange_balances`,
   * which stores one row per asset per account).
   *
   * The single-Balance shape cannot express per-asset holdings of several
   * accounts, so the rows collapse to one number: the primary quote asset
   * (USD/USDC/USDT with the largest total holding across the user's
   * accounts; if none of those exist, the asset with the largest numeric
   * holding). No rows at all → Balance.zero("USD"), as before.
   */
  async getBalance(userId: string): Promise<Balance> {
    try {
      const result = await this.queryFn(
        `SELECT eb.asset, eb.holding, eb.frozen, eb.updated_at
         FROM exchange_balances eb
         JOIN exchange_accounts ea ON ea.id = eb.exchange_account_id
         WHERE ea.user_id = $1`,
        [userId]
      );
      const typedResult = result as {
        rows: Array<{
          asset: string;
          holding: string;
          frozen: string;
          updated_at: string;
        }>;
      };

      if (typedResult.rows.length === 0) {
        return Balance.zero("USD");
      }

      // One user can hold the same asset in several accounts — aggregate
      // per asset before picking the primary one.
      const perAsset = new Map<
        string,
        { holding: number; frozen: number; lastMs: number }
      >();
      for (const row of typedResult.rows) {
        const holding = parseFloat(row.holding || "0") || 0;
        const frozen = parseFloat(row.frozen || "0") || 0;
        const updatedMs = row.updated_at
          ? new Date(row.updated_at).getTime()
          : NaN;
        const agg = perAsset.get(row.asset) ?? {
          holding: 0,
          frozen: 0,
          lastMs: 0,
        };
        agg.holding += holding;
        agg.frozen += frozen;
        if (Number.isFinite(updatedMs)) {
          agg.lastMs = Math.max(agg.lastMs, updatedMs);
        }
        perAsset.set(row.asset, agg);
      }

      const quoteAssets = ["USD", "USDC", "USDT"];
      const candidates = [...perAsset.entries()].filter(([asset]) =>
        quoteAssets.includes(asset)
      );
      const pool = candidates.length > 0 ? candidates : [...perAsset.entries()];
      // Largest holding first; asset name breaks ties deterministically.
      pool.sort(
        (a, b) => b[1].holding - a[1].holding || a[0].localeCompare(b[0])
      );
      const [primaryAsset, primary] = pool[0];

      const lastMs = Math.max(...[...perAsset.values()].map(v => v.lastMs));
      return new Balance(
        primary.holding,
        primary.holding - primary.frozen,
        primary.frozen,
        primaryAsset,
        Number.isFinite(lastMs) && lastMs > 0 ? new Date(lastMs) : new Date()
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get balance", error as Error);
      throw new Error(`Failed to get balance: ${errorMessage}`);
    }
  }

  /**
   * Update user's balance (C3b: upserts the single-Balance view back into
   * `exchange_balances` for the user's default account — earliest ACTIVE,
   * kodiak first, the same convention `getUserCredentials` uses. The
   * userId-only interface cannot address one account of many; the
   * account-keyed writer is `exchange-snapshot.adapter.replaceBalances`.)
   */
  async updateBalance(userId: string, balance: Balance): Promise<void> {
    try {
      await this.queryFn(
        `INSERT INTO exchange_balances
           (exchange_account_id, asset, holding, frozen)
         SELECT ea.id, $2, $3, $4
         FROM exchange_accounts ea
         WHERE ea.user_id = $1 AND ea.status = 'ACTIVE'
         ORDER BY CASE ea.exchange WHEN 'kodiak' THEN 0 ELSE 1 END,
                  ea.created_at ASC, ea.id ASC
         LIMIT 1
         ON CONFLICT (exchange_account_id, asset) DO UPDATE SET
           holding = EXCLUDED.holding,
           frozen = EXCLUDED.frozen,
           updated_at = now()`,
        [userId, balance.currency, balance.total, balance.locked]
      );
      logger.info(
        `Balance update for user ${userId}: ${balance.total} ${balance.currency}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to update balance", error as Error);
      throw new Error(`Failed to update balance: ${errorMessage}`);
    }
  }

  /**
   * Get balance history for a user
   */
  async getBalanceHistory(
    userId: string,
    limit: number = 50
  ): Promise<BalanceHistory[]> {
    try {
      const result = await this.queryFn(
        "SELECT * FROM balance_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        [userId, limit]
      );

      const typedResult = result as {
        rows: Array<{
          id: string;
          user_id: string;
          total: string;
          available: string;
          locked: string;
          currency: string;
          last_updated: string;
          change_reason: string;
          change_amount: string;
          created_at: string;
        }>;
      };

      return typedResult.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        balance: new Balance(
          parseFloat(row.total),
          parseFloat(row.available),
          parseFloat(row.locked),
          row.currency,
          new Date(row.last_updated)
        ),
        changeReason: row.change_reason,
        changeAmount: parseFloat(row.change_amount),
        timestamp: new Date(row.created_at),
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get balance history", error as Error);
      throw new Error(`Failed to get balance history: ${errorMessage}`);
    }
  }
}

// Export singleton instance
export const balanceRepositoryAdapter = new BalanceRepositoryAdapter();
