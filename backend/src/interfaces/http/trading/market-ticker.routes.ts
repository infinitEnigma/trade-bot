/** GET /api/market/ticker + /tickers — ticker data via the Kodiak service. */
import { Router, Request, Response } from "express";
import {
  kodiakIntegrationService,
  KodiakMarketTicker,
} from "../../../infrastructure/external/kodiak-integration.service";
import { createErrorResponse, ExternalServiceError } from "@trade-bot/shared";
import { getCorrelationId } from "../../../shared/utils/context";
import { RateLimiters } from "../../../infrastructure/security/rate-limiter.service";
import { DEFAULT_SYMBOL, errMessage, marketLogger, ok } from "./market-helpers";

export const tickerRoutes = Router();

tickerRoutes.get(
  "/ticker",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const response = await kodiakIntegrationService.getMarketTicker(symbol);
      if (!response.success) {
        return res.status(503).json({
          success: false,
          error: "Market data temporarily unavailable. Please try again later.",
          symbol,
          timestamp: Date.now(),
          retryAfter: 60,
        });
      }
      const futuresData: KodiakMarketTicker = response.data || { symbol };
      const currentPrice = parseFloat(
        futuresData.mark_price?.toString() || "0"
      );
      const prevClose = parseFloat(futuresData["24h_close"]?.toString() || "0");
      const change24h = currentPrice - prevClose;
      ok(res, {
        symbol: futuresData.symbol || symbol,
        price: currentPrice.toFixed(2),
        change24h: change24h.toFixed(2),
        volume24h: futuresData["24h_volume"]?.toString() || "0",
        high24h: futuresData["24h_high"]?.toString() || "0",
        low24h: futuresData["24h_low"]?.toString() || "0",
        mark_price: futuresData.mark_price?.toString(),
        index_price: futuresData.index_price?.toString(),
        open_interest: futuresData.open_interest?.toString(),
        est_funding_rate: futuresData.est_funding_rate?.toString(),
      });
    } catch (err: unknown) {
      marketLogger.error(
        "Ticker endpoint error",
        err instanceof Error ? err : undefined,
        {
          symbol: req.query.symbol,
          error: errMessage(err),
          operation: "ticker_endpoint",
        }
      );
      // Return clear error so user knows data is unavailable
      res.status(503).json({
        success: false,
        error: "Market data temporarily unavailable. Please try again later.",
        symbol: (req.query.symbol as string) || DEFAULT_SYMBOL,
        timestamp: Date.now(),
        retryAfter: 60,
      });
    }
  }
);

tickerRoutes.get("/tickers", async (req: Request, res: Response) => {
  try {
    const response = await kodiakIntegrationService.getMarketTicker();
    if (!response.success) {
      const externalError = new ExternalServiceError("Kodiak API", {
        service: "Kodiak",
        operation: "fetch_tickers",
      });
      return res
        .status(externalError.statusCode)
        .json(createErrorResponse(externalError, getCorrelationId()));
    }
    ok(res, response.data);
  } catch (err: unknown) {
    const externalError = new ExternalServiceError("Kodiak API", {
      service: "Kodiak",
      operation: "fetch_tickers",
    });
    marketLogger.error(
      "Tickers endpoint error",
      err instanceof Error ? err : undefined,
      {
        error: errMessage(err),
        operation: "tickers_endpoint",
      }
    );
    res
      .status(externalError.statusCode)
      .json(createErrorResponse(externalError, getCorrelationId()));
  }
});
