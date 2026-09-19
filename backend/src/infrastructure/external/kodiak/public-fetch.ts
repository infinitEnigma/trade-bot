/**
 * Shared request pipeline for Kodiak public (unauthenticated) market endpoints.
 *
 * Implements the cache → fetch → validate → extract → cache flow that was
 * previously copy-pasted across getMarketTicker/getOrderbook/getTradingView*
 * in the former monolithic service. URL construction, cache keys, TTLs and
 * result/error shapes are preserved verbatim from the originals.
 */

import { redisService } from "../../cache/redis.service";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
import type { KodiakApiResponse } from "./types";
import {
  createFetchOptions,
  getKodiakBaseUrl,
  getKodiakPublicHeaders,
} from "./fetch-options";

export interface PublicKodiakFetchOptions<T> {
    /** Path beginning with /v1, appended to the configured base URL. */
    path: string;
    /** Redis cache key. */
    cacheKey: string;
    /** Redis TTL in seconds. */
    ttlSeconds: number;
    /** Extract the payload from the raw JSON response (`data || raw` unless overridden). */
    extract: (responseData: unknown) => T;
    /** Debug log message emitted on cache hit. */
    cacheHitLog: string;
    /** Debug log message emitted after a successful fetch + cache write. */
    successLog: string;
    /** Error log message emitted when the fetch fails. */
    errorLog: string;
    /** `error` field of the failure response returned to callers. */
    errorMessage: string;
    /** Structured context for debug/error logs (symbol, resolution, ...). */
    logContext?: Record<string, unknown>;
}

export async function fetchPublicKodiak<T>(
  options: PublicKodiakFetchOptions<T>
): Promise<KodiakApiResponse<T>> {
    const { logContext = {} } = options;
    try {
        const cacheResult = await redisService.get(options.cacheKey);

        if (cacheResult.success && cacheResult.data) {
            logger.debug(options.cacheHitLog, logContext);
            return JSON.parse(cacheResult.data);
        }

    const response = await fetch(
      `${getKodiakBaseUrl()}${options.path}`,
      createFetchOptions({
            headers: getKodiakPublicHeaders(),
      })
    );

        if (!response.ok) {
            const errorText = await response.text();
      throw new Error(
        `Kodiak API error: ${response.status} ${response.statusText} - ${errorText}`
      );
        }

        const responseData = await response.json();

        const result: KodiakApiResponse<T> = {
            success: true,
            data: options.extract(responseData),
        };

    await redisService.setex(
      options.cacheKey,
      options.ttlSeconds,
      JSON.stringify(result)
    );

        logger.debug(options.successLog, logContext);
        return result;
    } catch (error) {
        logger.error(options.errorLog, error as Error, {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
        });

        return {
            success: false,
            error: options.errorMessage,
        };
    }
}

/**
 * Default extractor used by most public endpoints: unwrap `.data` when present.
 */
export function unwrapDataOrRaw<T>(responseData: unknown): T {
  return (responseData as { data?: T }).data || (responseData as T);
}
