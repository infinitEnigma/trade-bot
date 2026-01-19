/** @format */

import axios from "axios";
import { query } from "../database/pool";
import logger from "./logger";
import { generateOrderlySignature } from "../utils/orderly-signature";
import { withCredentials, SecureCredentials } from "./encryption"; // ✅ Secure credential handling

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
  } catch (error: any) {
    logger.error("Failed to get account limits", {
      error: error.message,
      orderlyAccountId,
    });
    throw new Error(`Account validation failed: ${error.message}`);
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
 * Validate position for a user using secure credential handling
 * Credentials are automatically decrypted, used, and wiped from memory
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

    // Use secure credential context manager - credentials are auto-cleaned
    return await withCredentials(userId, async (credentials: SecureCredentials) => {
      // Get account limits using decrypted credentials (securely handled)
      const accountLimits = await getAccountLimits(
        credentials.get('accountId'),
        credentials.get('apiKey'),
        credentials.get('secretKey')
      );

      // Validate position size
      return await validatePositionSize(
        notionalAmount,
        symbol,
        accountLimits,
        maxExposurePercent
      );
    });

  } catch (error: any) {
    logger.error("Position validation failed", {
      error: error.message,
      userId,
      notionalAmount,
      symbol,
    });
    return {
      isValid: false,
      reason: `Validation error: ${error.message}`,
    };
  }
}
