/**
 * Kodiak Integration Service
 *
 * Handles Kodiak API integration including authentication, request/response handling,
 * caching, and API utilities. Provides centralized Kodiak exchange operations.
 */

import { query } from "../../database/pool";
import { redisService } from "../cache/redis.service";
import { encryptionService } from "../security/encryption.service";
import logger from "../../core/logging/logger.service";

export interface KodiakCredentials {
    accountId: string;
    apiKey: string;
    secretKey: string;
}

export interface KodiakApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface KodiakPosition {
    symbol: string;
    positionAmt: string;
    entryPrice: string;
    markPrice: string;
    pnl: string;
    rowTime: string;
}

export interface KodiakTrade {
    symbol: string;
    id: string;
    orderId: string;
    side: string;
    price: string;
    qty: string;
    realizedPnl: string;
    marginAsset: string;
    quoteQty: string;
    commission: string;
    commissionAsset: string;
    time: number;
    positionSide: string;
    buyer: boolean;
    maker: boolean;
}

export interface KodiakBalance {
    asset: string;
    free: string;
    locked: string;
    freeze: string;
    withdrawing: string;
    ipoable: string;
    btcValuation: string;
}

export interface KodiakAccountInfo {
    totalBalance: string;
    totalPnl24H: string;
    totalPnl30D: string;
    totalPnlAll: string;
    tradingVolume24H: string;
    accountType: string;
    balances: KodiakBalance[];
}

/**
 * Kodiak Integration Service
 */
export class KodiakIntegrationService {
    private readonly CACHE_TTL = 5; // 5 seconds for volatile data
    private readonly CACHE_TTL_MEDIUM = 30; // 30 seconds for semi-volatile data

