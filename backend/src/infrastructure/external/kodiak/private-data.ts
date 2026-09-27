/**
 * Authenticated user-data methods for the Kodiak integration.
 *
 * Method bodies are verbatim from the former monolithic
 * `kodiak-integration.service.ts`. They are mounted onto the
 * `KodiakIntegrationService` prototype by the facade, so instance-level
 * patching (`service.resolveKodiakAccount = jest.fn()`) keeps working.
 *
 * Cache policy (unchanged): positions/trades use the in-memory `kodiakCache`,
 * balance/account-info use Redis. C3b: keys carry `exchangeAccountId` when a
 * request is account-scoped, and successful venue reads persist a snapshot
 * into `exchange_positions` / `exchange_balances`.
 */

import { redisService } from "../../cache/redis.service";
import { kodiakCache } from "../kodiak-cache";
import { externalTrafficObserver } from "../external-traffic-observer";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
import { exchangeSnapshotAdapter } from "../../adapters/repositories/exchange-snapshot.adapter";
import type {
  PositionSnapshot,
  BalanceSnapshot,
} from "../../adapters/repositories/exchange-snapshot.adapter";
// Type-only import: the bags are mounted onto the facade's prototype.
import type { KodiakIntegrationService } from "../kodiak-integration.service";
import type {
  KodiakAccountInfo,
  KodiakApiAccountInfoResponse,
  KodiakApiResponse,
  KodiakBalance,
  KodiakHolding,
  KodiakHoldingsResponse,
  KodiakPosition,
  KodiakTrade,
} from "./types";

