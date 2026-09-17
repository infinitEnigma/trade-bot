/** GET /api/market/orderbook + /futures/:symbol + /markprice/:symbol. */
import { Router, Request, Response } from "express";
import { kodiakIntegrationService } from "../../../infrastructure/external/kodiak-integration.service";
import { RateLimiters } from "../../../infrastructure/security/rate-limiter.service";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth.middleware";
import { DEFAULT_SYMBOL, errMessage, fail, marketLogger, ok } from "./market-helpers";
import { readCache, writeCache } from "./market-cache";

export const futuresRoutes = Router();

futuresRoutes.get("/orderbook", async (req: Request, res: Response) => {
    try {
        const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
        const response = await kodiakIntegrationService.getOrderbook(symbol);
        if (!response.success) {
            return res.status(400).json({
                success: false,
                error: response.error || "Failed to fetch orderbook"
            });
        }
        ok(res, response.data);
    } catch (err: unknown) {
        fail(res, "orderbook_endpoint", "Failed to fetch orderbook", {
            error: errMessage(err),
        });
    }
});

futuresRoutes.get(
    "/futures/:symbol",
    RateLimiters.kodiakApi, // STRICT: 10 req/sec to match API limits
    RateLimiters.market,    // PERMISSIVE: 10,000 req/min for users
    async (req: Request, res: Response) => {
        try {
            const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
            const cacheKey = `futures:${symbol}`;
            const cached = await readCache<Record<string, unknown>>(cacheKey, { symbol });
            if (cached) {
                marketLogger.debug("Futures data cache hit", { symbol });
                return res.json(cached);
            }
            marketLogger.debug("Futures data cache miss, fetching from Kodiak", { symbol });
            const response = await kodiakIntegrationService.getMarketTicker(symbol);
            if (!response.success) {
                marketLogger.warn("Market futures(ticker) API failed", {
                    symbol,
                    error: response.error,
                });
                return res.status(503).json({
                    success: false,
                    error: "Market data temporarily unavailable. Please try again later.",
                    symbol,
                    timestamp: Date.now(),
                    retryAfter: 30,
                });
            }
            const result = {
                success: true,
                data: response.data || { symbol },
                timestamp: Date.now(),
                cached: false,
            };
            // 10 minutes to reduce API calls (was using MARKET_FUTURES config)
            await writeCache(cacheKey, 600, result);
            res.json(result);
        } catch (err: unknown) {
            marketLogger.error("Futures endpoint error", err instanceof Error ? err : undefined, {
                symbol: req.params.symbol,
                status: (err as { response?: { status?: number } }).response?.status,
                operation: "futures_endpoint",
            });
            // Return cached data if available, even if stale
            const stale = await readCache<Record<string, unknown>>(`futures:${req.params.symbol}`, {
                symbol: req.params.symbol,
            });
            if (stale) {
                marketLogger.debug("Returning stale futures data due to API error", {
                    symbol: req.params.symbol,
                });
                stale.stale = true;
                return res.json(stale);
            }
            res.status(500).json({
                success: false,
                error: "Failed to fetch futures data",
            });
        }
    }
);

futuresRoutes.get(
    "/markprice/:symbol",
    RateLimiters.market,
    RateLimiters.kodiakApi,
    authMiddleware,
    async (req: Request, res: Response) => {
        try {
            const { symbol } = req.params;
            const symbolStr = symbol as string;
            const response = await kodiakIntegrationService.getMarketTicker(symbolStr);
            if (response.success && response.data) {
                const markPrice = parseFloat(
                    (response.data as { mark_price?: string | number }).mark_price?.toString() || "0"
                );
                if (markPrice > 0) {
                    ok(res, {
                        symbol: symbolStr,
                        price: markPrice.toString(),
                        timestamp: Date.now(),
                    }, { cached: true });
                    marketLogger.debug("Mark price served from Kodiak", {
                        symbol,
                        price: markPrice,
                    });
                    return;
                }
            }
            res.json({
                success: true,
                data: null,
                timestamp: Date.now(),
                message: "Mark price data temporarily unavailable",
            });
            marketLogger.debug("Mark price requested but no data available", {
                symbol,
            });
        } catch (err: unknown) {
            fail(res, "markprice_endpoint", "Failed to fetch mark price data", {
                symbol: req.params.symbol,
                error: errMessage(err),
            });
        }
    }
);

export const orderbookRoutes = futuresRoutes;
