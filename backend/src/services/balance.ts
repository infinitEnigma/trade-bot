/** @format */

import { query } from '../database/pool';
import { redisService } from './redis';
import logger from './logger';

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
    const cached = await redisService.get(cacheKey);

    if (cached) {
      logger.debug('Balance cache hit', { userId });
      return JSON.parse(cached);
    }

    // ✅ Fetch user's Orderly account ID from kodiak_credentials table
    const userResult = await query(
      'SELECT account_id FROM kodiak_credentials WHERE user_id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found or no Kodiak account connected');
    }

    const orderlyAccountId = userResult.rows[0].account_id;

    if (!orderlyAccountId) {
      throw new Error('User has no Orderly account connected');
    }

    // ✅ Fetch balance from Orderly API
    const balance = await fetchOrderlyBalance(orderlyAccountId);

    // ✅ Cache for 60 seconds
    await redisService.setex(cacheKey, 60, JSON.stringify(balance));

    logger.info('Balance fetched from Orderly', {
      userId,
      totalAssets: balance.totalAssets,
    });

    return balance;
  } catch (error) {
    logger.error('Get balance error', {
      userId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Fetch balance directly from Orderly API
 */
async function fetchOrderlyBalance(
  accountId: string
): Promise<{
  walletBalance: number;
  accountBalance: number;
  availableBalance: number;
  reservedBalance: number;
  totalAssets: number;
  timestamp: string;
}> {
  try {
    // For now, return mock balance data since Orderly API might not be available
    // TODO: Replace with actual Orderly API call when available
    console.warn('Using mock balance data - Orderly API integration pending');

    return {
      walletBalance: 1250.75,
      accountBalance: 8750.25,
      availableBalance: 6250.50,
      reservedBalance: 2500.00,
      totalAssets: 10000.00,
      timestamp: new Date().toISOString(),
    };

    /* TODO: Uncomment when Orderly API is available
    const response = await fetch(
      `https://api-testnet.orderly.org/v1/account/${accountId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Orderly API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // ✅ Transform Orderly response to standard format
    return {
      walletBalance: parseFloat(data.walletBalance || 0),
      accountBalance: parseFloat(data.accountBalance || 0),
      availableBalance: parseFloat(data.availableBalance || 0),
      reservedBalance: parseFloat(data.reservedBalance || 0),
      totalAssets: parseFloat(data.totalAssets || 0),
      timestamp: new Date().toISOString(),
    };
    */
  } catch (error) {
    logger.error('Orderly balance fetch failed', {
      accountId,
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
  await redisService.del(cacheKey);
  logger.info('Balance cache invalidated', { userId });
}
