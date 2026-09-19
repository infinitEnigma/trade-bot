/** GET /api/market/klines — public kline data derived from TV history. */
import { Router, Request, Response } from "express";
import { kodiakIntegrationService } from "../../../infrastructure/external/kodiak-integration.service";
import { createErrorResponse, ExternalServiceError } from "@trade-bot/shared";
import { getCorrelationId } from "../../../shared/utils/context";
import { RateLimiters } from "../../../infrastructure/security/rate-limiter.service";
import {
  DEFAULT_SYMBOL,
  errMessage,
  INTERVAL_SECONDS,
  marketLogger,
  RESOLUTION_MAP,
} from "./market-helpers";
import { toKlines } from "./market-cache";

export const klinesRoutes = Router();

klinesRoutes.get(
    "/klines",
    RateLimiters.market,
    async (req: Request, res: Response) => {
        try {
            const { symbol, interval, limit } = req.query;
            const symbolStr = (symbol as string) || DEFAULT_SYMBOL;
            const intervalStr = (interval as string) || "1h";
            const limitNum = parseInt(limit as string) || 500;
            const resolution = RESOLUTION_MAP[intervalStr] || intervalStr;
            const step = INTERVAL_SECONDS[intervalStr] || 3600;
            const to = Math.floor(Date.now() / 1000);
            const from = to - step * limitNum;
            const response = await kodiakIntegrationService.getTradingViewHistory(
                symbolStr,
                resolution,
                from,
                to
            );
            if (!response.success || !response.data || response.data.s !== "ok") {
                res.json({
                    success: true,
                    data: [],
                    timestamp: Date.now(),
                    message: "Kline data temporarily unavailable",
                    source: "kodiak_rest",
                });
                return;
            }
            const klines = toKlines(response.data, limitNum);
            marketLogger.debug("Klines endpoint returning data", {
                symbol: symbolStr,
                interval: intervalStr,
                resolution,
                requestedLimit: limitNum,
                actualCount: klines.length,
            });
            res.json({
                success: true,
                data: klines,
                timestamp: Date.now(),
                source: "kodiak_rest",
            });
        } catch (err: unknown) {
            marketLogger.error("Klines endpoint error", undefined, {
                symbol: req.query.symbol,
                interval: req.query.interval,
                limit: req.query.limit,
                error: errMessage(err),
                operation: "klines_endpoint",
            });
      const externalError = new ExternalServiceError("Kodiak API", {
        service: "Kodiak",
        operation: "get_klines",
      });
      res
        .status(externalError.statusCode)
        .json(createErrorResponse(externalError, getCorrelationId()));
        }
    }
);