/** Venue string/number → finite number (never poison a numeric column). */
function num(value: unknown): number {
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * C3b venue sync — persist the per-account position snapshot (best-effort:
 * a snapshot failure is logged, never propagated to the read).
 */
async function persistPositionSnapshot(
  exchangeAccountId: string,
  positions: KodiakPosition[],
  userId: string,
  requestAccountId?: string
): Promise<void> {
  try {
    const rows: PositionSnapshot[] = positions
      .filter(p => typeof p?.symbol === "string" && p.symbol.trim() !== "")
      .map(p => ({
        symbol: p.symbol,
        positionQty: num(p.positionAmt),
        entryPrice: num(p.entryPrice),
        markPrice: num(p.markPrice),
        unrealizedPnl: num(p.pnl),
      }));
    await exchangeSnapshotAdapter.replacePositions(exchangeAccountId, rows);
  } catch (error) {
    logger.error("Failed to persist position snapshot", error as Error, {
      userId,
      exchangeAccountId,
      requestAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * C3b venue sync — persist the per-account balance snapshot (best-effort,
 * same contract as positions). Rows the venue could not name are dropped
 * rather than stored under a bogus asset key.
 */
async function persistBalanceSnapshot(
  exchangeAccountId: string,
  balances: KodiakBalance[],
  userId: string,
  requestAccountId?: string
): Promise<void> {
  try {
    const rows: BalanceSnapshot[] = balances
      .filter(
        b =>
          typeof b?.asset === "string" &&
          b.asset.trim() !== "" &&
          b.asset !== "UNKNOWN"
      )
      .map(b => ({
        asset: b.asset,
        holding: num(b.free),
        frozen: num(b.locked),
      }));
    await exchangeSnapshotAdapter.replaceBalances(exchangeAccountId, rows);
  } catch (error) {
    logger.error("Failed to persist balance snapshot", error as Error, {
      userId,
      exchangeAccountId,
      requestAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const privateDataMethods = {
  /**
   * Get Kodiak positions for a user.
   *
   * C3b: optional `exchangeAccountId` pins one owned, ACTIVE kodiak account
   * (default = the user's first ACTIVE kodiak account, unchanged legacy
   * behaviour). The cache key carries the id so two accounts of the same
   * user can never serve each other's rows.
   */
  async getPositions(
    this: KodiakIntegrationService,
    userId: string,
    exchangeAccountId?: string
  ): Promise<KodiakApiResponse<KodiakPosition[]>> {
    try {
      const cacheKey = `positions:${userId}${
        exchangeAccountId ? `:${exchangeAccountId}` : ""
      }`;

      // Check cache first
      const cached = kodiakCache.get(cacheKey);
      if (cached) {
        externalTrafficObserver.recordKodiakCacheHit("positions", userId);
        logger.debug("Returning cached Kodiak positions", {
          userId,
          exchangeAccountId,
        });
        // Ensure cached data matches KodiakApiResponse interface
        if (cached && typeof cached === "object" && "success" in cached) {
          return cached as KodiakApiResponse<KodiakPosition[]>;
        } else {
          logger.warn(
            "Cached Kodiak positions data has invalid structure, clearing cache",
            { userId, exchangeAccountId }
          );
          kodiakCache.delete(cacheKey);
        }
      } else {
        externalTrafficObserver.recordKodiakCacheMiss("positions", userId);
      }

      // Get account + credentials (C3b: account-scoped resolution)
      const resolved = await this.resolveKodiakAccount(
        userId,
        exchangeAccountId
      );
      if (!resolved) {
        return {
          success: false,
          error: "No verified Kodiak credentials found",
        };
      }
      const credentials = resolved.credentials;

      // Make API request
      const positionsData = await this.makeKodiakRequest<KodiakPosition[]>(
        "GET",
        "/positions",
        credentials
      );
      externalTrafficObserver.recordKodiakRequest("positions", userId);

      const result: KodiakApiResponse<KodiakPosition[]> = {
        success: true,
        data: positionsData,
      };

      // Cache the result (30 seconds for positions)
      kodiakCache.set(cacheKey, result);

      // C3b venue sync: persist the per-account snapshot (best-effort — a
      // snapshot failure must not fail the read that triggered it).
      if (Array.isArray(positionsData)) {
        await persistPositionSnapshot(
          resolved.id,
          positionsData,
          userId,
          exchangeAccountId
        );
      }

      logger.debug("Kodiak positions retrieved and cached", {
        userId,
        exchangeAccountId: resolved.id,
        positionsCount: Array.isArray(positionsData) ? positionsData.length : 0,
      });

      return result;
    } catch (error) {
      logger.error("Get Kodiak positions error", error as Error, {
        userId,
        exchangeAccountId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: "Failed to get Kodiak positions",
      };
    }
  },

  /**
   * Get Kodiak trade history for a user.
   *
   * C3b: optional `exchangeAccountId` pins the account (default = legacy
   * first-ACTIVE behaviour); the cache key carries the id.
   */
  async getTrades(
    this: KodiakIntegrationService,
    userId: string,
    limit: number = 50,
    exchangeAccountId?: string
  ): Promise<KodiakApiResponse<KodiakTrade[]>> {
    try {
      const cacheKey = `trades:${userId}:${limit}${
        exchangeAccountId ? `:${exchangeAccountId}` : ""
      }`;

      // Check cache first
      const cached = kodiakCache.get(cacheKey);
      if (cached) {
        externalTrafficObserver.recordKodiakCacheHit("trades", userId);
        logger.debug("Returning cached Kodiak trades", {
          userId,
          limit,
          exchangeAccountId,
        });
        // Ensure cached data matches KodiakApiResponse interface
        if (cached && typeof cached === "object" && "success" in cached) {
          return cached as KodiakApiResponse<KodiakTrade[]>;
        } else {
          logger.warn(
            "Cached Kodiak trades data has invalid structure, clearing cache",
            { userId, limit, exchangeAccountId }
          );
          kodiakCache.delete(cacheKey);
        }
      } else {
        externalTrafficObserver.recordKodiakCacheMiss("trades", userId);
      }

      // Get account + credentials (C3b: account-scoped resolution)
      const resolved = await this.resolveKodiakAccount(
        userId,
        exchangeAccountId
      );
      if (!resolved) {
        return {
          success: false,
          error: "No verified Kodiak credentials found",
        };
      }
      const credentials = resolved.credentials;

      // Make API request
      const tradesData = await this.makeKodiakRequest<KodiakTrade[]>(
        "GET",
        `/position_history?limit=${limit}`,
        credentials
      );
      externalTrafficObserver.recordKodiakRequest("trades", userId);

      const result: KodiakApiResponse<KodiakTrade[]> = {
        success: true,
        data: tradesData,
      };

      // Cache the result (30 seconds for trades)
      kodiakCache.set(cacheKey, result);

      logger.debug("Kodiak trades retrieved and cached", {
        userId,
        limit,
        exchangeAccountId: resolved.id,
        tradesCount: Array.isArray(tradesData) ? tradesData.length : 0,
      });

      return result;
    } catch (error) {
      logger.error("Get Kodiak trades error", error as Error, {
        userId,
        exchangeAccountId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: "Failed to get Kodiak trades",
      };
    }
  },

  /**
   * Get Kodiak account balance for a user.
   *
   * C3b: optional `exchangeAccountId` pins the account (default = legacy
   * first-ACTIVE behaviour); the Redis cache key carries the id.
   */
  async getBalance(
    this: KodiakIntegrationService,
    userId: string,
    exchangeAccountId?: string
  ): Promise<KodiakApiResponse<KodiakAccountInfo>> {
    try {
      const cacheKey = `kodiak:balance:${userId}${
        exchangeAccountId ? `:${exchangeAccountId}` : ""
      }`;

      // Check cache first
      const cacheResult = await redisService.get(cacheKey);
      if (cacheResult.success && cacheResult.data) {
        externalTrafficObserver.recordKodiakCacheHit("balance", userId);
        logger.debug("Returning cached Kodiak balance", {
          userId,
          exchangeAccountId,
        });
        return JSON.parse(cacheResult.data);
      } else {
        externalTrafficObserver.recordKodiakCacheMiss("balance", userId);
      }

      // Get account + credentials (C3b: account-scoped resolution)
      const resolved = await this.resolveKodiakAccount(
        userId,
        exchangeAccountId
      );
      if (!resolved) {
        return {
          success: false,
          error: "No verified Kodiak credentials found",
        };
      }
      const credentials = resolved.credentials;

      // Get account holdings
      const holdingsData = await this.makeKodiakRequest<
        KodiakHoldingsResponse | KodiakHolding[]
      >("GET", "/client/holding?all=true", credentials);

      // Get account info
      const accountInfoData =
        await this.makeKodiakRequest<KodiakApiAccountInfoResponse>(
          "GET",
          "/client/info",
          credentials
        );
      externalTrafficObserver.recordKodiakRequest("balance", userId);

      const holdings = Array.isArray(holdingsData)
        ? holdingsData
        : holdingsData?.holding || [];

      // Calculate total balance
      const totalBalance = holdings.reduce(
        (sum: number, holding: Record<string, unknown>) => {
          const balanceStr =
            (holding as Record<string, unknown>).balance?.toString() || "0";
          const priceStr =
            (holding as Record<string, unknown>).price?.toString() || "0";

          const balance = parseFloat(balanceStr);
          const price = parseFloat(priceStr);

          return sum + balance * price;
        },
        0
      );

      const balances: KodiakBalance[] = holdings.map(
        (holding: KodiakHolding) => ({
          asset: holding.holding || holding.balance || "UNKNOWN",
          free: holding.balance || "0",
          locked: "0",
          freeze: "0",
          withdrawing: "0",
          ipoable: "0",
          btcValuation: "0",
        })
      );

      const accountInfo: KodiakAccountInfo = {
        totalBalance: totalBalance.toString(),
        totalPnl24H: accountInfoData?.total_pnl_24_h || "0",
        totalPnl30D: accountInfoData?.total_pnl_30_d || "0",
        totalPnlAll: accountInfoData?.total_pnl_all || "0",
        tradingVolume24H: accountInfoData?.trading_volume_last_24_hours || "0",
        accountType: accountInfoData?.account_type || "UNKNOWN",
        balances,
      };

      const result: KodiakApiResponse<KodiakAccountInfo> = {
        success: true,
        data: accountInfo,
      };

      // Cache the result
      await redisService.setex(
        cacheKey,
        this.CACHE_TTL,
        JSON.stringify(result)
      );

      // C3b venue sync: persist the per-account snapshot (best-effort).
      await persistBalanceSnapshot(
        resolved.id,
        balances,
        userId,
        exchangeAccountId
      );

      logger.debug("Kodiak balance retrieved and cached", {
        userId,
        exchangeAccountId: resolved.id,
        totalBalance: accountInfo.totalBalance,
        holdingsCount: holdings.length,
      });

      return result;
    } catch (error) {
      logger.error("Get Kodiak balance error", error as Error, {
        userId,
        exchangeAccountId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: "Failed to get Kodiak balance",
      };
    }
  },

  /**
   * Get Kodiak account information (authenticated).
   *
   * C3b: optional `exchangeAccountId` pins the account (default = legacy
   * first-ACTIVE behaviour); the Redis cache key carries the id.
   */
  async getAccountInfo(
    this: KodiakIntegrationService,
    userId: string,
    exchangeAccountId?: string
  ): Promise<KodiakApiResponse<KodiakAccountInfo>> {
    try {
      const cacheKey = `kodiak:account:${userId}${
        exchangeAccountId ? `:${exchangeAccountId}` : ""
      }`;

      // Check cache first
      const cacheResult = await redisService.get(cacheKey);
      if (cacheResult.success && cacheResult.data) {
        externalTrafficObserver.recordKodiakCacheHit("account-info", userId);
        logger.debug("Returning cached Kodiak account info", {
          userId,
          exchangeAccountId,
        });
        return JSON.parse(cacheResult.data);
      } else {
        externalTrafficObserver.recordKodiakCacheMiss("account-info", userId);
      }

      // Get account + credentials (C3b: account-scoped resolution)
      const resolved = await this.resolveKodiakAccount(
        userId,
        exchangeAccountId
      );
      if (!resolved) {
        return {
          success: false,
          error: "No verified Kodiak credentials found",
        };
      }
      const credentials = resolved.credentials;

      // Make API request
      const accountInfoData = await this.makeKodiakRequest<KodiakAccountInfo>(
        "GET",
        "/client/info",
        credentials
      );
      externalTrafficObserver.recordKodiakRequest("account-info", userId);

      const result: KodiakApiResponse<KodiakAccountInfo> = {
        success: true,
        data: accountInfoData,
      };

      // Cache the result
      await redisService.setex(
        cacheKey,
        this.CACHE_TTL_MEDIUM,
        JSON.stringify(result)
      );

      logger.debug("Kodiak account info retrieved and cached", {
        userId,
        accountType: accountInfoData.accountType,
      });

      return result;
    } catch (error) {
      logger.error("Get Kodiak account info error", error as Error, {
        userId,
        exchangeAccountId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: "Failed to get Kodiak account info",
      };
    }
  },
};
