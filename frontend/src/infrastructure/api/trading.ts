/** @format */

import { httpClient } from "./client";
import { globalRequestManager } from "../request-manager";
import type { EmergencyStopAction } from "@trade-bot/shared";
import type { WalletProofPayload } from "./wallet";

/**
 * One row of `GET /api/trades` — the platform's OWN ledger (fills recorded
 * by the durable trade ledger), not the venue proxy at /api/market/trades.
 * Attribution fields and fee/pnl are nullable by contract: NULL = unknown
 * (F2), never rendered as a fabricated 0.
 */
export interface LedgerTradeRow {
  id: string;
  strategyId: string | null;
  strategyName: string | null;
  botId: string | null;
  exchangeAccountId: string | null;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number | null;
  pnl: number | null;
  status: string;
  /** ISO-8601. */
  executedAt: string;
}

/**
 * `GET /api/strategies/:id/performance` payload — the LIFETIME fill-ledger
 * aggregate for one strategy (Phase 1 strategy-page PnL), NOT a per-session
 * figure (`bot_instances.total_pnl` resets on restart; this never does).
 *
 * F2 honesty: `totalPnL` sums KNOWN pnl only; non-zero `unknownPnlFills`
 * means the total is incomplete (unknown direction, never a lower bound)
 * and must be surfaced, never implied away.
 */
export interface StrategyPerformance {
  /** Ledger fill rows attributed to the strategy. */
  totalTrades: number;
  /** Realised PnL net of fees, known fills only. */
  totalPnL: number;
  /** Fills booked with unknown PnL — non-zero ⇒ totalPnL is incomplete. */
  unknownPnlFills: number;
  /** winningFills / knownPnlFills × 100; 0 when no known fills. */
  winRate: number;
  /** totalPnL / knownPnlFills; 0 when none. */
  avgTrade: number;
  /** MAX known pnl; null when no known fill exists. */
  bestTrade: number | null;
  /** MIN known pnl; null when no known fill exists. */
  worstTrade: number | null;
  /** SUM(fee) over fills whose fee was known. */
  totalFees: number;
  /** Fills whose fee the venue could not source. */
  unknownFeeFills: number;
  /** ISO-8601 of the oldest attributed fill; null when none. */
  firstFillAt: string | null;
  /** ISO-8601 of the newest attributed fill; null when none. */
  lastFillAt: string | null;
}

/**
 * Trading API endpoints
 * Handles strategies, bots, and trading operations with global deduplication
 */
