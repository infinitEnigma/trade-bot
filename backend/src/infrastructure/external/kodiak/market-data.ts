/**
 * Public (unauthenticated) market-data methods for the Kodiak integration.
 *
 * Ticker/orderbook/TradingView endpoints go through the shared
 * `fetchPublicKodiak` pipeline (single implementation of the former
 * copy-pasted cache → fetch → extract → cache flow; URLs, cache keys, TTLs
 * and result shapes preserved). `getPublicAccountInfo` keeps its bespoke
 * authenticated-first/public-fallback body verbatim.
 *
 * Methods are mounted onto the `KodiakIntegrationService` prototype by the
 * facade, so instance-level patching in tests keeps working.
 */

import { redisService } from "../../cache/redis.service";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
// Type-only import: the bags are mounted onto the facade's prototype.
import type { KodiakIntegrationService } from "../kodiak-integration.service";
import { fetchPublicKodiak, unwrapDataOrRaw } from "./public-fetch";
import type {
    KodiakApiResponse,
    KodiakCredentials,
    KodiakMarketTicker,
    KodiakOrderbook,
    KodiakPublicAccountInfo,
    KodiakTradingViewConfig,
    KodiakTradingViewHistory,
    KodiakTradingViewSymbols,
} from "./types";

export const marketDataMethods = {
    /**
     * Get market ticker data from Kodiak API
     */
  async getMarketTicker(
    this: KodiakIntegrationService,
    symbol: string = "PERP_BTC_USDC"
  ): Promise<KodiakApiResponse<KodiakMarketTicker>> {
        return fetchPublicKodiak<KodiakMarketTicker>({
            path: `/v1/public/futures/${symbol}`,
            cacheKey: `kodiak:ticker:${symbol}`,
            ttlSeconds: 30,
      extract: responseData =>
        (responseData as { data?: { rows?: KodiakMarketTicker[] } }).data
          ?.rows?.[0] ||
                (responseData as { data?: KodiakMarketTicker }).data ||
                (responseData as KodiakMarketTicker),
            cacheHitLog: "Returning cached Kodiak ticker data",
            successLog: "Kodiak ticker data retrieved and cached",
            errorLog: "Get Kodiak ticker error",
            errorMessage: "Failed to get Kodiak ticker data",
            logContext: { symbol },
        });
    },

    /**
     * Get orderbook data from Kodiak API
     */
  async getOrderbook(
    this: KodiakIntegrationService,
    symbol: string = "PERP_BTC_USDC"
  ): Promise<KodiakApiResponse<KodiakOrderbook>> {
        return fetchPublicKodiak<KodiakOrderbook>({
            path: `/v1/public/orderbook?symbol=${symbol}`,
            cacheKey: `kodiak:orderbook:${symbol}`,
            ttlSeconds: 60,
            extract: unwrapDataOrRaw,
            cacheHitLog: "Returning cached Kodiak orderbook data",
            successLog: "Kodiak orderbook data retrieved and cached",
            errorLog: "Get Kodiak orderbook error",
            errorMessage: "Failed to get Kodiak orderbook data",
            logContext: { symbol },
        });
    },

    /**
     * Get TradingView configuration from Kodiak API
     */
  async getTradingViewConfig(
    this: KodiakIntegrationService
  ): Promise<KodiakApiResponse<KodiakTradingViewConfig>> {
        return fetchPublicKodiak<KodiakTradingViewConfig>({
            path: `/v1/tv/config`,
            cacheKey: `kodiak:tv:config`,
            ttlSeconds: 3600,
            extract: unwrapDataOrRaw,
            cacheHitLog: "Returning cached Kodiak TradingView config",
            successLog: "Kodiak TradingView config retrieved and cached",
            errorLog: "Get Kodiak TradingView config error",
            errorMessage: "Failed to get Kodiak TradingView config",
        });
    },

    /**
     * Get TradingView symbols from Kodiak API
     */
  async getTradingViewSymbols(
    this: KodiakIntegrationService,
    symbol: string = "PERP_BTC_USDC"
  ): Promise<KodiakApiResponse<KodiakTradingViewSymbols>> {
        return fetchPublicKodiak<KodiakTradingViewSymbols>({
            path: `/v1/tv/symbols?symbol=${symbol}`,
            cacheKey: `kodiak:tv:symbols:${symbol}`,
            ttlSeconds: 3600,
            extract: unwrapDataOrRaw,
            cacheHitLog: "Returning cached Kodiak TradingView symbols",
            successLog: "Kodiak TradingView symbols retrieved and cached",
            errorLog: "Get Kodiak TradingView symbols error",
            errorMessage: "Failed to get Kodiak TradingView symbols",
            logContext: { symbol },
        });
    },

    /**
     * Get TradingView history data from Kodiak API
     */
    async getTradingViewHistory(
        this: KodiakIntegrationService,
        symbol: string,
        resolution: string,
        from: number,
        to: number
    ): Promise<KodiakApiResponse<KodiakTradingViewHistory>> {
        // Create cache key with rounded timestamps for better cache hit rate
        const roundTo5Minutes = (timestamp: number) => {
            return Math.floor(timestamp / 300) * 300; // 300 seconds = 5 minutes
        };

        const fromRounded = roundTo5Minutes(from);
        const toRounded = roundTo5Minutes(to);

        return fetchPublicKodiak<KodiakTradingViewHistory>({
            path: `/v1/tv/history?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`,
            cacheKey: `kodiak:tv:history:${symbol}:${resolution}:${fromRounded}:${toRounded}`,
            ttlSeconds: 300,
            extract: unwrapDataOrRaw,
            cacheHitLog: "Returning cached Kodiak TradingView history",
            successLog: "Kodiak TradingView history retrieved and cached",
            errorLog: "Get Kodiak TradingView history error",
            errorMessage: "Failed to get Kodiak TradingView history",
            logContext: { symbol, resolution },
        });
    },

    /**
     * Get Kodiak account information (authenticated - for wallet address)
     * Note: This endpoint may require authentication now
     */
    async getPublicAccountInfo(
        this: KodiakIntegrationService,
        accountId: string,
        credentials?: KodiakCredentials
    ): Promise<KodiakApiResponse<KodiakPublicAccountInfo>> {
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
                    const accountInfoData = await this.makeKodiakRequest<unknown>(
                        "GET",
                        `/v1/public/account?account_id=${encodeURIComponent(accountId)}`,
                        credentials
                    );

                    // Handle different response formats with proper type checking
                    let responseData: KodiakPublicAccountInfo = {};
          if (accountInfoData && typeof accountInfoData === "object") {
                        const typedData = accountInfoData as Record<string, unknown>;
            if ("data" in typedData && typeof typedData.data === "object") {
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
          await redisService.setex(
            cacheKey,
            this.CACHE_TTL_MEDIUM,
            JSON.stringify(result)
          );

          logger.debug(
            "Kodiak account info retrieved and cached (authenticated)",
            {
                        accountId,
                        address: result.data?.address,
            }
          );

                    return result;
                } catch (authError) {
          logger.error(
            "Authenticated request failed, trying public request",
            authError as Error,
            {
                        accountId,
            }
          );
                }
            }

            // Fallback to public request
            const requestUrl = `${baseUrl}/v1/public/account?account_id=${encodeURIComponent(accountId)}`;

            logger.debug("Making Kodiak public account API request", {
                url: requestUrl,
                accountId,
                baseUrl,
            });

      const response = await fetch(
        requestUrl,
        this.createFetchOptions({
                headers: {
            Accept: "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; TradeBot/1.0)",
                },
        })
      );

            logger.debug("Kodiak public account API response received", {
                status: response.status,
                statusText: response.statusText,
                url: requestUrl,
                accountId,
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error("Kodiak public account API error response", undefined, {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText,
                });
        throw new Error(
          `Kodiak API error: ${response.status} ${response.statusText} - ${errorText}`
        );
            }

            const responseData = await response.json();

            // Validate response structure
      if (!responseData || typeof responseData !== "object") {
                throw new Error("Invalid API response structure");
            }

            // Extract data safely with proper type checking
            let accountData: KodiakPublicAccountInfo = {};
            const typedResponse = responseData as Record<string, unknown>;
      if ("data" in typedResponse && typeof typedResponse.data === "object") {
                accountData = typedResponse.data as KodiakPublicAccountInfo;
      } else if (typeof typedResponse === "object") {
                accountData = typedResponse as KodiakPublicAccountInfo;
            } else {
                throw new Error("Invalid account data structure");
            }

            const result: KodiakApiResponse<KodiakPublicAccountInfo> = {
                success: true,
                data: accountData,
            };

            // Cache the result
      await redisService.setex(
        cacheKey,
        this.CACHE_TTL_MEDIUM,
        JSON.stringify(result)
      );

            logger.debug("Kodiak account info retrieved and cached (public)", {
                accountId,
                address: accountData?.address,
            });

            return result;
        } catch (error) {
            logger.error("Get Kodiak account info error", error as Error, {
                accountId,
            });

            return {
                success: false,
                error: "Failed to get Kodiak account info",
            };
        }
    },
};
