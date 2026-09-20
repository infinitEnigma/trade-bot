/**
 * Redis cache + credential-guard helpers shared by the market route modules.
 * (Companion to `./market-helpers.ts`; split only to stay under edit limits.)
 */

import { Response } from "express";
import { redisService } from "../../../infrastructure/cache/redis.service";
import { kodiakCredentialsRepositoryAdapter } from "../../../infrastructure/adapters/repositories/kodiak-credentials-repository.adapter";
import type { KodiakTradingViewHistory } from "../../../infrastructure/external/kodiak-integration.service";
import { marketLogger } from "./market-helpers";

/**
 * Redis get → JSON.parse helper. Returns the parsed payload on hit, `null` on
 * miss, and warns + returns `null` on read failure (caller falls back to API).
 */
export const readCache = async <T>(
  cacheKey: string,
  debugContext: Record<string, unknown> = {}
): Promise<T | null> => {
  const cacheResult = await redisService.get(cacheKey);
  if (cacheResult.success && cacheResult.data) {
    return JSON.parse(cacheResult.data) as T;
  }
  if (!cacheResult.success) {
    marketLogger.warn("Market cache read failed, falling back to API", {
      cacheKey,
      error: cacheResult.error,
      ...debugContext,
    });
  }
  return null;
};

/** Best-effort Redis setex (failures surface via the caller's error path). */
export const writeCache = async (
  cacheKey: string,
  ttlSeconds: number,
  payload: unknown
): Promise<void> => {
  await redisService.setex(cacheKey, ttlSeconds, JSON.stringify(payload));
};

/**
 * Guard for credential-gated endpoints. Replaces the raw
 * `SELECT ... FROM kodiak_credentials` SQL previously inlined in `/ws-url`
 * and `/kline-history` with the shared repository adapter (single place where
 * the verified-credentials rule lives).
 *
 * Returns `{ accountId }` on success, or sends the 401/403 response and
 * returns `null` when the request must stop.
 */
export const requireVerifiedCredentials = async (
  userId: string | undefined,
  res: Response
): Promise<{ accountId: string | null } | null> => {
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return null;
  }
  const credentials =
    await kodiakCredentialsRepositoryAdapter.getCredentials(userId);
  if (!credentials) {
    res.status(403).json({
      success: false,
      error:
        "Kodiak credentials required. Please connect your trading account.",
    });
    return null;
  }
  return { accountId: credentials.accountId ?? null };
};

export interface KlineCandle {
  startTime: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** `/klines` shape: TradingView column arrays → candle rows (seconds kept). */
export const toKlines = (
  history: KodiakTradingViewHistory,
  limit: number
): KlineCandle[] =>
  history.t
    .map((time, i) => ({
      startTime: time,
      time,
      open: history.o[i],
      high: history.h[i],
      low: history.l[i],
      close: history.c[i],
      volume: history.v[i] ?? 0,
    }))
    .slice(-limit);

export interface VerifiedKlineCandle extends Omit<KlineCandle, "time"> {
  symbol: string;
  type: string;
}

/**
 * `/kline-history` shape: seconds → milliseconds + symbol/type annotations.
 * Returns `[]` for `no_data`; throws with a user-facing message when the
 * payload is structurally unusable (caller maps to 500).
 */
export const toVerifiedKlines = (
  tvData: KodiakTradingViewHistory,
  symbol: string,
  resolution: string
): VerifiedKlineCandle[] => {
  if (tvData.s === "no_data" || !tvData.t || tvData.t.length === 0) {
    return [];
  }
  if (!tvData.t || !tvData.o || !tvData.h || !tvData.l || !tvData.c) {
    marketLogger.error(
      "Missing required OHLC arrays in TradingView response",
      undefined,
      {
        hasTimestamps: !!tvData.t,
        hasOpens: !!tvData.o,
        hasHighs: !!tvData.h,
        hasLows: !!tvData.l,
        hasCloses: !!tvData.c,
        hasVolumes: !!tvData.v,
        operation: "ohlc_validation",
      }
    );
    throw new Error("Market data API returned incomplete OHLC data");
  }
  const length = tvData.t.length;
  if (
    tvData.o.length !== length ||
    tvData.h.length !== length ||
    tvData.l.length !== length ||
    tvData.c.length !== length
  ) {
    marketLogger.error("OHLC arrays have different lengths", undefined, {
      timestamps: tvData.t.length,
      opens: tvData.o.length,
      highs: tvData.h.length,
      lows: tvData.l.length,
      closes: tvData.c.length,
      operation: "array_length_validation",
    });
    throw new Error("Market data API returned inconsistent OHLC data");
  }
  const out: VerifiedKlineCandle[] = [];
  for (let i = 0; i < length; i++) {
    out.push({
      startTime: tvData.t[i] * 1000, // seconds → milliseconds
      open: parseFloat(tvData.o[i].toString()),
      high: parseFloat(tvData.h[i].toString()),
      low: parseFloat(tvData.l[i].toString()),
      close: parseFloat(tvData.c[i].toString()),
      volume: parseFloat((tvData.v?.[i] || 0).toString()),
      symbol,
      type: resolution === "60" ? "1h" : resolution,
    });
  }
  return out;
};
