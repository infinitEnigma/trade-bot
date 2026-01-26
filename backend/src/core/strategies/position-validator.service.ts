/** @format */

import axios from "axios";
import { query } from "../../database/pool";
import { logger } from "../logging";
import { generateOrderlySignature } from "../../shared/utils/orderly-signature";
//import { withCredentials, SecureCredentials } from "../../infrastructure/security/encryption.service";
import { positionSyncService, PositionData } from "./position-sync.service"; // ✅ Single source of truth
import { redisService } from "../../infrastructure";

export interface AccountLimits {
  balance: number;
  maxLeverage: number;
  totalExposure: number;
  maxNotional: Record<string, number>;
  takerFeeRate: number;
  makerFeeRate: number;
}

export interface PositionValidationResult {
  isValid: boolean;
  reason?: string;
  maxAllowed?: number;
  recommended?: number;
}

/**
 * Get account limits and current exposure from Orderly API
 */
export async function getAccountLimits(
  orderlyAccountId: string,
  orderlyApiKey: string,
  orderlySecretKey: string
): Promise<AccountLimits> {
  try {
    const timestamp = Date.now();
    const path = "/v1/client/info";
    const signature = await generateOrderlySignature(
      timestamp,
      "GET",
      path,
      "",
      orderlySecretKey
    );

    // Get account info
    const accountResponse = await axios.get(
      `${process.env.KODIAK_API_URL || "https://api.orderly.org"}${path}`,
      {
        headers: {
          "orderly-account-id": orderlyAccountId,
          "orderly-key": orderlyApiKey,
          "orderly-signature": signature,
          "orderly-timestamp": timestamp.toString(),
        },
      }
    );

    const accountData = accountResponse.data.data;
    logger.info("Account info retrieved", {
      maxLeverage: accountData.max_leverage,
      takerFee: accountData.taker_fee_rate,
      makerFee: accountData.maker_fee_rate,
    });

    // Get current positions for exposure calculation
    const positionsPath = "/v1/positions";
    const positionsSignature = await generateOrderlySignature(
      timestamp,
      "GET",
      positionsPath,
      "",
      orderlySecretKey
    );

    const positionsResponse = await axios.get(
      `${process.env.KODIAK_API_URL || "https://api.orderly.org"}${positionsPath}`,
      {
        headers: {
          "orderly-account-id": orderlyAccountId,
          "orderly-key": orderlyApiKey,
          "orderly-signature": positionsSignature,
          "orderly-timestamp": timestamp.toString(),
        },
      }
    );

    // Calculate total exposure from positions
    let totalExposure = 0;
    const positions = positionsResponse.data.data?.rows || [];
    for (const position of positions) {
      const notionalValue = Math.abs(
        parseFloat(position.position_qty || 0) *
        parseFloat(position.mark_price || 0)
      );
      totalExposure += notionalValue;
    }

    logger.info("Current exposure calculated", {
      totalExposure,
      positionsCount: positions.length,
    });

    return {
      balance: parseFloat(accountData.total_balance || "0"),
      maxLeverage: parseInt(accountData.max_leverage || "1"),
      totalExposure,
      maxNotional: accountData.max_notional || {},
      takerFeeRate: parseFloat(accountData.taker_fee_rate || "0.001"),
      makerFeeRate: parseFloat(accountData.maker_fee_rate || "0.001"),
    };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("Failed to get account limits", {
      error: err.message,
      orderlyAccountId,
    });
    throw new Error(`Account validation failed: ${err.message}`);
  }
}

/**
 * Validate position size against account limits and risk parameters
 */
