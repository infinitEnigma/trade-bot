/**
 * Bot Runtime Domain Types
 *
 * Core domain types for the trading engine bot lifecycle.
 * These types are exchange-agnostic and used across the application layer.
 *
 * @format
 */

import { BotActualState, EngineCredentials } from "@trade-bot/shared";
import { GridTradingStrategy } from "../strategies/grid";
import { ExchangeClient } from "../domain/exchange";

/**
 * Runtime state for a running bot instance.
 *
 * `exchangeClient` is the exchange-agnostic `ExchangeClient` contract
 * (workstream B4) — the concrete adapter lives behind the client factory.
 */
export interface BotRuntime {
  botId: string;
  strategyId: string;
  userId: string;
  state: BotActualState;
  strategy: GridTradingStrategy;
  stopTick: () => void;
  exchangeClient: ExchangeClient;
}

/**
 * Result of credential fetch operation — the backend's exchange-agnostic
 * credential envelope (see shared EngineCredentials). The credential fetcher
 * validates the wire shape before it reaches the exchange client factory.
 */
export type FetchCredentialsResult = EngineCredentials;

/**
 * Persistent engine identity - survives restarts.
 */
export interface EngineIdentity {
  engineId: string;
  epoch: number;
}

/**
 * Callback for cancelling bot initialization.
 */
export type CancellationChecker = (botId: string) => boolean;