export const tradingApi = {
  // Strategy endpoints
  async getStrategies() {
    return globalRequestManager.deduplicateRequest(
      "strategies:list",
      () =>
        httpClient
          .getClient()
          .get("/api/strategies")
          .then(r => r.data),
      "tradingApi"
    );
  },

  async createStrategy(data: {
    name: string;
    type: string;
    exchange: "kodiak" | "lighter";
    environment: "testnet" | "mainnet";
    config: Record<string, unknown>;
  }) {
    const response = await httpClient.getClient().post("/api/strategies", data);
    return response.data;
  },

  async updateStrategy(
    strategyId: string,
    data: {
      name: string;
      type: string;
      exchange: "kodiak" | "lighter";
      environment: "testnet" | "mainnet";
      config: Record<string, unknown>;
    }
  ) {
    const response = await httpClient
      .getClient()
      .put(`/api/strategies/${strategyId}`, data);
    return response.data;
  },

  async deleteStrategy(strategyId: string) {
    const response = await httpClient
      .getClient()
      .delete(`/api/strategies/${strategyId}`);
    return response.data;
  },

  /**
   * Lifetime fill-ledger aggregate for one strategy (Phase 1 strategy-page
   * PnL). Ownership is the route's 404; the payload is the ledger truth —
   * restart-safe, unlike the session's `bot_instances.total_pnl`.
   */
  async getStrategyPerformance(strategyId: string) {
    return globalRequestManager.deduplicateRequest(
      `strategies:perf:${strategyId}`,
      () =>
        httpClient
          .getClient()
          .get(`/api/strategies/${strategyId}/performance`)
          .then(r => r.data),
      "tradingApi"
    );
  },

  /**
   * Lifetime fill-ledger aggregates for ALL strategies owned by the caller
   * (Phase 1 strategy-page master-list PnL). Single grouped query — no N+1.
   * Returns Record<strategyId, StrategyPerformance>. Ownership is enforced
   * at the backend SQL layer.
   */
  async getStrategyPerformanceSummary() {
    return globalRequestManager.deduplicateRequest(
      `strategies:perf:summary`,
      () =>
        httpClient
          .getClient()
          .get(`/api/strategies/performance`)
          .then(r => r.data),
      "tradingApi"
    );
  },

  // Bot endpoints (L1: management router is mounted at /management, so the
  // served paths are /api/bot/management/* — the bare /api/bot/* paths 404)
  async getBotInstances() {
    return globalRequestManager.deduplicateRequest(
      "bots:instances",
      () =>
        httpClient
          .getClient()
          .get("/api/bot/management/instances")
          .then(r => r.data),
      "tradingApi"
    );
  },

  /**
   * Delete a terminal (STOPPED/ERROR/UNKNOWN) bot's history row. Live bots
   * are refused with 409 — stop them first.
   */
  async deleteBotInstance(botId: string) {
    const response = await httpClient
      .getClient()
      .delete(`/api/bot/management/instances/${botId}`);
    return response.data;
  },

  async getEngineStatus() {
    return globalRequestManager.deduplicateRequest(
      "bots:engine-status",
      () =>
        httpClient
          .getClient()
          .get("/api/bot/engine/status")
          .then(r => r.data),
      "tradingApi"
    );
  },

  /**
   * Start (or restart) a bot on an explicit venue account (C3a).
   * The account and size are required: with many accounts per user the
   * backend refuses to guess which one trades.
   *
   * X4: `walletProof` is a signed single-use challenge (see `useWalletProof`);
   * required by the backend when WALLET_PROOF_REQUIRED is on.
   */
  async startBot(
    strategyId: string,
    exchangeAccountId: string,
    notionalAmount: number,
    walletProof?: WalletProofPayload
  ) {
    const response = await httpClient
      .getClient()
      .post("/api/bot/management/start", {
        strategyId,
        exchangeAccountId,
        notionalAmount,
        ...(walletProof ? { walletProof } : {}),
      });
    return response.data;
  },

  async stopBot(botId: string, walletProof?: WalletProofPayload) {
    const response = await httpClient
      .getClient()
      .post("/api/bot/management/stop", {
        botId,
        ...(walletProof ? { walletProof } : {}),
      });
    return response.data;
  },

  /**
   * Resume a bot that a lost engine parked in UNKNOWN/ERROR (P0, 2026-10-05).
   *
   * NOT the same as `startBot`: that endpoint takes a strategy + account and
   * always INSERTS a new bot, so calling it on a crashed bot would quietly
   * create a SECOND live bot on the same venue account. Resume re-drives the
   * existing botId so the engine rehydrates from its own snapshot.
   */
  async resumeBot(botId: string, walletProof?: WalletProofPayload) {
    const response = await httpClient
      .getClient()
      .post("/api/bot/management/resume", {
        botId,
        ...(walletProof ? { walletProof } : {}),
      });
    return response.data;
  },

  /**
   * Emergency stop (M1). `action` selects the venue-side cleanup scope; the
   * panic button omits it and the backend applies FULL_SHUTDOWN (cancel every
   * order + flatten the position).
   */
  async emergencyStop(botId: string, action?: EmergencyStopAction) {
    const response = await httpClient
      .getClient()
      .post("/api/bot/management/emergency-stop", {
        botId,
        ...(action ? { action } : {}),
      });
    return response.data;
  },

  /**
   * Ledger trades (the platform's own fills) with optional account/strategy
   * scoping — the read model behind the Dashboard "all accounts" table and
   * the strategy-card fills list. Latest-N semantics (default 50, cap 200);
   * distinct from the per-account venue proxy `getKodiakTrades`.
   */
  async getLedgerTrades(
    filters: {
      exchangeAccountId?: string;
      strategyId?: string;
      limit?: number;
    } = {}
  ) {
    const params = new URLSearchParams();
    if (filters.exchangeAccountId)
      params.set("exchangeAccountId", filters.exchangeAccountId);
    if (filters.strategyId) params.set("strategyId", filters.strategyId);
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return globalRequestManager.deduplicateRequest(
      `trades:ledger:${qs}`,
      () =>
        httpClient
          .getClient()
          .get(`/api/trades${qs ? `?${qs}` : ""}`)
          .then(r => r.data),
      "tradingApi"
    );
  },
};