export async function validatePositionSize(
  notionalAmount: number,
  symbol: string,
  accountLimits: AccountLimits,
  maxExposurePercent: number = 0.8,
  maxSinglePositionPercent: number = 0.25
): Promise<PositionValidationResult> {
  logger.debug("Validating position size", {
    notionalAmount,
    symbol,
    accountLimits: {
      balance: accountLimits.balance,
      maxLeverage: accountLimits.maxLeverage,
      totalExposure: accountLimits.totalExposure,
    },
  });

  // Check 1: Minimum position size
  const MIN_NOTIONAL = 10; // $10 minimum
  if (notionalAmount < MIN_NOTIONAL) {
    return {
      isValid: false,
      reason: `Position too small. Minimum: $${MIN_NOTIONAL}`,
      maxAllowed: MIN_NOTIONAL,
    };
  }

  // Check 2: Maximum position size (single position limit)
  const maxSinglePosition = accountLimits.balance * maxSinglePositionPercent;
  if (notionalAmount > maxSinglePosition) {
    return {
      isValid: false,
      reason: `Position exceeds single position limit (${maxSinglePositionPercent * 100}% of account)`,
      maxAllowed: maxSinglePosition,
      recommended: maxSinglePosition * 0.5,
    };
  }

  // Check 3: Orderly max_notional limit for this symbol
  if (symbol in accountLimits.maxNotional) {
    const maxNotional = accountLimits.maxNotional[symbol];
    if (notionalAmount > maxNotional) {
      return {
        isValid: false,
        reason: `Position exceeds Orderly max notional limit for ${symbol}: $${maxNotional}`,
        maxAllowed: maxNotional,
        recommended: Math.min(maxNotional * 0.8, maxSinglePosition),
      };
    }
  }

  // Check 4: Account leverage limit
  const maxAccountExposure = accountLimits.balance * accountLimits.maxLeverage;
  if (notionalAmount > maxAccountExposure) {
    return {
      isValid: false,
      reason: `Position exceeds account leverage limit: $${maxAccountExposure}`,
      maxAllowed: maxAccountExposure,
      recommended: maxAccountExposure * 0.7,
    };
  }

  // Check 5: Total exposure limit
  const maxTotalExposure = accountLimits.balance * maxExposurePercent;
  const newTotalExposure = accountLimits.totalExposure + notionalAmount;

  if (newTotalExposure > maxTotalExposure) {
    const remainingExposure = maxTotalExposure - accountLimits.totalExposure;
    return {
      isValid: false,
      reason: `Total exposure would exceed ${maxExposurePercent * 100}% of account balance`,
      maxAllowed: remainingExposure,
      recommended: remainingExposure * 0.8,
    };
  }

  // Check 6: Margin requirements (simplified)
  const requiredMargin = notionalAmount / accountLimits.maxLeverage;
  if (requiredMargin > accountLimits.balance * 0.9) {
    return {
      isValid: false,
      reason: `Insufficient margin. Required: $${requiredMargin.toFixed(2)}`,
      maxAllowed: accountLimits.balance * 0.9 * accountLimits.maxLeverage,
    };
  }

  logger.debug("Position validation passed", {
    notionalAmount,
    maxAllowed: Math.min(maxSinglePosition, maxAccountExposure),
  });

  return {
    isValid: true,
    maxAllowed: Math.min(
      maxSinglePosition,
      maxAccountExposure,
      maxTotalExposure - accountLimits.totalExposure
    ),
  };
}

/**
 * Check if user has verified Kodiak credentials (without decrypting)
 * Use this when you only need to check credential existence
 */
