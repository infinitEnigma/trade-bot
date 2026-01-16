/** @format */

import { query } from '../database/pool';
import { redisService } from './redis';
import logger from './logger';
import { generateKodiakSignature } from '../utils/orderly-signature'; // ✅ Import backend crypto utility

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

    logger.info('Balance fetched and cached', {
      userId,
      orderlyAccountId,
      walletBalance: balance.walletBalance,
      accountBalance: balance.accountBalance,
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
    logger.info('Fetching balance from Orderly API', {
      accountId,
      endpoint: `https://api.orderly.org/v1/client/info`,
    });

    // Get Kodiak credentials for authentication
    const credsResult = await query(
      'SELECT api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE account_id = $1',
      [accountId]
    );

    if (credsResult.rows.length === 0) {
      logger.error('No Kodiak credentials found for account', { accountId });
      throw new Error('Kodiak credentials not found');
    }

    const row = credsResult.rows[0];
    if (!row.verified) {
      logger.error('Kodiak credentials found but not verified', { row });
      throw new Error('Kodiak credentials not verified');
    }

    const apiKey = require('../services/encryption').encryptionService.decryptApiKey(
      row.api_key_encrypted
    );
    const secretKey = require('../services/encryption').encryptionService.decryptSecretKey(
      row.secret_key_encrypted
    );

    logger.info('Using Kodiak credentials for balance fetch', {
      accountId,
      apiKeyPrefix: apiKey.substring(0, 8) + '...',
      secretKeyPrefix: secretKey.substring(0, 8) + '...',
      verified: row.verified
    });

    const timestamp = Date.now();
    const path = '/v1/client/info';
    const signature = await generateKodiakSignature(timestamp, 'GET', path, '', secretKey);

    logger.info('Generated signature for balance request', {
      accountId,
      timestamp,
      path,
      body: '',
      signaturePrefix: signature.substring(0, 16) + '...',
      signatureLength: signature.length
    });

    const requestHeaders = {
      'orderly-account-id': accountId,
      'orderly-key': apiKey,
      'orderly-signature': signature,
      'orderly-timestamp': timestamp.toString(),
      'Content-Type': 'application/json',
    };

    const fullUrl = `https://api.orderly.org${path}`;

    logger.info('Orderly API request details', {
      accountId,
      method: 'GET',
      url: fullUrl,
      path,
      headers: {
        'orderly-account-id': accountId,
        'orderly-key': '[REDACTED]',
        'orderly-signature': '[REDACTED]',
        'orderly-timestamp': timestamp.toString(),
        'Content-Type': 'application/json',
      },
      timestamp,
      signature: '[REDACTED]',
    });

    let response;
    try {
      response = await fetch(fullUrl, {
        method: 'GET',
        headers: requestHeaders,
      });
    } catch (fetchError: any) {
      logger.error('Orderly API fetch error', {
        accountId,
        url: fullUrl,
        error: fetchError.message,
        code: fetchError.code,
        stack: fetchError.stack,
      });
      throw fetchError;
    }

    logger.info('Orderly API response headers', {
      accountId,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      url: fullUrl,
    });

    let responseText: string;
    try {
      responseText = await response.text();
    } catch (textError: any) {
      logger.error('Failed to read response text', {
        accountId,
        status: response.status,
        error: textError.message,
      });
      throw textError;
    }

    logger.info('Orderly API response body', {
      accountId,
      status: response.status,
      statusText: response.statusText,
      contentLength: responseText.length,
      body: responseText,
    });

    if (!response.ok) {
      logger.error('Orderly API error response complete', {
        accountId,
        status: response.status,
        statusText: response.statusText,
        url: fullUrl,
        requestHeaders: { ...requestHeaders, 'orderly-key': '[REDACTED]', 'orderly-signature': '[REDACTED]' },
        responseBody: responseText,
      });
      throw new Error(`Orderly API error: ${response.status} ${response.statusText} - ${responseText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError: any) {
      logger.error('Failed to parse JSON response', {
        accountId,
        status: response.status,
        responseBody: responseText,
        parseError: parseError.message,
      });
      throw parseError;
    }

    logger.info('Orderly API parsed response data', {
      accountId,
      dataKeys: Object.keys(data),
      data: data,
    });

    // ✅ Transform Orderly response to standard format
    const result = {
      walletBalance: parseFloat(data.wallet_balance || 0),
      accountBalance: parseFloat(data.account_balance || 0),
      availableBalance: parseFloat(data.available_balance || 0),
      reservedBalance: parseFloat(data.reserved_balance || 0),
      totalAssets: parseFloat(data.total_balance || 0),
      timestamp: new Date().toISOString(),
    };

    logger.info('Balance transformed successfully', {
      accountId,
      result,
    });

    return result;
  } catch (error) {
    logger.error('Orderly balance fetch failed', {
      accountId,
      error: (error as Error).message,
      stack: (error as Error).stack,
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
