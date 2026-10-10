/**
 * Lighter portfolio reads — venue dispatch for `/api/market/{positions,
 * balance, trades}` (C3b follow-up; the P0-L2 "venue-agnostic dashboard").
 *
 * `market-portfolio.routes.ts` dispatches here when the selected exchange
 * account is a Lighter row; Kodiak rows keep using `kodiak-integration`.
 * The shapes returned here are the ones the frontend already consumes
 * (KodiakAccountInfo-compatible balance, `{ rows: [...] }` for positions and
 * trades), so the dashboard needs no venue branch of its own.
 *
 * Wire facts pinned live against the configured environment (2026-09-26,
 * auth-token + read-only GETs — same evidence style as the Phase-0 probe):
 * - `GET /api/v1/account?by=index&value=<i>` → `accounts[0]` carries
 *   `collateral`, `available_balance`, `assets[]` and `positions[]`
 *   (`symbol`, `sign`, `position`, `avg_entry_price`, `unrealized_pnl` —
 *   no `mark_price`, so it is derived from pnl/sign/qty when absent).
 * - `GET /api/v1/trades?account_index&sort_by=timestamp&limit` (both latter
 *   required) → `{ trades: [...] }` rows: `market_id`, `size`, `price`,
 *   `timestamp` (ms), `bid_account_id`/`ask_account_id`, `is_maker_ask`.
 * - `GET /api/v1/orderBooks` → `{ order_books: [{ symbol, market_id }] }`
 *   maps trade `market_id` → venue symbol (public, no auth).
 * - Private reads authenticate with `Authorization: <token>` where the token
 *   comes from the signer sidecar `POST /v1/auth-token` (the engine exact
 *   pattern — `engine/src/exchanges/lighter/client.ts`), cached per
 *   `(env, accountIndex, apiKeyIndex)` and refreshed before its 600 s
 *   deadline. Credentials decrypt from the account Q1 envelope; they are
 *   never logged and never leave the process except to the loopback sidecar.
 *
 * Cache policy mirrors Kodiak: positions/trades use the in-memory
 * `kodiakCache` (keys prefixed `lighter:`), balance uses Redis. Successful
 * reads persist a C3b snapshot into `exchange_positions` / `exchange_balances`
 * (best-effort, never fails the read).
 *
 * @format
 */

import axios, { AxiosInstance, isAxiosError } from "axios";
import { redisService } from "../../cache/redis.service";
import { kodiakCache } from "../kodiak-cache";
import { venueClient } from "./venue-client";
import { marketDirectory } from "./market-directory";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
import { exchangeSnapshotAdapter } from "../../adapters/repositories/exchange-snapshot.adapter";
import type {
  PositionSnapshot,
  BalanceSnapshot,
} from "../../adapters/repositories/exchange-snapshot.adapter";
import { exchangeAccountRepositoryAdapter } from "../../adapters/repositories/exchange-account-repository.adapter";
import { encryptionService } from "../../security/encryption.service";
import type {
  KodiakAccountInfo,
  KodiakApiResponse,
  KodiakBalance,
} from "../kodiak/types";
import type { LighterCredentials } from "../exchange-accounts/lighter-verifier";
import {
  lighterBaseUrl,
  lighterVerifierConfigFromEnv,
} from "../exchange-accounts/lighter-verifier";

/** Venue/sidecar timeouts (client construction lives in `./venue-client.ts`). */
const SIDECAR_TIMEOUT_MS = 5000;
/** Mirrors the engine: token valid 600 s, refreshed before the deadline. */
const AUTH_TOKEN_DEADLINE_S = 600;
const AUTH_TOKEN_CACHE_MS = 9 * 60 * 1000;
/** Redis balance TTL (seconds) — same as `KodiakIntegrationService.CACHE_TTL`. */
const BALANCE_TTL_S = 300;
const ROWS_TTL_MS = 30000;
/** Longest venue/sidecar reason kept (bounded logs + UI, never secrets). */
const MAX_REASON_LENGTH = 300;

export interface ResolvedLighterAccount {
  /** `exchange_accounts.id` UUID (snapshot/FK target). */
  id: string;
  accountRef: string;
  credentials: LighterCredentials;
}

/** Frontend `Position` row (Dashboard positions table). */
export interface LighterPositionRow {
  symbol: string;
  position_qty: string;
  average_open_price: string;
  mark_price: string;
  unsettled_pnl: string;
  side: "LONG" | "SHORT";
}