    /**
     * Get decrypted Kodiak credentials for a user
     */
    async getUserCredentials(userId: string): Promise<KodiakCredentials | null> {
        try {
            const result = await query(
                "SELECT account_id, api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0];

            // Try to decrypt with regular method first (for newly encrypted data)
            let apiKey: string;
            let secretKey: string;

            try {
                apiKey = encryptionService.decryptApiKey(row.api_key_encrypted);
                secretKey = encryptionService.decryptSecretKey(row.secret_key_encrypted);
            } catch (error) {
                logger.warn("Failed to decrypt Kodiak credentials with regular method, trying versioned", {
                    userId,
                    error: error instanceof Error ? error.message : String(error),
                });

                // Try versioned decryption (for older data)
                try {
                    apiKey = await encryptionService.decryptWithVersion(row.api_key_encrypted);
                    secretKey = await encryptionService.decryptWithVersion(row.secret_key_encrypted);
                } catch (versionError) {
                    logger.warn("Failed to decrypt with versioned method, assuming plain text", {
                        userId,
                        error: versionError instanceof Error ? versionError.message : String(versionError),
                    });

                    // Assume plain text (for backward compatibility)
                    apiKey = row.api_key_encrypted;
                    secretKey = row.secret_key_encrypted;
                }
            }

            return {
                accountId: row.account_id,
                apiKey,
                secretKey,
            };
        } catch (error) {
            logger.error("Failed to get Kodiak credentials", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Get Kodiak positions for a user
     */
    async getPositions(userId: string): Promise<KodiakApiResponse<KodiakPosition[]>> {
        try {
            const cacheKey = `kodiak:positions:${userId}`;

            // Check cache first
            const cacheResult = await redisService.get(cacheKey);
            if (cacheResult.success && cacheResult.data) {
                logger.debug("Returning cached Kodiak positions", { userId });
                return JSON.parse(cacheResult.data);
            }

            // Get credentials
            const credentials = await this.getUserCredentials(userId);
            if (!credentials) {
                return {
                    success: false,
                    error: "No verified Kodiak credentials found",
                };
            }

            // Make API request
            const positionsData = await this.makeKodiakRequest(
                "GET",
                "/positions",
                credentials
            );

            const result: KodiakApiResponse<KodiakPosition[]> = {
                success: true,
                data: positionsData,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

            logger.debug("Kodiak positions retrieved and cached", {
                userId,
                positionsCount: positionsData?.rows?.length || 0,
            });

            return result;
        } catch (error) {
            logger.error("Get Kodiak positions error", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                error: "Failed to get Kodiak positions",
            };
        }
    }

    /**
     * Get Kodiak trade history for a user
     */
    async getTrades(userId: string, limit: number = 50): Promise<KodiakApiResponse<KodiakTrade[]>> {
        try {
            const cacheKey = `kodiak:trades:${userId}:${limit}`;

            // Check cache first
            const cacheResult = await redisService.get(cacheKey);
            if (cacheResult.success && cacheResult.data) {
                logger.debug("Returning cached Kodiak trades", { userId, limit });
                return JSON.parse(cacheResult.data);
            }

            // Get credentials
            const credentials = await this.getUserCredentials(userId);
            if (!credentials) {
                return {
                    success: false,
                    error: "No verified Kodiak credentials found",
                };
            }

            // Make API request
            const tradesData = await this.makeKodiakRequest(
                "GET",
                `/position_history?limit=${limit}`,
                credentials
            );

            const result: KodiakApiResponse<KodiakTrade[]> = {
                success: true,
                data: tradesData,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

            logger.debug("Kodiak trades retrieved and cached", {
                userId,
                limit,
                tradesCount: tradesData?.rows?.length || 0,
            });

            return result;
        } catch (error) {
            logger.error("Get Kodiak trades error", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                error: "Failed to get Kodiak trades",
            };
        }
    }

    /**
     * Get Kodiak account balance for a user
     */
    async getBalance(userId: string): Promise<KodiakApiResponse<KodiakAccountInfo>> {
        try {
            const cacheKey = `kodiak:balance:${userId}`;

            // Check cache first
            const cacheResult = await redisService.get(cacheKey);
            if (cacheResult.success && cacheResult.data) {
                logger.debug("Returning cached Kodiak balance", { userId });
                return JSON.parse(cacheResult.data);
            }

            // Get credentials
            const credentials = await this.getUserCredentials(userId);
            if (!credentials) {
                return {
                    success: false,
                    error: "No verified Kodiak credentials found",
                };
            }

            // Get account holdings
            const holdingsData = await this.makeKodiakRequest(
                "GET",
                "/client/holding?all=true",
                credentials
            );

            // Get account info
            const accountInfoData = await this.makeKodiakRequest(
                "GET",
                "/client/info",
                credentials
            );

            const holdings = Array.isArray(holdingsData)
                ? holdingsData
                : holdingsData?.holding || [];

            // Calculate total balance
            const totalBalance = holdings.reduce((sum: number, holding: any) => {
                const holdingBalance = parseFloat(holding.holding || holding.balance || "0");
                const price = parseFloat(holding.price || "0");
                return sum + holdingBalance * price;
            }, 0);

            const accountInfo: KodiakAccountInfo = {
                totalBalance: totalBalance.toString(),
                totalPnl24H: accountInfoData?.total_pnl_24_h || "0",
                totalPnl30D: accountInfoData?.total_pnl_30_d || "0",
                totalPnlAll: accountInfoData?.total_pnl_all || "0",
                tradingVolume24H: accountInfoData?.trading_volume_last_24_hours || "0",
                accountType: accountInfoData?.account_type || "UNKNOWN",
                balances: holdings,
            };

            const result: KodiakApiResponse<KodiakAccountInfo> = {
                success: true,
                data: accountInfo,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

            logger.debug("Kodiak balance retrieved and cached", {
                userId,
                totalBalance: accountInfo.totalBalance,
                holdingsCount: holdings.length,
            });

            return result;
        } catch (error) {
            logger.error("Get Kodiak balance error", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                error: "Failed to get Kodiak balance",
            };
        }
    }

    /**
     * Get Kodiak account information (authenticated)
     */
    async getAccountInfo(userId: string): Promise<KodiakApiResponse<any>> {
        try {
            const cacheKey = `kodiak:account:${userId}`;

            // Check cache first
            const cacheResult = await redisService.get(cacheKey);
            if (cacheResult.success && cacheResult.data) {
                logger.debug("Returning cached Kodiak account info", { userId });
                return JSON.parse(cacheResult.data);
            }

            // Get credentials
            const credentials = await this.getUserCredentials(userId);
            if (!credentials) {
                return {
                    success: false,
                    error: "No verified Kodiak credentials found",
                };
            }

            // Make API request
            const accountInfoData = await this.makeKodiakRequest(
                "GET",
                "/client/info",
                credentials
            );

            const result: KodiakApiResponse = {
                success: true,
                data: accountInfoData,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.CACHE_TTL_MEDIUM, JSON.stringify(result));

            logger.debug("Kodiak account info retrieved and cached", {
                userId,
                accountType: accountInfoData?.account_type,
            });

            return result;
        } catch (error) {
            logger.error("Get Kodiak account info error", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                error: "Failed to get Kodiak account info",
            };
        }
    }

    /**
     * Get Kodiak account information (authenticated - for wallet address)
     * Note: This endpoint may require authentication now
     */
    async getPublicAccountInfo(accountId: string, credentials?: KodiakCredentials): Promise<KodiakApiResponse<any>> {
        try {
            const cacheKey = `kodiak:public_account:${accountId}`;

            // Check cache first
            const cacheResult = await redisService.get(cacheKey);
            if (cacheResult.success && cacheResult.data) {
                logger.debug("Returning cached Kodiak account info", { accountId });
                return JSON.parse(cacheResult.data);
            }

            // Make API request (may require authentication now)
            const baseUrl = process.env.KODIAK_API_URL || "https://api.orderly.org";

            if (credentials) {
                // Try authenticated request first
                try {
                    const accountInfoData = await this.makeKodiakRequest(
                        "GET",
                        `/v1/public/account?account_id=${encodeURIComponent(accountId)}`,
                        credentials
                    );

                    const result: KodiakApiResponse = {
                        success: true,
                        data: accountInfoData.data || accountInfoData, // Handle different response formats
                    };

                    // Cache the result
                    await redisService.setex(cacheKey, this.CACHE_TTL_MEDIUM, JSON.stringify(result));

                    logger.debug("Kodiak account info retrieved and cached (authenticated)", {
                        accountId,
                        address: result.data?.address,
                    });

                    return result;
                } catch (authError) {
                    logger.warn("Authenticated request failed, trying public request", {
                        accountId,
                        error: authError instanceof Error ? authError.message : String(authError),
                    });
                }
            }

            // Fallback to public request
            const requestUrl = `${baseUrl}/v1/public/account?account_id=${encodeURIComponent(accountId)}`;

            logger.debug("Making Kodiak public account API request", {
                url: requestUrl,
                accountId,
                baseUrl,
            });

            const response = await fetch(requestUrl, {
                method: "GET",
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; TradeBot/1.0)",
                },
            });

            logger.debug("Kodiak public account API response received", {
                status: response.status,
                statusText: response.statusText,
                url: requestUrl,
                accountId,
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error("Kodiak public account API error response", {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText,
                });
                throw new Error(`Kodiak API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const responseData = await response.json() as { success: boolean; data: any; timestamp: number };

            const result: KodiakApiResponse = {
                success: true,
                data: responseData.data, // The actual data is in responseData.data
            };

            // Cache the result
            await redisService.setex(cacheKey, this.CACHE_TTL_MEDIUM, JSON.stringify(result));

            logger.debug("Kodiak account info retrieved and cached (public)", {
                accountId,
                address: responseData.data?.address,
            });

            return result;
        } catch (error) {
            logger.error("Get Kodiak account info error", {
                accountId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                error: "Failed to get Kodiak account info",
            };
        }
    }

    /**
     * Clear cached data for a user (useful after trades or updates)
     */
    async invalidateUserCache(userId: string): Promise<void> {
        try {
            const cacheKeys = [
                `kodiak:positions:${userId}`,
                `kodiak:trades:${userId}:*`,
                `kodiak:balance:${userId}`,
                `kodiak:account:${userId}`,
            ];

            // Note: In a real Redis implementation, we'd use SCAN or KEYS to delete patterns
            // For now, we'll clear specific known keys
            for (const key of cacheKeys) {
                if (!key.includes('*')) {
                    await redisService.del(key);
                }
            }

            logger.debug("Kodiak cache invalidated for user", {
                userId,
                keysCleared: cacheKeys.length,
            });
        } catch (error) {
            logger.warn("Failed to invalidate Kodiak cache", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Make authenticated Kodiak API request
     */
    private async makeKodiakRequest(
        method: string,
        path: string,
        credentials: KodiakCredentials,
        body?: any
    ): Promise<any> {
        try {
            const signaturePath = path.startsWith("/v1/") ? path : `/v1${path}`;
            const timestamp = Date.now();
            const bodyStr = body ? JSON.stringify(body) : "";
            const message = `${timestamp}${method.toUpperCase()}${signaturePath}${bodyStr}`;

            // Generate signature
            const signature = await this.generateKodiakSignature(message, credentials.secretKey);

            const baseUrl = process.env.KODIAK_API_URL || "https://api.orderly.org";

            const headers: Record<string, string> = {
                "Content-Type": method === "GET" ? "application/x-www-form-urlencoded" : "application/json",
                "orderly-account-id": credentials.accountId,
                "orderly-key": credentials.apiKey,
                "orderly-signature": signature,
                "orderly-timestamp": timestamp.toString(),
            };

            logger.debug("Making Kodiak API request", {
                method,
                path: signaturePath,
                accountId: credentials.accountId,
            });

            const requestOptions: RequestInit = {
                method: method.toUpperCase(),
                headers,
            };

            if (method.toUpperCase() !== "GET" && bodyStr) {
                requestOptions.body = bodyStr;
            }

            const response = await fetch(`${baseUrl}${signaturePath}`, requestOptions);

            logger.debug("Kodiak API response received", {
                status: response.status,
                statusText: response.statusText,
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error("Kodiak API error response", {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText,
                });
                throw new Error(`Kodiak API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const responseData = await response.json();
            return responseData;
        } catch (error) {
            logger.error("Kodiak API request failed", {
                method,
                path,
                accountId: credentials.accountId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Generate Kodiak API signature using Ed25519
     */
    private async generateKodiakSignature(message: string, secretKey: string): Promise<string> {
        try {
            // Configure @noble/ed25519 hash functions BEFORE any usage
            const { createHash } = await import("crypto");
            const { default: bs58 } = await import("bs58");
            const ed25519 = await import("@noble/ed25519");

            const sha512Hash = (message: Uint8Array) => {
                const hash = createHash("sha512");
                hash.update(message);
                return new Uint8Array(hash.digest());
            };

            // Set hash function
            if ((ed25519 as any).hashes) {
                (ed25519 as any).hashes.sha512 = sha512Hash;
            } else if ((ed25519 as any).etc && typeof (ed25519 as any).etc.sha512Sync !== "undefined") {
                (ed25519 as any).etc.sha512Sync = sha512Hash;
            } else if ((ed25519 as any).utils) {
                (ed25519 as any).utils.sha512Sync = sha512Hash;
            }

            const privateKey = bs58.decode(secretKey);
            const messageBytes = new TextEncoder().encode(message);
            const signature = await ed25519.sign(messageBytes, privateKey);

            return Buffer.from(signature).toString("base64url");
        } catch (error) {
            logger.error("Failed to generate Kodiak signature", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Test Kodiak API connectivity
     */
    async testConnectivity(credentials: KodiakCredentials): Promise<{ success: boolean; error?: string }> {
        try {
            // If this call succeeds without throwing, credentials are valid
            await this.makeKodiakRequest("GET", "/client/info", credentials);

            logger.info("Kodiak API connectivity test successful", {
                accountId: credentials.accountId,
            });
            return { success: true };

        } catch (error) {
            logger.warn("Kodiak API connectivity test error", {
                accountId: credentials.accountId,
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : "Connection failed"
            };
        }
    }
}

// Export singleton instance
export const kodiakIntegrationService = new KodiakIntegrationService();
