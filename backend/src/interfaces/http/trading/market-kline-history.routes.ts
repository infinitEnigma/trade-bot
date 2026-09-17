/** GET /api/market/kline-history — gated historical klines (auth + verified creds). */
import { Router, Response } from "express";
import { kodiakIntegrationService } from "../../../infrastructure/external/kodiak-integration.service";
import { AxiosError } from "axios";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth.middleware";
import { DEFAULT_SYMBOL, errMessage, marketLogger } from "./market-helpers";
import { requireVerifiedCredentials, toVerifiedKlines } from "./market-cache";

export const klineHistoryRoutes = Router();

klineHistoryRoutes.get(
    "/kline-history",
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
        const { symbol, resolution, from, to } = req.query;
        const symbolStr = (symbol as string) || DEFAULT_SYMBOL;
        const resolutionStr = (resolution as string) || "60";
        // Request only 7 days of data instead of 30 to avoid "no_data" response
        const fromNum = from
            ? parseInt(from as string)
            : Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60; // 7 days ago
        const toNum = to ? parseInt(to as string) : Math.floor(Date.now() / 1000);
        try {
            // SECURITY: trading features only for connected users
            const gate = await requireVerifiedCredentials(req.user?.userId, res);
            if (!gate) {
                return;
            }
            const userId = req.user?.userId as string;
            marketLogger.debug(
                "Fetching historical kline data with credential verification",
                {
                    userId,
                    symbol: symbolStr,
                    resolution: resolutionStr,
                    from: fromNum,
                    to: toNum,
                    hasVerifiedCredentials: true,
                }
            );
            const response = await kodiakIntegrationService.getTradingViewHistory(symbolStr, resolutionStr, fromNum, toNum);
            if (!response.success) {
                return res.status(400).json({
                    success: false,
                    error: response.error || "Failed to fetch historical kline data"
                });
            }
            marketLogger.debug("Historical kline data response received", {
                responseKeys: Object.keys(response.data || {}),
                dataType: typeof response.data,
                symbol: symbolStr,
            });
            const tvData = response.data!;
            if (typeof tvData !== "object") {
                marketLogger.error("Invalid TradingView response - not an object", undefined, {
                    dataType: typeof tvData,
                    operation: "tv_data_validation",
                });
                return res.status(500).json({
                    success: false,
                    error: "Market data API returned invalid format",
                });
            }
            if (tvData.s === "no_data" || !tvData.t || tvData.t.length === 0) {
                marketLogger.debug("No historical data available for the requested period", {
                    symbol: symbolStr,
                    resolution: resolutionStr,
                    from: fromNum,
                    to: toNum,
                    status: tvData.s,
                });
                return res.json({
                    success: true,
                    data: [],
                    timestamp: Date.now(),
                    meta: {
                        symbol: symbolStr,
                        resolution: resolutionStr,
                        from: fromNum,
                        to: toNum,
                        actualCount: 0,
                        source: "tv_history_with_verification",
                        note: "No historical data available for this time period",
                    },
                });
            }
            let transformedData;
            try {
                transformedData = toVerifiedKlines(tvData, symbolStr, resolutionStr);
            } catch (validationError) {
                return res.status(500).json({
                    success: false,
                    error: errMessage(validationError),
                });
            }
            marketLogger.debug("Successfully transformed TradingView data", {
                symbol: symbolStr,
                candleCount: transformedData.length,
                firstCandle: transformedData[0],
                lastCandle: transformedData[transformedData.length - 1],
            });
            res.json({
                success: true,
                data: transformedData,
                timestamp: Date.now(),
                meta: {
                    symbol: symbolStr,
                    resolution: resolutionStr,
                    from: fromNum,
                    to: toNum,
                    actualCount: transformedData.length,
                    source: "tv_history_with_verification",
                },
            });
        } catch (err: unknown) {
            const axiosError = err as AxiosError;
            marketLogger.error("Historical kline data error", axiosError, {
                userId: req.user?.userId,
                symbol: req.query.symbol,
                status: axiosError.response?.status,
                operation: "historical_kline_endpoint",
            });
            if (axiosError.response?.status === 429) {
                return res.status(429).json({
                    success: false,
                    error: "Rate limit exceeded. Please try again later.",
                    retryAfter: axiosError.response.headers?.["retry-after"] || 10,
                });
            }
            if (axiosError.code === "ECONNABORTED" || axiosError.code === "ENOTFOUND") {
                return res.status(503).json({
                    success: false,
                    error:
                        "Market data service temporarily unavailable. Please try again later.",
                });
            }
            res.status(500).json({
                success: false,
                error: "Failed to fetch historical kline data",
            });
        }
    }
);