/** Frontend `Trade` row (Dashboard recent-trades table). */
export interface LighterTradeRow {
  symbol: string;
  side: "LONG" | "SHORT";
  closed_position_qty: string;
  avg_close_price: string;
  avg_open_price: string;
  realized_pnl: string;
  close_timestamp: number;
  open_timestamp: number;
}

interface Envelope {
  v?: number;
  kind?: string;
  accountIndex?: number;
  apiKeyIndex?: number;
  privateKey?: string;
}

/** Venue string/number → finite number (never poison a numeric column). */
function num(value: unknown): number {
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trimReason(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  return text.length > MAX_REASON_LENGTH
    ? `${text.slice(0, MAX_REASON_LENGTH)}…`
    : text;
}

/**
 * Display symbol the dashboard expects (`PERP_ETH_USDC` style — it strips
 * `PERP_`/`_USDC` and takes `symbol[5]` for the glyph). Venue symbols are
 * bare (`ETH`); anything already underscored passes through untouched.
 */
function displaySymbol(raw: unknown): string {
  const symbol = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!symbol) return "UNKNOWN";
  return symbol.includes("_") ? symbol : `PERP_${symbol}_USDC`;
}

// ------------------------------------------------------------------ clients
// (Public venue client extracted to `./venue-client.ts`; the market directory
//  to `./market-directory.ts` — both shared with the X3 candles reader.)

let sidecarClient: AxiosInstance | null | undefined;

function getSidecarClient(): AxiosInstance | null {
  if (sidecarClient !== undefined) return sidecarClient;
  const config = lighterVerifierConfigFromEnv();
  const url = (config.sidecarUrl ?? "").trim().replace(/\/+$/, "");
  sidecarClient = url
    ? axios.create({
        baseURL: url,
        timeout: SIDECAR_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          ...(config.sidecarAuthToken
            ? { Authorization: `Bearer ${config.sidecarAuthToken}` }
            : {}),
        },
      })
    : null;
  return sidecarClient;
}

// ------------------------------------------------------------- credentials

/**
 * Resolve the LIGHTER account a portfolio read runs against — same defence
 * contract as `resolveKodiakAccount`: caller-owned, lighter row, ACTIVE,
 * decryptable envelope (the route already answered 400/404/409 before this;
 * this is defence in depth).
 */
