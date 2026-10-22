/** @format */

/**
 * Kodiak admission-price reader — the backend's authoritative price for a
 * grid admission decision.
 *
 * Deliberately NOT built on `getMarketTicker`: that method caches the whole
 * response in Redis for 30 s and the cached payload carries NO timestamp, so a
 * cache hit cannot prove how old the quote is. An admission decision needs a
 * price whose freshness is known — "the venue said this at some point in the
 * last 30 seconds" is not enough, because the cache TTL and the venue's own
 * quote age are different things.
 *
 * So this reader performs a NARROW, UNCACHED read of the same public endpoint
 * the integration already uses (`GET {KODIAK_API_URL}/v1/public/futures/{symbol}`)
 * and timestamps the result itself. It stays inside the integration layer:
 * the same base-URL resolution (`getKodiakBaseUrl`) and the same public
 * headers/fetch options (`createFetchOptions`, `getKodiakPublicHeaders`) — no
 * bespoke HTTP plumbing, and no direct API calls from the admission service.
 *
 * Environment scope: Kodiak's base URL is a PROCESS-level setting
 * (`KODIAK_API_URL`), so one backend process serves one Kodiak environment.
 * The reader therefore reports the environment it can actually attest to and
 * refuses to price a request for a different one — a testnet price must never
 * be used to admit a mainnet run (or vice versa).
 */

import {
  createFetchOptions,
  getKodiakBaseUrl,
  getKodiakPublicHeaders,
} from "./fetch-options";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
import type {
  AdmissionEnvironment,
  AdmissionMarketPrice,
  AdmissionPriceRequest,
  IMarketPriceReader,
} from "../../../core/strategies/admission/market-price-reader.port";

/** Admission reads are a control-plane action — keep the bound short. */
const ADMISSION_PRICE_TIMEOUT_MS = 5000;

/**
 * The Kodiak environment this process can actually serve, derived from the
 * configured base URL.
 *
 * `KODIAK_API_URL` points at one venue deployment; the well-known testnet
 * host is the only one we can name. When the URL is not recognisable the
 * environment is UNKNOWN — the reader then refuses any environment-specific
 * request rather than guessing (a wrong-environment price is worse than no
 * price).
 */
export function kodiakProcessEnvironment(): AdmissionEnvironment | null {
  const url = getKodiakBaseUrl().toLowerCase();
  if (url.includes("testnet") || url.includes("sandbox")) return "testnet";
  if (url.includes("mainnet") || url.includes("api.orderly.org")) {
    return "mainnet";
  }
  return null;
}

const toNumber = (value: unknown): number => {
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

/**
 * Read Kodiak's current mark price for one instrument.
 *
 * THROWS when the price cannot be established — the caller treats a throw as
 * "no admission" and never falls back to the engine's reported price.
 */
export async function readKodiakAdmissionPrice(
  request: AdmissionPriceRequest
): Promise<AdmissionMarketPrice> {
  const { symbol, environment } = request;

  const processEnvironment = kodiakProcessEnvironment();
  if (!processEnvironment) {
    throw new Error(
      `Kodiak environment is unknown (KODIAK_API_URL=${getKodiakBaseUrl()}) — cannot price the admission`
    );
  }
  if (processEnvironment !== environment) {
    throw new Error(
      `Kodiak price read refused: this process serves ${processEnvironment}, but the run is on ${environment} — a cross-environment price must never admit a run`
    );
  }

  const url = `${getKodiakBaseUrl().replace(/\/+$/, "")}/v1/public/futures/${encodeURIComponent(symbol)}`;
  let payload: unknown;
  try {
    const response = await fetch(url, {
      ...createFetchOptions({
        headers: getKodiakPublicHeaders(),
        signal: AbortSignal.timeout(ADMISSION_PRICE_TIMEOUT_MS),
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `Kodiak price read failed for "${symbol}" on ${environment}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // The ticker endpoint answers with a row list (`data.rows[0]`), a single
  // object under `data`, or the bare object — the integration's own extractor
  // accepts all three, so this reader accepts the same shapes.
  const root = (payload ?? {}) as Record<string, unknown>;
  const dataNode =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  const rows = Array.isArray(dataNode.rows)
    ? (dataNode.rows as Record<string, unknown>[])
    : undefined;
  const ticker = rows?.[0] ?? dataNode;

  const markPrice = toNumber(
    (ticker as Record<string, unknown>)?.mark_price ??
      (ticker as Record<string, unknown>)?.index_price ??
      (ticker as Record<string, unknown>)?.price
  );
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error(
      `Kodiak returned no usable price for "${symbol}" on ${environment} — cannot price the admission`
    );
  }

  const readAtMs = Date.now();
  logger.debug("Kodiak admission price read", {
    symbol,
    environment,
    price: markPrice,
    readAtMs,
  });

  return {
    venue: "kodiak",
    environment,
    resolvedInstrument: symbol,
    price: markPrice,
    // The ticker payload carries no venue timestamp — the read time is the
    // only freshness evidence this reader can attest to, and the admission
    // service budgets from it.
    sourceTimestampMs: null,
    readAtMs,
  };
}

/** The Kodiak reader bound to the core port. */
export const kodiakAdmissionPriceReader: IMarketPriceReader = {
  readPrice: readKodiakAdmissionPrice,
};