export async function hasUserKodiakCredentials(userId: string): Promise<boolean> {
  try {
    const result = await query(
      "SELECT id FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
      [userId]
    );
    return result.rows.length > 0;
  } catch (error) {
    logger.error("Failed to check user Kodiak credentials", {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
    return false;
  }
}

/**
 * ===========================================
 * 🔍 VALIDATE USER POSITION - SINGLE SOURCE OF TRUTH
 * ===========================================
 *
 * Validates position size against account limits using canonical database source.
 * Eliminates competing data sources by using synced position data as single truth.
 *
 * DATA FLOW (CORRECTED):
 * 1. Position Sync: Kodiak API → Database (canonical source)
 * 2. Position Validator: Database → Account Limits Calculation
 * 3. Risk Assessment: Account Limits → Position Validation
 *
 * ELIMINATES COMPETING SOURCES:
 * ❌ Before: Kodiak API, Database, Bot State (3 sources)
 * ✅ After: Database (1 canonical source synced from API)
 *
 * @param userId - User ID for position validation
 * @param notionalAmount - Position size to validate
 * @param symbol - Trading symbol for position
 * @param maxExposurePercent - Maximum account exposure percentage
 * @returns Promise<PositionValidationResult> - Validation result with limits
 */
export async function validateUserPosition(
  userId: string,
  notionalAmount: number,
  symbol: string,
  maxExposurePercent: number = 0.8
): Promise<PositionValidationResult> {
  try {
    // Check if user has credentials first (without decrypting)
    const hasCredentials = await hasUserKodiakCredentials(userId);
    if (!hasCredentials) {
      return {
        isValid: false,
        reason: "Kodiak credentials not configured or verified",
      };
    }

    // ✅ SINGLE SOURCE OF TRUTH: Get positions from canonical database
    // (synced from Kodiak API by position-sync service)
    const positions = await positionSyncService.getPositionsFromDatabase(userId);

    // Calculate account limits from canonical position data
    const accountLimits = await calculateAccountLimitsFromDatabase(userId, positions);

    // Validate position size against calculated limits
    return await validatePositionSize(
      notionalAmount,
      symbol,
      accountLimits,
      maxExposurePercent
    );

  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("Position validation failed", {
      error: err.message,
      userId,
      notionalAmount,
      symbol,
    });
    return {
      isValid: false,
      reason: `Validation error: ${err.message}`,
    };
  }
}

/**
 * Calculate account limits from canonical database position data
 * Uses synced position data as single source of truth
 */
async function calculateAccountLimitsFromDatabase(
  userId: string,
  positions: PositionData[]
): Promise<AccountLimits> {
  try {
    // Get account information (balance, leverage, etc.)
    const accountInfo = await getAccountInfoFromDatabase(userId);

    // Calculate total exposure from canonical position data
    let totalExposure = 0;
    for (const position of positions) {
      const notionalValue = Math.abs(
        position.positionQty * position.markPrice
      );
      totalExposure += notionalValue;
    }

    logger.debug("Account limits calculated from database", {
      userId,
      positionsCount: positions.length,
      totalExposure,
      balance: accountInfo.balance,
    });

    return {
      balance: accountInfo.balance,
      maxLeverage: accountInfo.maxLeverage,
      totalExposure,
      maxNotional: accountInfo.maxNotional || {},
      takerFeeRate: accountInfo.takerFeeRate,
      makerFeeRate: accountInfo.makerFeeRate,
    };

  } catch (error) {
    logger.error("Failed to calculate account limits from database", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Export singleton instance for the trading index
export const positionValidatorService = {
  validateUserPosition,
  getAccountLimits,
  hasUserKodiakCredentials,
};

/**
 * Get account information from database (synced from Kodiak API)
 */
async function getAccountInfoFromDatabase(userId: string): Promise<{
  balance: number;
  maxLeverage: number;
  maxNotional: Record<string, number>;
  takerFeeRate: number;
  makerFeeRate: number;
}> {
  try {
    // Get cached account info or fetch from database
    const cacheKey = `account:info:${userId}`;
    const cacheResult = await redisService.get(cacheKey);

    if (cacheResult.success && cacheResult.data) {
      const cachedInfo = JSON.parse(cacheResult.data);
      logger.debug("Account info cache hit", { userId });
      return cachedInfo;
    }

    // Fetch account info from database (synced from API)
    const result = await query<{
      balance: string;
      max_leverage: string;
      max_notional: Record<string, number>;
      taker_fee_rate: string;
      maker_fee_rate: string;
      updated_at: string;
    }>(
      "SELECT balance, max_leverage, max_notional, taker_fee_rate, maker_fee_rate, updated_at FROM kodiak_accounts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [userId]
    );

    if (result.rows.length === 0) {
      // Fallback to default values if no account info
      logger.warn("No account info found in database, using defaults", { userId });
      return {
        balance: 0,
        maxLeverage: 1,
        maxNotional: {},
        takerFeeRate: 0.001,
        makerFeeRate: 0.001,
      };
    }

    const accountInfo = {
      balance: parseFloat(result.rows[0].balance || "0"),
      maxLeverage: parseInt(result.rows[0].max_leverage || "1"),
      maxNotional: result.rows[0].max_notional || {},
      takerFeeRate: parseFloat(result.rows[0].taker_fee_rate || "0.001"),
      makerFeeRate: parseFloat(result.rows[0].maker_fee_rate || "0.001"),
    };

    // Cache account info for 5 minutes
    await redisService.setex(cacheKey, 300, JSON.stringify(accountInfo));

    logger.debug("Account info retrieved from database", { userId });
    return accountInfo;

  } catch (error) {
    logger.error("Failed to get account info from database", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
