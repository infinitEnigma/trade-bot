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
import { OrderlyClient } from "../exchanges/kodiak/client";

/**
 * Runtime state for a running bot instance.
 *
 * The client field stays typed as the Kodiak adapter until workstream B4
 * decouples the strategy from `OrderlyClient` and widens this to the shared
 * `ExchangeClient` interface.
 */
export interface BotRuntime {
  botId: string;
  strategyId: string;
  userId: string;
  state: BotActualState;
  strategy: GridTradingStrategy;
  stopTick: () => void;
  exchangeClient: OrderlyClient;
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
