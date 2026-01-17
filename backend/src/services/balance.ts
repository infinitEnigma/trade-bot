/** @format */

import { query } from "../database/pool";
import { redisService } from "./redis";
import logger from "./logger";
import { generateKodiakSignature } from "../utils/orderly-signature"; // ✅ Import backend crypto utility
import { credentialCacheService } from "./credential-cache";

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
 * Fetch balance directly from Orderly API
 */
async function fetchOrderlyBalance(userId: string): Promise<{
  walletBalance: number;
  accountBalance: number;
  availableBalance: number;
  reservedBalance: number;
  totalAssets: number;
  timestamp: string;
}> {
  let accountId = "unknown"; // For error logging

  try {
    // Get Kodiak credentials for authentication and use cached decrypted keys
    const credsResult = await query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (credsResult.rows.length === 0) {
      logger.error("No Kodiak credentials found for user", { userId });
      throw new Error("Kodiak credentials not found");
    }

    const row = credsResult.rows[0];
    if (!row.verified) {
      logger.error("Kodiak credentials found but not verified", {
        row,
        userId,
      });
      throw new Error("Kodiak credentials not verified");
    }

    const accountId = row.account_id;

    logger.info("Fetching balance from Orderly API", {
      userId,
      accountId,
      endpoint: `https://api.orderly.org/v1/client/info`,
    });

    // ✅ Use cached decrypted credentials instead of decrypting every time
    const { apiKey, secretKey } =
      await credentialCacheService.getOrCacheCredentials(
        userId,
        row.api_key_encrypted,
        row.secret_key_encrypted,
        accountId
      );

    logger.info("Using cached Kodiak credentials for balance fetch", {
      userId,
      accountId,
      apiKeyPrefix: apiKey.substring(0, 8) + "...",
      secretKeyPrefix: secretKey.substring(0, 8) + "...",
      verified: row.verified,
    });

    const timestamp = Date.now();
    const path = "/v1/client/info";
    const signature = await generateKodiakSignature(
      timestamp,
      "GET",
      path,
      "",
      secretKey
    );

    logger.info("Generated signature for balance request", {
      accountId,
      timestamp,
      path,
      body: "",
      signaturePrefix: signature.substring(0, 16) + "...",
      signatureLength: signature.length,
    });

    const requestHeaders = {
      "orderly-account-id": accountId,
      "orderly-key": apiKey,
      "orderly-signature": signature,
      "orderly-timestamp": timestamp.toString(),
      "Content-Type": "application/json",
    };

    const fullUrl = `https://api.orderly.org${path}`;

    logger.info("Orderly API request details", {
      accountId,
      method: "GET",
      url: fullUrl,
      path,
      headers: {
        "orderly-account-id": accountId,
        "orderly-key": "[REDACTED]",
        "orderly-signature": "[REDACTED]",
        "orderly-timestamp": timestamp.toString(),
        "Content-Type": "application/json",
      },
      timestamp,
      signature: "[REDACTED]",
    });

    let response;
    try {
      response = await fetch(fullUrl, {
        method: "GET",
        headers: requestHeaders,
      });
    } catch (fetchError: any) {
      logger.error("Orderly API fetch error", {
        accountId,
        url: fullUrl,
        error: fetchError.message,
        code: fetchError.code,
        stack: fetchError.stack,
      });
      throw fetchError;
    }

    logger.info("Orderly API response headers", {
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
      logger.error("Failed to read response text", {
        accountId,
        status: response.status,
        error: textError.message,
      });
      throw textError;
    }

    logger.info("Orderly API response body", {
      accountId,
      status: response.status,
      statusText: response.statusText,
      contentLength: responseText.length,
      body: responseText,
    });

    if (!response.ok) {
      logger.error("Orderly API error response complete", {
        accountId,
        status: response.status,
        statusText: response.statusText,
        url: fullUrl,
        requestHeaders: {
          ...requestHeaders,
          "orderly-key": "[REDACTED]",
          "orderly-signature": "[REDACTED]",
        },
        responseBody: responseText,
      });
      throw new Error(
        `Orderly API error: ${response.status} ${response.statusText} - ${responseText}`
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError: any) {
      logger.error("Failed to parse JSON response", {
        accountId,
        status: response.status,
        responseBody: responseText,
        parseError: parseError.message,
      });
      throw parseError;
    }

    logger.info("Orderly API parsed response data", {
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

    logger.info("Balance transformed successfully", {
      accountId,
      result,
    });

    return result;
  } catch (error) {
    logger.error("Orderly balance fetch failed", {
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
  const delResult = await redisService.del(cacheKey);
  if (!delResult.success) {
    logger.warn("Balance cache invalidation failed", {
      userId,
      error: delResult.error,
    });
  }
  // Also invalidate credential cache when balance cache is invalidated
  credentialCacheService.invalidateCredentials(userId);
  logger.info("Balance and credential caches invalidated", {
    userId,
    redisSuccess: delResult.success,
  });
}
