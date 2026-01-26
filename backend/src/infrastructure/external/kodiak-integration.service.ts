/**
 * Kodiak Integration Service
 *
 * Handles Kodiak API integration including authentication, request/response handling,
 * caching, and API utilities. Provides centralized Kodiak exchange operations.
 */

import { query } from "../../database/pool";
import { redisService } from "../cache/redis.service";
import { encryptionService } from "../security/encryption.service";
import { kodiakCache } from "./kodiak-cache";
import logger from "../../core/logging/logger.service";

export interface KodiakCredentials {
    accountId: string;
    apiKey: string;
    secretKey: string;
}

export interface KodiakApiResponse<T = unknown> {
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

export interface KodiakApiAccountInfoResponse {
    total_pnl_24_h?: string;
    total_pnl_30_d?: string;
    total_pnl_all?: string;
    trading_volume_last_24_hours?: string;
    account_type?: string;
}

export interface KodiakPublicAccountInfo {
    address?: string;
    account_id?: string;
    [key: string]: unknown; // Allow for additional properties from API
}

export interface KodiakHolding {
    holding?: string;
    balance?: string;
    price?: string;
    [key: string]: unknown; // Allow for additional properties from API
}

export interface KodiakHoldingsResponse {
    holding?: KodiakHolding[];
    balance?: KodiakHolding[];
    [key: string]: unknown; // Allow for additional properties from API
}

/**
 * Kodiak Integration Service
 */
export class KodiakIntegrationService {
    private readonly CACHE_TTL = 300; // ⬆️ 5 minutes for volatile data (was 5 seconds)
    private readonly CACHE_TTL_MEDIUM = 600; // ⬆️ 10 minutes for semi-volatile data (was 30 seconds)

