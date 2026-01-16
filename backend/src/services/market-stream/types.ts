/** @format */

/**
 * Core types and interfaces for market stream functionality
 * Shared across all market stream modules
 */

export interface TickData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
  bid: number;
  ask: number;
  change24h: number;
}

export interface KlineData {
  symbol: string;
  type: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  startTime: number;
  endTime: number;
}

/**
 * Circuit breaker states for WebSocket reconnection
 */
export enum CircuitState {
  CLOSED = 'closed',     // Normal operation, reconnections allowed
  OPEN = 'open',         // Circuit open, stop retrying
  HALF_OPEN = 'half_open' // Testing if service recovered
}

/**
 * WebSocket connection configuration
 */
export interface WebSocketConfig {
  baseUrl: string;
  minReconnectDelay: number;
  maxReconnectDelay: number;
  maxReconnectAttempts: number;
  circuitBreakerTimeout: number;
  heartbeatInterval: number;
}

/**
 * Default WebSocket configuration
 */
export const DEFAULT_WS_CONFIG: WebSocketConfig = {
  baseUrl: 'wss://ws-evm.orderly.org/ws/stream',
  minReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  maxReconnectAttempts: 12,
  circuitBreakerTimeout: 5 * 60 * 1000, // 5 minutes
  heartbeatInterval: 30000, // 30 seconds
};

/**
 * Subscription cleanup delays by topic type
 */
export interface SubscriptionConfig {
  markPriceDelay: number;
  klineShortDelay: number;
  klineHourDelay: number;
  tickerDelay: number;
  defaultDelay: number;
}

export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  markPriceDelay: 30000,    // 30 seconds
  klineShortDelay: 60000,   // 1 minute
  klineHourDelay: 300000,   // 5 minutes
  tickerDelay: 120000,      // 2 minutes
  defaultDelay: 60000,      // 1 minute
};

/**
 * Market data topics and their types
 */
export enum MarketTopicType {
  TICKER = 'ticker',
  KLINE = 'kline',
  MARK_PRICE = 'markprice',
}

export interface MarketTopic {
  symbol: string;
  type: MarketTopicType;
  interval?: string; // For kline topics (1m, 5m, etc.)
  topic: string;     // Full topic string (e.g., "BTC_USDC@kline_1m")
}

/**
 * Subscription statistics
 */
export interface SubscriptionStats {
  activeSubscriptions: number;
  totalReferences: number;
  topics: string[];
}

/**
 * Market stream service status
 */
export interface MarketStreamStatus {
  connected: boolean;
  websockets: string[];
  pendingSubscriptions: number;
  activeHeartbeats: number;
  subscriptionStats: SubscriptionStats;
}