export async function resolveLighterAccount(
  userId: string,
  exchangeAccountId: string
): Promise<ResolvedLighterAccount | null> {
  try {
    const stored = await exchangeAccountRepositoryAdapter.getAccountWithSecret(
      userId,
      exchangeAccountId
    );
    if (
      !stored ||
      stored.exchange !== "lighter" ||
      stored.status !== "ACTIVE"
    ) {
      return null;
    }
    const plaintext = await encryptionService.decryptWithVersion(
      stored.credentialsEncrypted
    );
    const parsed = JSON.parse(plaintext) as Envelope;
    if (
      parsed.kind !== "lighter" ||
      typeof parsed.accountIndex !== "number" ||
      typeof parsed.apiKeyIndex !== "number" ||
      typeof parsed.privateKey !== "string"
    ) {
      return null;
    }
    return {
      id: stored.id,
      accountRef: stored.accountRef,
      credentials: {
        accountIndex: parsed.accountIndex,
        apiKeyIndex: parsed.apiKeyIndex,
        privateKey: parsed.privateKey,
        environment: stored.environment,
      },
    };
  } catch (error) {
    logger.error(
      "Failed to resolve Lighter portfolio account",
      error as Error,
      {
        userId,
        exchangeAccountId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return null;
  }
}

// -------------------------------------------------------------------- auth

/** Typed source failure (sidecar/venue) — carries a safe, secret-free text. */
class LighterPortfolioSourceError extends Error {}

interface AuthTokenCacheEntry {
  token: string;
  at: number;
}

/** Keyed by environment+indices — never by anything secret. */
const authTokenCache = new Map<string, AuthTokenCacheEntry>();

/**
 * Sidecar `POST /v1/auth-token` → `Authorization` header value, cached per
 * `(env, accountIndex, apiKeyIndex)` and refreshed before the 600 s deadline
 * (the engine's `LighterClient.authHeaders` pattern).
 */
async function authHeaders(
  credentials: LighterCredentials
): Promise<Record<string, string>> {
  const cacheKey = `${credentials.environment}:${credentials.accountIndex}:${credentials.apiKeyIndex}`;
  const hit = authTokenCache.get(cacheKey);
  if (hit && Date.now() - hit.at < AUTH_TOKEN_CACHE_MS) {
    return { Authorization: hit.token };
  }
  const sidecar = getSidecarClient();
  if (!sidecar) {
    throw new LighterPortfolioSourceError(
      "Lighter signer sidecar is not configured (LIGHTER_SIDECAR_URL)"
    );
  }
  try {
    const response = await sidecar.post("/v1/auth-token", {
      account_index: credentials.accountIndex,
      api_key_index: credentials.apiKeyIndex,
      private_key: credentials.privateKey,
      deadline_seconds: AUTH_TOKEN_DEADLINE_S,
    });
    const body = response.data as {
      ok?: unknown;
      token?: unknown;
      error?: unknown;
    };
    if (body?.ok !== true || typeof body.token !== "string") {
      throw new LighterPortfolioSourceError(
        `Lighter auth token rejected: ${trimReason(body?.error ?? "no token")}`
      );
    }
    authTokenCache.set(cacheKey, { token: body.token, at: Date.now() });
    return { Authorization: body.token };
  } catch (error) {
    if (error instanceof LighterPortfolioSourceError) throw error;
    if (isAxiosError(error)) {
      const data = error.response?.data as
        { detail?: unknown; error?: unknown } | undefined;
      const detail = trimReason(
        data?.detail ??
          data?.error ??
          `HTTP ${error.response?.status ?? "error"}`
      );
      throw new LighterPortfolioSourceError(
        `Lighter signer sidecar error: ${detail}`
      );
    }
    throw new LighterPortfolioSourceError("Lighter signer sidecar unreachable");
  }
}

// -------------------------------------------------------------------- reads

async function authorizedGet(
  credentials: LighterCredentials,
  path: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const headers = await authHeaders(credentials);
  try {
    const response = await venueClient(
      lighterBaseUrl(credentials.environment)
    ).get(path, { params, headers });
    const data = response.data;
    return typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};
  } catch (error) {
    if (error instanceof LighterPortfolioSourceError) throw error;
    if (isAxiosError(error)) {
      const detail = trimReason(
        (error.response?.data as { message?: unknown } | undefined)?.message ??
          `HTTP ${error.response?.status ?? "error"}`
      );
      throw new LighterPortfolioSourceError(
        `Lighter venue rejected ${path}: ${detail}`
      );
    }
    throw new LighterPortfolioSourceError(
      `Lighter venue unreachable (${lighterBaseUrl(credentials.environment)})`
    );
  }
}

export interface LighterPnlPoint {
  timestamp: number;
  tradePnl: number;
  volume: number;
}

/**
 * `GET /api/v1/pnl` — the venue's own realized-PnL series ("Get account PnL
 * chart"). Per-fill realized PnL does NOT exist on `/api/v1/trades` rows
 * (verified live 2026-10-09, account 123: fill rows carry size/price plus
 * taker/maker position-before fields, no pnl field), so the venue-computed
 * `trade_pnl` series is the authoritative realized figure for Lighter —
 * the same number behind the venue portfolio page.
 *
 * `resolution=1h` keeps the payload small; `ignore_transfers=true` so
 * deposits/withdrawals never masquerade as trading profit. `count_back`
 * caps the window (venue default otherwise). Kodiak accounts are untouched
 * (their native per-trade `realizedPnl` rows keep flowing through
 * `getTrades`); callers stay venue-blind via the `/pnl` portfolio route.
 */
export async function getLighterPnl(
  userId: string,
  countBack: number,
  exchangeAccountId: string
): Promise<KodiakApiResponse<{ points: LighterPnlPoint[] }>> {
  const bounded = Math.min(Math.max(Math.trunc(countBack) || 168, 1), 1000);
  const cacheKey = `lighter:pnl:${userId}:${bounded}:${exchangeAccountId}`;
  try {
    const cached = kodiakCache.get(cacheKey);
    if (cached && typeof cached === "object" && "success" in cached) {
      logger.debug("Returning cached Lighter pnl", {
        userId,
        exchangeAccountId,
      });
      return cached as KodiakApiResponse<{ points: LighterPnlPoint[] }>;
    }

    const resolved = await resolveLighterAccount(userId, exchangeAccountId);
    if (!resolved) {
      return { success: false, error: "No verified Lighter credentials found" };
    }

    const now = Date.now();
    const body = await authorizedGet(resolved.credentials, "/api/v1/pnl", {
      by: "index",
      value: String(resolved.credentials.accountIndex),
      resolution: "1h",
      start_timestamp: now - bounded * 3600 * 1000,
      end_timestamp: now,
      count_back: bounded,
      ignore_transfers: true,
    });
    const entries = Array.isArray(body.pnl) ? body.pnl : [];
    const points: LighterPnlPoint[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const raw = entry as Record<string, unknown>;
      points.push({
        timestamp: num(raw.timestamp),
        tradePnl: num(raw.trade_pnl),
        volume: num(raw.volume),
      });
    }

    const result: KodiakApiResponse<{ points: LighterPnlPoint[] }> = {
      success: true,
      data: { points },
    };
    kodiakCache.set(cacheKey, result, ROWS_TTL_MS);
    logger.debug("Lighter pnl retrieved and cached", {
      userId,
      exchangeAccountId: resolved.id,
      pointsCount: points.length,
    });
    return result;
  } catch (error) {
    logger.error("Get Lighter pnl error", error as Error, {
      userId,
      exchangeAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error:
        error instanceof LighterPortfolioSourceError
          ? error.message
          : "Failed to get Lighter pnl",
    };
  }
}

/** `accounts[0]` of `GET /api/v1/account` (collateral + assets + positions). */
async function fetchAccount(
  credentials: LighterCredentials
): Promise<Record<string, unknown>> {
  const body = await authorizedGet(credentials, "/api/v1/account", {
    by: "index",
    value: String(credentials.accountIndex),
  });
  const accounts = body.accounts;
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  if (!account || typeof account !== "object") {
    throw new LighterPortfolioSourceError(
      "Lighter account lookup returned no account"
    );
  }
  return account as Record<string, unknown>;
}

// ---------------------------------------------------------------- snapshots

/**
 * C3b venue sync — persist the per-account position snapshot (best-effort:
 * a snapshot failure is logged, never propagated to the read).
 */
async function persistPositionSnapshot(
  exchangeAccountId: string,
  rows: LighterPositionRow[],
  userId: string
): Promise<void> {
  try {
    const snapshot: PositionSnapshot[] = rows
      .filter(row => row.symbol && row.symbol !== "UNKNOWN")
      .map(row => ({
        symbol: row.symbol,
        positionQty: num(row.position_qty),
        entryPrice: num(row.average_open_price),
        markPrice: num(row.mark_price),
        unrealizedPnl: num(row.unsettled_pnl),
      }));
    await exchangeSnapshotAdapter.replacePositions(exchangeAccountId, snapshot);
  } catch (error) {
    logger.error(
      "Failed to persist Lighter position snapshot",
      error as Error,
      {
        userId,
        exchangeAccountId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

/** C3b venue sync — persist the per-account balance snapshot (best-effort). */
async function persistBalanceSnapshot(
  exchangeAccountId: string,
  balances: KodiakBalance[],
  userId: string
): Promise<void> {
  try {
    const snapshot: BalanceSnapshot[] = balances
      .filter(b => b.asset && b.asset.trim() !== "" && b.asset !== "UNKNOWN")
      .map(b => ({
        asset: b.asset,
        holding: num(b.free),
        frozen: num(b.locked),
      }));
    await exchangeSnapshotAdapter.replaceBalances(exchangeAccountId, snapshot);
  } catch (error) {
    logger.error("Failed to persist Lighter balance snapshot", error as Error, {
      userId,
      exchangeAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ------------------------------------------------------------------ balance

interface LighterAsset {
  symbol?: unknown;
  balance?: unknown;
  locked_balance?: unknown;
}

/**
 * Lighter account balance in the `KodiakAccountInfo` shape the balance
 * widget already consumes (`totalBalance` string + `balances[]`).
 */
export async function getLighterBalance(
  userId: string,
  exchangeAccountId: string
): Promise<KodiakApiResponse<KodiakAccountInfo>> {
  const cacheKey = `lighter:balance:${userId}:${exchangeAccountId}`;
  try {
    const cached = await redisService.get(cacheKey);
    if (cached.success && cached.data) {
      logger.debug("Returning cached Lighter balance", {
        userId,
        exchangeAccountId,
      });
      return JSON.parse(cached.data) as KodiakApiResponse<KodiakAccountInfo>;
    }

    const resolved = await resolveLighterAccount(userId, exchangeAccountId);
    if (!resolved) {
      return { success: false, error: "No verified Lighter credentials found" };
    }

    const account = await fetchAccount(resolved.credentials);
    const totalBalance = String(
      account.collateral ?? account.total_asset_value ?? "0"
    );
    const assets: LighterAsset[] = Array.isArray(account.assets)
      ? (account.assets as LighterAsset[])
      : [];
    const balances: KodiakBalance[] = assets.map(asset => ({
      asset: String(asset.symbol ?? "UNKNOWN"),
      free: String(asset.balance ?? "0"),
      locked: String(asset.locked_balance ?? "0"),
      freeze: "0",
      withdrawing: "0",
      ipoable: "0",
      btcValuation: "0",
    }));

    const result: KodiakApiResponse<KodiakAccountInfo> = {
      success: true,
      data: {
        totalBalance,
        totalPnl24H: "0",
        totalPnl30D: "0",
        totalPnlAll: "0",
        tradingVolume24H: "0",
        accountType: "LIGHTER",
        balances,
      },
    };

    await redisService.setex(cacheKey, BALANCE_TTL_S, JSON.stringify(result));

    // C3b venue sync: persist the per-account snapshot (best-effort).
    await persistBalanceSnapshot(resolved.id, balances, userId);

    logger.debug("Lighter balance retrieved and cached", {
      userId,
      exchangeAccountId: resolved.id,
      totalBalance,
      holdingsCount: balances.length,
    });
    return result;
  } catch (error) {
    logger.error("Get Lighter balance error", error as Error, {
      userId,
      exchangeAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error:
        error instanceof LighterPortfolioSourceError
          ? error.message
          : "Failed to get Lighter balance",
    };
  }
}

// ---------------------------------------------------------------- positions

/**
 * Map one `/api/v1/account` position row to the dashboard `Position` shape.
 *
 * - direction: Lighter keeps magnitude in `position` and direction in `sign`
 *   (1 / −1); the dashboard infers LONG/SHORT from the sign of `position_qty`.
 * - `mark_price` is absent on this endpoint — derive it from the pnl identity
 *   `pnl = (mark − entry) · sign · |qty|` so the PnL % column stays truthful;
 *   a venue-reported value always wins.
 * - flat rows are dropped (the venue normally omits them; size 0 would render
 *   as a bogus SHORT).
 */
/** Round a derived price to 8 dp — kills IEEE754 tails (`2685.6349999999998`). */
function roundMark(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function mapPosition(raw: Record<string, unknown>): LighterPositionRow | null {
  const magnitude = Math.abs(num(raw.position));
  if (magnitude === 0) return null;
  const sign = num(raw.sign) < 0 ? -1 : 1;
  const qty = sign * magnitude;
  const entry = num(raw.avg_entry_price);
  const hasMark =
    raw.mark_price !== undefined &&
    raw.mark_price !== null &&
    String(raw.mark_price).trim() !== "";
  const derivedMark = roundMark(
    entry + (num(raw.unrealized_pnl) * sign) / magnitude
  );
  const mark = hasMark ? num(raw.mark_price) : derivedMark;
  return {
    symbol: displaySymbol(raw.symbol ?? raw.market),
    position_qty: String(qty),
    average_open_price: String(entry),
    mark_price: String(Number.isFinite(mark) ? mark : entry),
    unsettled_pnl: String(num(raw.unrealized_pnl)),
    side: qty > 0 ? "LONG" : "SHORT",
  };
}

export async function getLighterPositions(
  userId: string,
  exchangeAccountId: string
): Promise<KodiakApiResponse<{ rows: LighterPositionRow[] }>> {
  const cacheKey = `lighter:positions:${userId}:${exchangeAccountId}`;
  try {
    const cached = kodiakCache.get(cacheKey);
    if (cached && typeof cached === "object" && "success" in cached) {
      logger.debug("Returning cached Lighter positions", {
        userId,
        exchangeAccountId,
      });
      return cached as KodiakApiResponse<{ rows: LighterPositionRow[] }>;
    }

    const resolved = await resolveLighterAccount(userId, exchangeAccountId);
    if (!resolved) {
      return { success: false, error: "No verified Lighter credentials found" };
    }

    const account = await fetchAccount(resolved.credentials);
    const positions = Array.isArray(account.positions) ? account.positions : [];
    const rows = positions
      .map(row => mapPosition((row ?? {}) as Record<string, unknown>))
      .filter((row): row is LighterPositionRow => row !== null);

    const result: KodiakApiResponse<{ rows: LighterPositionRow[] }> = {
      success: true,
      data: { rows },
    };
    kodiakCache.set(cacheKey, result, ROWS_TTL_MS);

    // C3b venue sync: persist the per-account snapshot (best-effort).
    await persistPositionSnapshot(resolved.id, rows, userId);

    logger.debug("Lighter positions retrieved and cached", {
      userId,
      exchangeAccountId: resolved.id,
      positionsCount: rows.length,
    });
    return result;
  } catch (error) {
    logger.error("Get Lighter positions error", error as Error, {
      userId,
      exchangeAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error:
        error instanceof LighterPortfolioSourceError
          ? error.message
          : "Failed to get Lighter positions",
    };
  }
}

// ------------------------------------------------------------------- trades

/**
 * Map one `/api/v1/trades` fill to the dashboard `Trade` shape.
 *
 * Lighter reports per-fill rows (no round-trip close), so the display fields
 * carry the fill: `avg_close_price`/`avg_open_price` = fill price,
 * `closed_position_qty` = fill size, `realized_pnl` = "0" (the table renders
 * date/symbol/side/price/qty only). Side is MY direction: I am the bid → LONG,
 * I am the ask → SHORT. Rows the account is not part of are dropped.
 */
function mapTrade(
  raw: Record<string, unknown>,
  directory: Map<number, string>,
  accountIndex: number
): LighterTradeRow | null {
  const size = num(raw.size);
  if (size === 0) return null;
  const me = String(accountIndex);
  const iAmBuyer = String(raw.bid_account_id ?? "") === me;
  const iAmSeller = String(raw.ask_account_id ?? "") === me;
  if (!iAmBuyer && !iAmSeller) return null;
  const timestamp = num(raw.timestamp);
  return {
    symbol: displaySymbol(
      directory.get(num(raw.market_id)) ?? String(raw.market_id)
    ),
    side: iAmBuyer ? "LONG" : "SHORT",
    closed_position_qty: String(size),
    avg_close_price: String(num(raw.price)),
    avg_open_price: String(num(raw.price)),
    realized_pnl: "0",
    close_timestamp: timestamp,
    open_timestamp: timestamp,
  };
}

/**
 * `GET /api/v1/trades` for one account. `sort_by` and `limit` are required
 * by the venue; results are my fills (server-side `account_index` filter).
 */
export async function getLighterTrades(
  userId: string,
  limit: number,
  exchangeAccountId: string
): Promise<KodiakApiResponse<{ rows: LighterTradeRow[] }>> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
  const cacheKey = `lighter:trades:${userId}:${bounded}:${exchangeAccountId}`;
  try {
    const cached = kodiakCache.get(cacheKey);
    if (cached && typeof cached === "object" && "success" in cached) {
      logger.debug("Returning cached Lighter trades", {
        userId,
        exchangeAccountId,
      });
      return cached as KodiakApiResponse<{ rows: LighterTradeRow[] }>;
    }

    const resolved = await resolveLighterAccount(userId, exchangeAccountId);
    if (!resolved) {
      return { success: false, error: "No verified Lighter credentials found" };
    }

    const body = await authorizedGet(resolved.credentials, "/api/v1/trades", {
      account_index: resolved.credentials.accountIndex,
      sort_by: "timestamp",
      limit: bounded,
    });
    const directory = await marketDirectory(resolved.credentials.environment);
    const trades = Array.isArray(body.trades) ? body.trades : [];
    const rows: LighterTradeRow[] = [];
    for (const raw of trades) {
      if (!raw || typeof raw !== "object") continue;
      const row = mapTrade(
        raw as Record<string, unknown>,
        directory,
        resolved.credentials.accountIndex
      );
      if (row) rows.push(row);
    }

    const result: KodiakApiResponse<{ rows: LighterTradeRow[] }> = {
      success: true,
      data: { rows },
    };
    kodiakCache.set(cacheKey, result, ROWS_TTL_MS);
    logger.debug("Lighter trades retrieved and cached", {
      userId,
      exchangeAccountId: resolved.id,
      tradesCount: rows.length,
    });
    return result;
  } catch (error) {
    logger.error("Get Lighter trades error", error as Error, {
      userId,
      exchangeAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error:
        error instanceof LighterPortfolioSourceError
          ? error.message
          : "Failed to get Lighter trades",
    };
  }
}
