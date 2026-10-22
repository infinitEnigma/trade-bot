/** @format */

/**
 * Lighter admission-price reader — the backend's authoritative price for a
 * grid admission decision.
 *
 * Reuses the EXISTING Lighter public-read infrastructure rather than adding a
 * second pricing implementation:
 * - `resolveMarketId` (`./market-directory.ts`) maps the strategy's symbol to
 *   the venue's own `market_id` through the shared `orderBooks` catalog. A
 *   miss is an explicit "not listed" error — never a guessed id.
 * - the public candles endpoint (`/api/v1/candles`) supplies the price. The
 *   reader asks for the SHORTEST resolution the venue supports (1m) and takes
 *   the LAST candle's close — the most recent price the venue publishes for
 *   that instrument.
 *
 * Freshness: the candles carry the venue's own timestamps, so the returned
 * quote is timestamped by the VENUE, not by this reader. The admission
 * service checks that timestamp against its age budget. A candle that is too
 * old fails the admission — a stale price is an unknown capacity.
 *
 * Public market data only: no auth, no secrets, same exposure class as the
 * chart's candles route.
 */

import { isAxiosError } from "axios";
import { lighterBaseUrl } from "../exchange-accounts/lighter-verifier";
import { venueClient } from "./venue-client";
import { resolveMarketId } from "./market-directory";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
import type {
  AdmissionEnvironment,
  AdmissionMarketPrice,
  AdmissionPriceRequest,
  IMarketPriceReader,
} from "../../../core/strategies/admission/market-price-reader.port";

/** The venue's shortest candle resolution — the freshest published price. */
const PRICE_RESOLUTION = "1m";
/** Venue candle cap (the endpoint's hard maximum). */
const MAX_CANDLES = 500;
/** How many recent candles to pull — the last one carries the newest close. */
const PRICE_CANDLE_COUNT = 5;

interface LighterCandleRow {
  t?: unknown;
  c?: unknown;
}

const toNumber = (value: unknown): number => {
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

/**
 * Read Lighter's current price for one instrument.
 *
 * THROWS when the price cannot be established — the caller treats a throw as
 * "no admission" and never falls back to the engine's reported price.
 */
export async function readLighterAdmissionPrice(
  request: AdmissionPriceRequest
): Promise<AdmissionMarketPrice> {
  const { symbol, environment } = request;

  const marketId = await resolveMarketId(symbol, environment);
  if (marketId === null) {
    throw new Error(
      `Lighter symbol "${symbol}" is not listed on ${environment} — cannot price the admission`
    );
  }

  const endMs = Date.now();
  const startMs = endMs - PRICE_CANDLE_COUNT * 60_000;

  let rows: LighterCandleRow[];
  try {
    const response = await venueClient(lighterBaseUrl(environment)).get(
      "/api/v1/candles",
      {
        params: {
          market_id: marketId,
          resolution: PRICE_RESOLUTION,
          start_timestamp: startMs,
          end_timestamp: endMs,
          count_back: PRICE_CANDLE_COUNT,
        },
      }
    );
    const body = response.data as
      { code?: unknown; message?: unknown; c?: unknown } | undefined;
    if (body && body.code !== undefined && Number(body.code) !== 200) {
      const detail =
        typeof body.message === "string"
          ? body.message
          : `code ${String(body.code)}`;
      throw new Error(`Lighter candles error: ${detail}`);
    }
    rows = Array.isArray(body?.c) ? (body.c as LighterCandleRow[]) : [];
  } catch (error) {
    const detail = isAxiosError(error)
      ? (error.response?.data as { message?: unknown } | undefined)?.message
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(
      `Lighter price read failed for "${symbol}" on ${environment}: ${String(detail)}`
    );
  }

  // The venue returns ascending candles; the LAST valid one is the newest.
  let newest: { timeMs: number; close: number } | null = null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const timeMs = toNumber(row.t);
    const close = toNumber(row.c);
    if (!Number.isFinite(timeMs) || !Number.isFinite(close) || close <= 0) {
      continue;
    }
    if (!newest || timeMs > newest.timeMs) {
      newest = { timeMs, close };
    }
  }

  if (!newest) {
    throw new Error(
      `Lighter returned no usable price for "${symbol}" on ${environment} — cannot price the admission`
    );
  }

  logger.debug("Lighter admission price read", {
    symbol,
    environment,
    marketId,
    price: newest.close,
    sourceTimestampMs: newest.timeMs,
  });

  return {
    venue: "lighter",
    environment: environment as AdmissionEnvironment,
    resolvedInstrument: String(marketId),
    price: newest.close,
    sourceTimestampMs: newest.timeMs,
    readAtMs: Date.now(),
  };
}

/** The Lighter reader bound to the core port. */
export const lighterAdmissionPriceReader: IMarketPriceReader = {
  readPrice: readLighterAdmissionPrice,
};

/** Keep the candle cap referenced so the constant documents the venue limit. */
export const LIGHTER_PRICE_MAX_CANDLES = MAX_CANDLES;
