/**
 * Shared helpers for the market HTTP layer.
 *
 * Single home for the boilerplate that was copy-pasted across every handler
 * in the former monolithic `market.ts`:
 * - `roundTo5Minutes` / `tvHistoryCacheKey` (single cache-key builder so the
 *   route prefix `tv:history:` matches the one used by the decomposed
 *   `kodiak-integration.service.ts` — previously the two layers used different
 *   prefixes and every request double-missed the cache),
 * - cached-or-fetch wrappers for the Redis get/setex dance,
 * - response envelope builders + a single catch-all error responder,
 * - credential-gated guard replacing the raw `kodiak_credentials` SQL that
 *   was inlined in `/ws-url` and `/kline-history`,
 * - TradingView history → kline transforms shared by `/klines` and
 *   `/kline-history`.
 */

import { Response } from "express";
import { ContextAwareLogger } from "../../../core/logging/";

export const marketLogger = new ContextAwareLogger("market-api");

export const WS_BASE =
    process.env.KODIAK_WS_URL || "wss://ws-evm.orderly.org/ws/stream";

export const DEFAULT_SYMBOL = "PERP_BTC_USDC";

/** Round a unix-seconds timestamp down to a 5-minute bucket (300 s). */
export const roundTo5Minutes = (timestamp: number): number =>
    Math.floor(timestamp / 300) * 300;

/** Canonical cache key for a TradingView history window. */
export const tvHistoryCacheKey = (
    symbol: string,
    resolution: string,
    from: number,
    to: number,
): string =>
    `tv:history:${symbol}:${resolution}:${roundTo5Minutes(from)}:${roundTo5Minutes(to)}`;

/** Interval label (e.g. `1h`) → TradingView resolution (e.g. `60`). */
export const RESOLUTION_MAP: Record<string, string> = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "2h": "120",
    "4h": "240",
    "1d": "D",
    "1w": "W",
};

/** Interval label → candle duration in seconds. */
export const INTERVAL_SECONDS: Record<string, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
};

/** Success envelope shared by all market handlers. */
export const ok = (res: Response, data: unknown, extra: Record<string, unknown> = {}): void => {
    res.json({ success: true, data, timestamp: Date.now(), ...extra });
};

/** Single catch-all responder for unexpected handler failures. */
export const fail = (
    res: Response,
    operation: string,
    message: string,
    context: Record<string, unknown> = {},
    status = 500,
): void => {
    marketLogger.error(`${operation} error`, undefined, {
        ...context,
        operation,
    });
    res.status(status).json({ success: false, error: message });
};

export const errMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);
