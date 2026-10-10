/** @format */

import { httpClient } from "./client";
import { globalRequestManager } from "../request-manager";
import type { EmergencyStopAction } from "@trade-bot/shared";
import type { WalletProofPayload } from "./wallet";

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
};
