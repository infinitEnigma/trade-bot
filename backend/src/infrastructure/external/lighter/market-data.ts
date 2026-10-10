/**
 * Lighter public candles reader (X3) — venue dispatch on the public
 * `GET /api/market/tv/history` route.
 *
 * The chart fetch chain used to be Kodiak-only (`/v1/tv/history`), but
 * strategies store venue symbols (`"ETH"` for Lighter), and bare symbols 400
 * on the Kodiak endpoint — the Strategies chart broke for Lighter symbols.
 * This reader answers the same request from Lighter's public candles API:
 *
 * - `symbol → market_id` resolves against the shared market directory
 *   (`./market-directory.ts`, the `orderBooks` catalog); a miss is an
 *   explicit error, never a guessed id.
 * - TradingView resolutions map to Lighter's enum 1:1 (`1→1m … 720→12h,
 *   1D/D→1d`); anything else (e.g. `120`, `W`, `M`) fails loudly — no silent
 *   clamping to a neighbouring interval.
 * - `from`/`to` arrive as unix **seconds** (route contract) and are sent to
 *   the venue as **milliseconds**; `count_back` is derived from the window
 *   and capped at the venue's 500-candle maximum.
 * - The response is emitted in the exact TradingView column shape the
 *   frontend already parses (`{s, t[], o[], h[], l[], c[], v[]}`) with `t` in
 *   seconds — `transformTradingViewData` stays untouched.
 *
 * Public market data only: no auth, no secrets, same exposure class as the
 * Kodiak tv route today. Wire shape pinned live 2026-10-09 (mainnet market 1
 * + testnet markets 4095/4096): `GET /api/v1/candles?market_id=&resolution=
 * &start_timestamp=ms&end_timestamp=ms&count_back=` →
 * `{code:200, r:"1h", c:[{t(ms), o, h, l, c, v, V, i}]}`.
 *
 * @format
 */

import { isAxiosError } from "axios";
import { lighterBaseUrl } from "../exchange-accounts/lighter-verifier";
import { venueClient } from "./venue-client";
import { resolveMarketId } from "./market-directory";
import type {
  KodiakApiResponse,
  KodiakTradingViewHistory,
} from "../kodiak/types";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";

/** Venue hard cap for one `/api/v1/candles` call (live-probed). */
const MAX_CANDLES = 500;

/** TradingView resolution → Lighter enum + candle duration in seconds. */
const RESOLUTIONS: Record<string, { lighter: string; seconds: number }> = {
  "1": { lighter: "1m", seconds: 60 },
  "5": { lighter: "5m", seconds: 300 },
  "15": { lighter: "15m", seconds: 900 },
  "30": { lighter: "30m", seconds: 1800 },
  "60": { lighter: "1h", seconds: 3600 },
  "240": { lighter: "4h", seconds: 14400 },
  "720": { lighter: "12h", seconds: 43200 },
  "1D": { lighter: "1d", seconds: 86400 },
  D: { lighter: "1d", seconds: 86400 },
};

export interface LighterCandlesParams {
  symbol: string;
  /** TradingView resolution string as sent by the chart (`"1"`, `"60"`, `"1D"`…). */
  resolution: string;
  /** Window start, unix seconds (route contract). */
  from: number;
  /** Window end, unix seconds (route contract). */
  to: number;
  environment: string;
}

/** Venue candle row (`t` in milliseconds, as probed live). */
interface LighterCandleRow {
  t?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
}

const toNumber = (value: unknown): number => {
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

/**
 * Fetch one window of Lighter candles and convert it to TradingView columns.
 *
 * Returns `{success:false, error}` for an unsupported resolution, an
 * unlisted symbol, a venue rejection or a transport failure — the route maps
 * that to 400, exactly like the Kodiak branch's own failure path.
 */
export async function getLighterCandles(
  params: LighterCandlesParams
): Promise<KodiakApiResponse<KodiakTradingViewHistory>> {
  const { symbol, resolution, from, to, environment } = params;

  const mapped = RESOLUTIONS[resolution];
  if (!mapped) {
    return {
      success: false,
      error:
        `Unsupported resolution "${resolution}" for Lighter candles ` +
        `(supported: ${Object.keys(RESOLUTIONS).join(", ")})`,
    };
  }

  const marketId = await resolveMarketId(symbol, environment);
  if (marketId === null) {
    return {
      success: false,
      error: `symbol "${symbol}" not listed on Lighter`,
    };
  }

  // Venue contract: timestamps in ms; count_back bounds the window at the
  // 500-candle maximum.
  const spanSeconds = Math.max(1, Math.floor(to) - Math.floor(from));
  const countBack = Math.min(
    MAX_CANDLES,
    Math.max(1, Math.ceil(spanSeconds / mapped.seconds) + 1)
  );

  try {
    const response = await venueClient(lighterBaseUrl(environment)).get(
      "/api/v1/candles",
      {
        params: {
          market_id: marketId,
          resolution: mapped.lighter,
          start_timestamp: Math.floor(from) * 1000,
          end_timestamp: Math.floor(to) * 1000,
          count_back: countBack,
        },
      }
    );
    const body = response.data as
      { code?: unknown; message?: unknown; c?: unknown } | undefined;
    if (body && body.code !== undefined && Number(body.code) !== 200) {
      const detail =
        typeof body.message === "string" && body.message
          ? body.message
          : `code ${String(body.code)}`;
      return { success: false, error: `Lighter candles error: ${detail}` };
    }

    const rows = Array.isArray(body?.c) ? (body.c as LighterCandleRow[]) : [];
    const history: KodiakTradingViewHistory = {
      s: "ok",
      t: [],
      o: [],
      h: [],
      l: [],
      c: [],
      v: [],
    };
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const timeMs = toNumber(row.t);
      const open = toNumber(row.o);
      const high = toNumber(row.h);
      const low = toNumber(row.l);
      const close = toNumber(row.c);
      const volume = toNumber(row.v);
      if (
        !Number.isFinite(timeMs) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        continue;
      }
      history.t.push(Math.floor(timeMs / 1000)); // ms → seconds (frontend contract)
      history.o.push(open);
      history.h.push(high);
      history.l.push(low);
      history.c.push(close);
      history.v.push(Number.isFinite(volume) ? volume : 0);
    }

    if (history.t.length === 0) {
      // Empty window is "no data", not an error (Kodiak answers the same).
      history.s = "no_data";
      return { success: true, data: history };
    }

    // Venue returns ascending, but the frontend assumes chronological order.
    const order = history.t
      .map((_, index) => index)
      .sort((a, b) => history.t[a] - history.t[b]);
    history.t = order.map(i => history.t[i]);
    history.o = order.map(i => history.o[i]);
    history.h = order.map(i => history.h[i]);
    history.l = order.map(i => history.l[i]);
    history.c = order.map(i => history.c[i]);
    history.v = order.map(i => history.v[i]);

    return { success: true, data: history };
  } catch (error) {
    const detail = isAxiosError(error)
      ? // Venue/detail never carries credentials — same trimming as portfolio.
        `HTTP ${error.response?.status ?? "error"}${
          typeof (error.response?.data as { message?: unknown })?.message ===
          "string"
            ? `: ${(error.response?.data as { message: string }).message}`
            : ""
        }`
      : error instanceof Error
        ? error.message
        : String(error);
    logger.warn("Lighter candles fetch failed", {
      symbol,
      resolution,
      environment,
      error: detail,
    });
    return {
      success: false,
      error: `Lighter candles unavailable (${detail})`,
    };
  }
}
