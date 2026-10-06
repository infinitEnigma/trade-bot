/**
 * Bot Runtime Domain Types
 *
 * Core domain types for the trading engine bot lifecycle.
 * These types are exchange-agnostic and used across the application layer.
 *
 * D3 sessions (plan §D): a session (one exchange account) runs N strategy
 * runs. The runtime holds ONE exchange client and a map of runs, each with
 * its own strategy + tick runner. The legacy single-strategy fields stay
 * during the shim so old call sites keep compiling.
 *
 * @format
 */

import { BotActualState, EngineCredentials } from "@trade-bot/shared";
import { GridTradingStrategy } from "../strategies/grid";
import { ExchangeClient } from "../domain/exchange";

/**
 * One strategy execution inside a session.
 */
export interface StrategyRunState {
  runId: string;
  strategyId: string;
  strategy: GridTradingStrategy;
  stopTick: () => void;
}

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
  /** Trading symbol the runner was started with (config.symbol). */
  symbol: string;
  state: BotActualState;
  strategy: GridTradingStrategy;
  stopTick: () => void;
  exchangeClient: ExchangeClient;
  /**
   * D3 sessions: runs inside this session, keyed by runId. Single-run
   * (shim) sessions carry exactly one entry mirroring the legacy fields.
   */
  runs?: Map<string, StrategyRunState>;
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
