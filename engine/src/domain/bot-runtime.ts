/**
 * Bot Runtime Domain Types
 *
 * Core domain types for the trading engine bot lifecycle.
 * These types are exchange-agnostic and used across the application layer.
 *
 * @format
 */

import { BotActualState } from '@trade-bot/shared';
import { GridTradingStrategy } from '../strategies/grid';
import { OrderlyClient } from '../exchanges/kodiak/client';

/**
 * Runtime state for a running bot instance.
 */
export interface BotRuntime {
    botId: string;
    strategyId: string;
    userId: string;
    state: BotActualState;
    strategy: GridTradingStrategy;
    stopTick: () => void;
    orderlyClient: OrderlyClient;
}

/**
 * Result of credential fetch operation.
 */
export interface FetchCredentialsResult {
    accountId: string;
    accessKey: string;
    secretKey: string;
}

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
