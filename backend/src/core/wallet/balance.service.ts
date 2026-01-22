/** @format */

import { redisService } from "../../infrastructure";
import { logger } from "../../core/logging";
import { kodiakIntegrationService } from "../../infrastructure/external/kodiak-integration.service";

// Export interfaces and service for wallet index
export interface WalletBalance {
  total: number;
  available: number;
  locked: number;
  currency: string;
}

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'trade';
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: Date;
}

export const balanceService = {
  getUserBalance,
  invalidateBalanceCache,
};

/**
 * Fetch user's account balance from Orderly
 * Cached for 60 seconds to reduce API calls
 */
export async function getUserBalance(userId: string): Promise<{
  walletBalance: number;
  accountBalance: number;
  availableBalance: number;
  reservedBalance: number;
  totalAssets: number;
  timestamp: string;
}> {
  try {
    // ✅ Check Redis cache first (60 second TTL)
    const cacheKey = `balance:${userId}`;
    const cacheResult = await redisService.get(cacheKey);

    if (cacheResult.success && cacheResult.data) {
      logger.debug("Balance cache hit", { userId });
      return JSON.parse(cacheResult.data);
    } else if (!cacheResult.success) {
      logger.warn("Balance cache read failed, falling back to API", {
        userId,
        error: cacheResult.error,
      });
    }

    // ✅ Fetch balance from Orderly API (fetchOrderlyBalance now gets account ID internally)
    const balance = await fetchOrderlyBalance(userId);

    // ✅ Cache for 60 seconds
    const cacheWriteResult = await redisService.setex(
      cacheKey,
      60,
      JSON.stringify(balance)
    );
    if (!cacheWriteResult.success) {
      logger.warn("Balance cache write failed", {
        userId,
        error: cacheWriteResult.error,
      });
    }

    logger.info("Balance fetched and cached", {
      userId,
      walletBalance: balance.walletBalance,
      accountBalance: balance.accountBalance,
      totalAssets: balance.totalAssets,
      cacheSuccess: cacheWriteResult.success,
    });

    return balance;
  } catch (error) {
    logger.error("Get balance error", {
      userId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Fetch balance from Kodiak integration service
 */
async function fetchOrderlyBalance(userId: string): Promise<{
  walletBalance: number;
  accountBalance: number;
  availableBalance: number;
  reservedBalance: number;
  totalAssets: number;
  timestamp: string;
}> {
  try {
    logger.debug("Fetching balance via Kodiak integration service", { userId });

    // Use the Kodiak integration service
    const balanceResult = await kodiakIntegrationService.getBalance(userId);

    if (!balanceResult.success) {
      logger.error("Kodiak balance fetch failed", {
        userId,
        error: balanceResult.error,
      });
      throw new Error(balanceResult.error || "Failed to fetch balance from Kodiak");
    }

    const balanceData = balanceResult.data;
    if (!balanceData) {
      throw new Error("No balance data returned from Kodiak");
    }

    // Transform Kodiak response to expected format
    const result = {
      walletBalance: parseFloat(balanceData.totalBalance || "0"),
      accountBalance: parseFloat(balanceData.totalBalance || "0"),
      availableBalance: parseFloat(balanceData.totalBalance || "0"), // Kodiak doesn't distinguish
      reservedBalance: 0, // Not provided by Kodiak
      totalAssets: parseFloat(balanceData.totalBalance || "0"),
      timestamp: new Date().toISOString(),
    };

    logger.info("Balance fetched successfully via Kodiak service", {
      userId,
      totalBalance: result.totalAssets,
    });

    return result;
  } catch (error) {
    logger.error("Kodiak balance fetch failed", {
      userId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Invalidate balance cache (call when user deposits/withdraws)
 */
export async function invalidateBalanceCache(userId: string): Promise<void> {
  const cacheKey = `balance:${userId}`;
  const delResult = await redisService.del(cacheKey);
  if (!delResult.success) {
    logger.warn("Balance cache invalidation failed", {
      userId,
      error: delResult.error,
    });
  }
  // Also invalidate Kodiak cache when balance cache is invalidated
  kodiakIntegrationService.invalidateUserCache(userId);
  logger.info("Balance and Kodiak caches invalidated", {
    userId,
    redisSuccess: delResult.success,
  });
}