    /**
     * Get decrypted Kodiak credentials for a user
     */
    async getUserCredentials(userId: string): Promise<KodiakCredentials | null> {
        try {
            const result = await query<{
                account_id: string;
                api_key_encrypted: string;
                secret_key_encrypted: string;
                verified: boolean;
            }>(
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
            const cacheKey = `positions:${userId}`;

            // Check cache first
            const cached = kodiakCache.get(cacheKey);
            if (cached) {
                logger.debug("Returning cached Kodiak positions", { userId });
                // Ensure cached data matches KodiakApiResponse interface
                if (cached && typeof cached === 'object' && 'success' in cached) {
                    return cached as KodiakApiResponse<KodiakPosition[]>;
                } else {
                    logger.warn("Cached Kodiak positions data has invalid structure, clearing cache", { userId });
                    kodiakCache.delete(cacheKey);
                }
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
            ) as KodiakPosition[];

            const result: KodiakApiResponse<KodiakPosition[]> = {
                success: true,
                data: positionsData,
            };

            // Cache the result (30 seconds for positions)
            kodiakCache.set(cacheKey, result);

            logger.debug("Kodiak positions retrieved and cached", {
                userId,
                positionsCount: Array.isArray(positionsData) ? positionsData.length : 0,
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
            const cacheKey = `trades:${userId}:${limit}`;

            // Check cache first
            const cached = kodiakCache.get(cacheKey);
            if (cached) {
                logger.debug("Returning cached Kodiak trades", { userId, limit });
                // Ensure cached data matches KodiakApiResponse interface
                if (cached && typeof cached === 'object' && 'success' in cached) {
                    return cached as KodiakApiResponse<KodiakTrade[]>;
                } else {
                    logger.warn("Cached Kodiak trades data has invalid structure, clearing cache", { userId, limit });
                    kodiakCache.delete(cacheKey);
                }
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
            ) as KodiakTrade[];

            const result: KodiakApiResponse<KodiakTrade[]> = {
                success: true,
                data: tradesData,
            };

            // Cache the result (30 seconds for trades)
            kodiakCache.set(cacheKey, result);

            logger.debug("Kodiak trades retrieved and cached", {
                userId,
                limit,
                tradesCount: Array.isArray(tradesData) ? tradesData.length : 0,
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
            ) as KodiakHoldingsResponse | KodiakHolding[];

            // Get account info
            const accountInfoData = await this.makeKodiakRequest(
                "GET",
                "/client/info",
                credentials
            ) as KodiakApiAccountInfoResponse;

            const holdings = Array.isArray(holdingsData)
                ? holdingsData
                : holdingsData?.holding || [];

            // Calculate total balance
            const totalBalance = holdings.reduce((sum: number, holding: Record<string, unknown>) => {
                const holdingBalance = parseFloat((holding as Record<string, unknown>).holding?.toString() || (holding as Record<string, unknown>).balance?.toString() || "0");
                const price = parseFloat((holding as Record<string, unknown>).price?.toString() || "0");
                return sum + holdingBalance * price;
            }, 0);

            // Map KodiakHolding to KodiakBalance for the account info
            const balances: KodiakBalance[] = holdings.map((holding: KodiakHolding) => ({
                asset: holding.holding || holding.balance || 'UNKNOWN',
                free: holding.balance || '0',
                locked: '0',
                freeze: '0',
                withdrawing: '0',
                ipoable: '0',
                btcValuation: '0',
            }));

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
    async getAccountInfo(userId: string): Promise<KodiakApiResponse<KodiakAccountInfo>> {
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
            ) as KodiakAccountInfo;

            const result: KodiakApiResponse<KodiakAccountInfo> = {
                success: true,
                data: accountInfoData,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.CACHE_TTL_MEDIUM, JSON.stringify(result));

            logger.debug("Kodiak account info retrieved and cached", {
                userId,
                accountType: accountInfoData.accountType,
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
    async getPublicAccountInfo(accountId: string, credentials?: KodiakCredentials): Promise<KodiakApiResponse<KodiakPublicAccountInfo>> {
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

                    // Handle different response formats with proper type checking
                    let responseData: KodiakPublicAccountInfo = {};
                    if (accountInfoData && typeof accountInfoData === 'object') {
                        const typedData = accountInfoData as Record<string, unknown>;
                        if ('data' in typedData && typeof typedData.data === 'object') {
                            responseData = typedData.data as KodiakPublicAccountInfo;
                        } else {
                            responseData = accountInfoData as KodiakPublicAccountInfo;
                        }
                    }

                    const result: KodiakApiResponse<KodiakPublicAccountInfo> = {
                        success: true,
                        data: responseData,
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

            const responseData = await response.json();

            // Validate response structure
            if (!responseData || typeof responseData !== 'object') {
                throw new Error("Invalid API response structure");
            }

            // Extract data safely with proper type checking
            let accountData: KodiakPublicAccountInfo = {};
            const typedResponse = responseData as Record<string, unknown>;
            if ('data' in typedResponse && typeof typedResponse.data === 'object') {
                accountData = typedResponse.data as KodiakPublicAccountInfo;
            } else if (typeof typedResponse === 'object') {
                accountData = typedResponse as KodiakPublicAccountInfo;
            } else {
                throw new Error("Invalid account data structure");
            }

            const result: KodiakApiResponse<KodiakPublicAccountInfo> = {
                success: true,
                data: accountData,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.CACHE_TTL_MEDIUM, JSON.stringify(result));

            logger.debug("Kodiak account info retrieved and cached (public)", {
                accountId,
                address: accountData?.address,
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
            // Clear all cache entries for this user
            const clearedEntries = kodiakCache.clearUserCache(userId);

            logger.info("Kodiak cache invalidated for user", {
                userId,
                entriesCleared: clearedEntries,
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
        body?: unknown
    ): Promise<unknown> {
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

            // Set hash function - using type assertions for third-party library
            const ed25519Lib = ed25519 as unknown as {
                hashes?: { sha512?: (message: Uint8Array) => Uint8Array };
                etc?: { sha512Sync?: (message: Uint8Array) => Uint8Array };
                utils?: { sha512Sync?: (message: Uint8Array) => Uint8Array };
                sign?: (message: Uint8Array, privateKey: Uint8Array) => Uint8Array | Promise<Uint8Array>;
            };

            if (ed25519Lib.hashes) {
                ed25519Lib.hashes.sha512 = sha512Hash;
            } else if (ed25519Lib.etc && typeof ed25519Lib.etc?.sha512Sync !== "undefined") {
                ed25519Lib.etc.sha512Sync = sha512Hash;
            } else if (ed25519Lib.utils) {
                ed25519Lib.utils.sha512Sync = sha512Hash;
            }

            const privateKey = bs58.decode(secretKey);
            const messageBytes = new TextEncoder().encode(message);
            const signature = ed25519Lib.sign?.(messageBytes, privateKey) || Promise.resolve(new Uint8Array());
            const signatureResult = await (signature instanceof Promise ? signature : Promise.resolve(signature));

            return Buffer.from(signatureResult).toString("base64url");
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