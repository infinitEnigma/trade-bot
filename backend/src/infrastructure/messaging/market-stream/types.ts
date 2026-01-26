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

export interface MarkPriceData {
  symbol: string;
  price: number;
  timestamp: number;
  fundingRate?: number;
}

/**
 * WebSocket Message Types for ORDERLY API
 * Based on ORDERLY WebSocket API documentation
 */

// Base message interface
export interface BaseWebSocketMessage {
  id?: string;
  event?: string;
  method?: string;
  topic?: string;
  data?: unknown;
  success?: boolean;
  code?: number;
  errorMsg?: string;
  ts?: number;
}

// Authentication messages
export interface AuthRequestMessage extends BaseWebSocketMessage {
  event: "auth";
  params: {
    orderly_key: string;
    sign: string;
    timestamp: number;
  };
}

export interface AuthResponseMessage extends BaseWebSocketMessage {
  event: "auth";
  success: boolean;
  ts: number;
}

// Subscription messages
export interface SubscriptionRequestMessage extends BaseWebSocketMessage {
  id: string;
  topic: string;
  event: "subscribe" | "unsubscribe";
}

export interface SubscriptionResponseMessage extends BaseWebSocketMessage {
  id: string;
  event: "subscribe" | "unsubscribe";
  success: boolean;
  ts: number;
  errorMsg?: string;
}

// Market data messages
export interface TickerMessage extends BaseWebSocketMessage {
  topic: "ticker";
  ts: number;
  data: {
    symbol: string;
    price?: string;
    lastPrice?: string;
    volume?: string;
    bid?: string;
    ask?: string;
    change24h?: string;
  };
}

export interface KlineMessage extends BaseWebSocketMessage {
  topic: string; // e.g., "BTC_USDC@kline_1m"
  ts: number;
  data: {
    symbol: string;
    type: string;
    open: string;
    close: string;
    high: string;
    low: string;
    volume: string;
    amount: string;
    startTime: string;
    endTime: string;
  };
}

export interface MarkPriceMessage extends BaseWebSocketMessage {
  topic: string; // e.g., "PERP_ETH_USDC@markprice"
  ts: number;
  data: {
    symbol: string;
    price: string;
  };
}

// Error message
export interface ErrorMessage extends BaseWebSocketMessage {
  id: string;
  event: string;
  success: false;
  ts: number;
  errorMsg: string;
}

// Union types for message discrimination
export type WebSocketMessage =
  | AuthRequestMessage
  | AuthResponseMessage
  | SubscriptionRequestMessage
  | SubscriptionResponseMessage
  | TickerMessage
  | KlineMessage
  | MarkPriceMessage
  | ErrorMessage;

// Type guards for message discrimination
export function isAuthMessage(message: BaseWebSocketMessage): message is AuthRequestMessage | AuthResponseMessage {
  return (message.event === "auth" || message.method === "AUTH") && message !== undefined;
}

export function isSubscriptionMessage(message: BaseWebSocketMessage): message is SubscriptionRequestMessage | SubscriptionResponseMessage {
  return (message.event === "subscribe" || message.event === "unsubscribe" ||
    message.event === "subscribed" || message.method === "SUBSCRIBE") && message !== undefined;
}

export function isMarketDataMessage(message: BaseWebSocketMessage): message is TickerMessage | KlineMessage | MarkPriceMessage {
  return !!(message?.topic && message?.data);
}

export function isTickerMessage(message: BaseWebSocketMessage): message is TickerMessage {
  return message?.topic === "ticker";
}

export function isKlineMessage(message: BaseWebSocketMessage): message is KlineMessage {
  return message?.topic?.includes("@kline_") === true;
}

export function isMarkPriceMessage(message: BaseWebSocketMessage): message is MarkPriceMessage {
  return message?.topic?.includes("@markprice") === true;
}

// Helper type guards for data property access
export function hasTickerData(data: unknown): data is { symbol: string; price?: string; lastPrice?: string; volume?: string; bid?: string; ask?: string; change24h?: string } {
  return typeof data === 'object' && data !== null && 'symbol' in data;
}

export function hasKlineData(data: unknown): data is { symbol: string; type: string; open: string; close: string; high: string; low: string; volume: string; amount: string; startTime: string; endTime: string } {
  return typeof data === 'object' && data !== null && 'symbol' in data && 'open' in data && 'close' in data;
}

export function hasMarkPriceData(data: unknown): data is { symbol: string; price: string; timestamp?: number } {
  return typeof data === 'object' && data !== null && 'symbol' in data && 'price' in data;
}

/**
 * Circuit breaker states for WebSocket reconnection
 */
export enum CircuitState {
  CLOSED = "closed", // Normal operation, reconnections allowed
  OPEN = "open", // Circuit open, stop retrying
  HALF_OPEN = "half_open", // Testing if service recovered
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
  baseUrl: "wss://ws-evm.orderly.org/ws/stream",
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
  markPriceDelay: 30000, // 30 seconds
  klineShortDelay: 60000, // 1 minute
  klineHourDelay: 300000, // 5 minutes
  tickerDelay: 120000, // 2 minutes
  defaultDelay: 60000, // 1 minute
};

/**
 * Market data topics and their types
 */
export enum MarketTopicType {
  TICKER = "ticker",
  KLINE = "kline",
  MARK_PRICE = "markprice",
}

export interface MarketTopic {
  symbol: string;
  type: MarketTopicType;
  interval?: string; // For kline topics (1m, 5m, etc.)
  topic: string; // Full topic string (e.g., "BTC_USDC@kline_1m")
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
