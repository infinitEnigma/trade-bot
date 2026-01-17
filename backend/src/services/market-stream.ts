/** @format */

import WebSocket from "ws";
import { Server } from "socket.io";
import logger from "./logger";
import { redisService } from "./redis";
import { query } from "../database/pool";

interface TickData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
  bid: number;
  ask: number;
  change24h: number;
}

interface KlineData {
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

// ===========================================
// SUB-COMPONENTS FOR MARKET STREAM SERVICE
// ===========================================

/**
 * Circuit breaker states for WebSocket reconnection
 */
enum CircuitState {
  CLOSED = "closed", // Normal operation, reconnections allowed
  OPEN = "open", // Circuit open, stop retrying
  HALF_OPEN = "half_open", // Testing if service recovered
}

/**
 * Manages WebSocket connections, reconnections, and heartbeats
 */
class WebSocketManager {
  private websockets: Map<string, WebSocket> = new Map();
  private reconnectIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private circuitStates: Map<string, CircuitState> = new Map();
  private lastFailureTime: Map<string, number> = new Map();
  private circuitBreakerTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private readonly BASE_URL = "wss://ws-evm.orderly.org/ws/stream";
  private readonly MIN_RECONNECT_DELAY = 1000;
  private readonly MAX_RECONNECT_DELAY = 30000;
  private readonly MAX_RECONNECT_ATTEMPTS = 12; // Stop after 12 attempts (~30 minutes)
  private readonly CIRCUIT_BREAKER_TIMEOUT = 5 * 60 * 1000; // 5 minutes before trying again

  async createConnection(accountId: string): Promise<WebSocket> {
    if (this.websockets.has("market")) {
      logger.debug("Market WebSocket already exists");
      return this.websockets.get("market")!;
    }

    const wsUrl = `${this.BASE_URL}/${accountId}`;
    logger.info("Connecting to Orderly market WebSocket", {
      url: wsUrl,
      accountId,
    });

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        logger.info("Orderly market WebSocket connected successfully");
        this.websockets.set("market", ws);
        this.reconnectAttempts.set("market", 0);
        // Reset circuit breaker on successful connection
        this.circuitStates.set("market", CircuitState.CLOSED);
        this.startHeartbeat("market", ws);
        resolve(ws);
      });

      ws.on("error", (error: Error) => {
        logger.error("Orderly market WebSocket error", {
          error: error.message,
        });
        reject(error);
      });

      ws.on("close", (code: number, reason: string) => {
        logger.warn("Orderly market WebSocket closed", { code, reason });
        this.websockets.delete("market");
        this.stopHeartbeat("market");
        this.scheduleReconnect("market");
      });

      ws.on("pong", () => {
        logger.debug("Heartbeat pong received from Orderly");
      });
    });
  }

  getConnection(): WebSocket | null {
    return this.websockets.get("market") || null;
  }

  isConnected(): boolean {
    const ws = this.websockets.get("market");
    return ws ? ws.readyState === WebSocket.OPEN : false;
  }

  private startHeartbeat(wsKey: string, ws: WebSocket): void {
    this.stopHeartbeat(wsKey);
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        logger.debug("Heartbeat ping sent", { wsKey });
      } else {
        clearInterval(heartbeat);
        this.heartbeatIntervals.delete(wsKey);
      }
    }, 30000);
    this.heartbeatIntervals.set(wsKey, heartbeat);
  }

  private stopHeartbeat(wsKey: string): void {
    const heartbeat = this.heartbeatIntervals.get(wsKey);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeatIntervals.delete(wsKey);
    }
  }

  private calculateBackoff(wsKey: string): number {
    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    const exponentialDelay = Math.min(
      this.MIN_RECONNECT_DELAY * Math.pow(2, Math.min(attempts, 5)),
      this.MAX_RECONNECT_DELAY
    );
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }

  private scheduleReconnect(wsKey: string): void {
    if (this.reconnectIntervals.has(wsKey)) return;

    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    const circuitState = this.circuitStates.get(wsKey) || CircuitState.CLOSED;

    // Check if circuit breaker is open (stop retrying)
    if (circuitState === CircuitState.OPEN) {
      const lastFailure = this.lastFailureTime.get(wsKey) || 0;
      const timeSinceFailure = Date.now() - lastFailure;

      // If enough time has passed, try half-open state
      if (timeSinceFailure >= this.CIRCUIT_BREAKER_TIMEOUT) {
        logger.info("Circuit breaker transitioning to half-open", {
          wsKey,
          timeSinceFailureMs: timeSinceFailure,
        });
        this.circuitStates.set(wsKey, CircuitState.HALF_OPEN);
        this.reconnectAttempts.set(wsKey, 0); // Reset attempts for half-open
      } else {
        logger.debug("Circuit breaker open, skipping reconnect", {
          wsKey,
          attempts,
          timeSinceFailureMs: timeSinceFailure,
          remainingMs: this.CIRCUIT_BREAKER_TIMEOUT - timeSinceFailure,
        });
        return;
      }
    }

    // Check if we've exceeded maximum retry attempts
    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        "Maximum reconnection attempts exceeded, opening circuit breaker",
        {
          wsKey,
          attempts,
          maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
        }
      );
      this.circuitStates.set(wsKey, CircuitState.OPEN);
      this.lastFailureTime.set(wsKey, Date.now());

      // Schedule circuit breaker reset
      this.scheduleCircuitBreakerReset(wsKey);
      return;
    }

    const delay = this.calculateBackoff(wsKey);
    logger.info("Scheduling reconnect", {
      wsKey,
      attempt: attempts + 1,
      maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
      delayMs: Math.round(delay),
      circuitState,
    });

    const timer = setTimeout(async () => {
      logger.info("Attempting reconnect", { wsKey, attempt: attempts + 1 });
      this.reconnectIntervals.delete(wsKey);
      this.reconnectAttempts.set(wsKey, attempts + 1);
      // Note: reconnection logic will be handled by the main service
    }, delay);

    this.reconnectIntervals.set(wsKey, timer);
  }

  private scheduleCircuitBreakerReset(wsKey: string): void {
    if (this.circuitBreakerTimeouts.has(wsKey)) return;

    logger.info("Scheduling circuit breaker reset", {
      wsKey,
      resetDelayMs: this.CIRCUIT_BREAKER_TIMEOUT,
    });

    const timer = setTimeout(() => {
      logger.info("Circuit breaker reset timeout reached", { wsKey });
      this.circuitBreakerTimeouts.delete(wsKey);
      // Note: circuit breaker will transition to half-open on next reconnect attempt
    }, this.CIRCUIT_BREAKER_TIMEOUT);

    this.circuitBreakerTimeouts.set(wsKey, timer);
  }

  disconnect(wsKey: string): void {
    const ws = this.websockets.get(wsKey);
    if (ws) {
      ws.close();
      this.websockets.delete(wsKey);
    }

    const timer = this.reconnectIntervals.get(wsKey);
    if (timer) {
      clearTimeout(timer);
      this.reconnectIntervals.delete(wsKey);
    }

    this.stopHeartbeat(wsKey);
    this.reconnectAttempts.delete(wsKey);
    logger.info("WebSocket disconnected", { wsKey });
  }

  disconnectAll(): void {
    this.websockets.forEach((ws, wsKey) => this.disconnect(wsKey));
    this.reconnectIntervals.forEach(timer => clearTimeout(timer));
    this.reconnectIntervals.clear();
    this.heartbeatIntervals.forEach(timer => clearInterval(timer));
    this.heartbeatIntervals.clear();
    this.reconnectAttempts.clear();
    // Clear circuit breaker state
    this.circuitStates.clear();
    this.lastFailureTime.clear();
    this.circuitBreakerTimeouts.forEach(timer => clearTimeout(timer));
    this.circuitBreakerTimeouts.clear();
    logger.info("All WebSocket connections and circuit breaker state cleared");
  }
}

/**
 * Handles WebSocket authentication
 */
class AuthManager {
  async authenticate(ws: WebSocket, accountId: string): Promise<void> {
    try {
      const credsResult = await query(
        "SELECT api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE account_id = $1",
        [accountId]
      );

      if (credsResult.rows.length === 0) {
        throw new Error("No credentials found for WebSocket authentication");
      }

      const { encryptionService } = await import("./encryption.js");
      const apiKey = encryptionService.decryptApiKey(
        credsResult.rows[0].api_key_encrypted
      );
      const secretKey = encryptionService.decryptSecretKey(
        credsResult.rows[0].secret_key_encrypted
      );

      const timestamp = Date.now();
      const message = `${timestamp}GET/ws/auth${accountId}`;

      const bs58 = await import("bs58");
      const ed25519 = await import("@noble/ed25519");

      const privateKey = bs58.default.decode(secretKey);
      const messageBytes = new TextEncoder().encode(message);
      const signature = await ed25519.sign(messageBytes, privateKey);
      const signatureB64 = Buffer.from(signature).toString("base64url");

      const authMessage = JSON.stringify({
        event: "auth",
        id: `auth_${Date.now()}`,
        params: { accountId, apiKey, signature: signatureB64, timestamp },
      });

      ws.send(authMessage);
      logger.info("WebSocket authentication message sent", { accountId });
    } catch (error) {
      logger.error("Failed to send WebSocket authentication", {
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

/**
 * Manages data caching and retrieval
 */
class CacheManager {
  async cacheTick(symbol: string, data: TickData): Promise<void> {
    const result = await redisService.setex(
      `tick:${symbol}`,
      60,
      JSON.stringify(data)
    );
    if (!result.success) {
      logger.warn("Tick cache write failed", {
        symbol,
        error: result.error,
      });
    }
  }

  async getTick(symbol: string): Promise<TickData | null> {
    const result = await redisService.get(`tick:${symbol}`);
    if (result.success && result.data) {
      return JSON.parse(result.data);
    } else if (!result.success) {
      logger.warn("Tick cache read failed", {
        symbol,
        error: result.error,
      });
    }
    return null;
  }

  async cacheKlines(
    symbol: string,
    interval: string,
    klines: any[]
  ): Promise<void> {
    const cacheKey = `kline:${symbol}:${interval}`;
    const result = await redisService.setex(
      cacheKey,
      3600,
      JSON.stringify(klines)
    );
    if (!result.success) {
      logger.warn("Klines cache write failed", {
        symbol,
        interval,
        error: result.error,
      });
    }
  }

  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 300
  ): Promise<any[]> {
    const cacheKey = `kline:${symbol}:${interval}`;
    const result = await redisService.get(cacheKey);
    if (result.success && result.data) {
      const klines = JSON.parse(result.data);
      return klines.slice(-limit);
    } else if (!result.success) {
      logger.warn("Klines cache read failed", {
        symbol,
        interval,
        error: result.error,
      });
    }
    return [];
  }

  async cacheMarkPrice(symbol: string, data: any): Promise<void> {
    const cacheKey = `markprice:${symbol}`;
    const result = await redisService.setex(cacheKey, 30, JSON.stringify(data));
    if (!result.success) {
      logger.warn("Mark price cache write failed", {
        symbol,
        error: result.error,
      });
    }
  }

  async getMarkPrice(symbol: string): Promise<any | null> {
    const cacheKey = `markprice:${symbol}`;
    const result = await redisService.get(cacheKey);
    if (result.success && result.data) {
      return JSON.parse(result.data);
    } else if (!result.success) {
      logger.warn("Mark price cache read failed", {
        symbol,
        error: result.error,
      });
    }
    return null;
  }
}

/**
 * Handles WebSocket message processing and routing
 */
class MessageHandler {
  private io: Server | null = null;
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  setSocketServer(io: Server): void {
    this.io = io;
  }

  async handleMessage(message: any): Promise<void> {
    try {
      // Handle authentication responses
      if (message.event === "auth" || message.method === "AUTH") {
        if (message.success || message.code === 0) {
          logger.info("WebSocket authentication successful");
        } else {
          logger.error("WebSocket authentication failed", { message });
        }
        return;
      }

      // Handle subscription responses
      if (message.event === "subscribed" || message.method === "SUBSCRIBE") {
        if (message.success || message.code === 0) {
          logger.info("WebSocket subscription successful", {
            topic: message.topic || message.params,
          });
        } else {
          logger.error("WebSocket subscription failed", { message });
        }
        return;
      }

      // Handle market data messages
      if (message.topic && message.data) {
        const topic = message.topic;
        logger.info("Processing market data message", { topic });

        if (topic.includes("@kline_")) {
          await this.handleKlineData(message);
        } else if (topic === "ticker") {
          await this.handleTickerData(message.data.symbol, message.data);
        } else if (topic.includes("@markprice")) {
          await this.handleMarkPriceData(message);
        } else {
          logger.debug("Unhandled message topic", { topic });
        }
      }
    } catch (error) {
      logger.error("Handle message error", { error: (error as Error).message });
    }
  }

  private async handleTickerData(symbol: string, data: any): Promise<void> {
    try {
      const tickData: TickData = {
        symbol,
        price: parseFloat(data.price || data.lastPrice || 0),
        volume: parseFloat(data.volume || 0),
        timestamp: Date.now(),
        bid: parseFloat(data.bid || 0),
        ask: parseFloat(data.ask || 0),
        change24h: parseFloat(data.change24h || 0),
      };

      await this.cacheManager.cacheTick(symbol, tickData);

      if (this.io) {
        this.io.emit(`market:${symbol}`, tickData);
      }

      logger.debug("Ticker data cached and broadcasted", {
        symbol,
        price: tickData.price,
      });
    } catch (error) {
      logger.error("Handle ticker data error", {
        symbol,
        error: (error as Error).message,
      });
    }
  }

  private async handleMarkPriceData(message: any): Promise<void> {
    try {
      const markPriceData = message.data;
      if (!markPriceData?.symbol) {
        logger.error("Invalid mark price data format", { message });
        return;
      }

      const symbol = message.topic.split("@")[0];
      const priceData = {
        symbol,
        price: parseFloat(markPriceData.price || 0),
        timestamp: markPriceData.timestamp || Date.now(),
      };

      await this.cacheManager.cacheMarkPrice(symbol, priceData);

      if (this.io) {
        this.io.emit(`markprice:${symbol}`, priceData);
      }

      logger.debug("Mark price data cached and broadcasted", {
        symbol,
        price: priceData.price,
      });
    } catch (error) {
      logger.error("Handle mark price data error", {
        error: (error as Error).message,
      });
    }
  }

  private async handleKlineData(message: any): Promise<void> {
    try {
      const klineData = message.data;
      if (!klineData?.symbol) {
        logger.error("Invalid kline data format", { message });
        return;
      }

      const [symbol, klinePart] = message.topic.split("@");
      const interval = klinePart.replace("kline_", "");

      const newCandle = {
        time: Math.floor(klineData.startTime / 1000),
        open: parseFloat(klineData.open.toString()),
        high: parseFloat(klineData.high.toString()),
        low: parseFloat(klineData.low.toString()),
        close: parseFloat(klineData.close.toString()),
        volume: parseFloat(klineData.volume.toString()),
      };

      const existingKlines = await this.cacheManager.getKlines(
        symbol,
        interval,
        300
      );
      const updatedKlines = [...existingKlines, newCandle]
        .filter(
          (candle, index, arr) =>
            arr.findIndex(c => c.time === candle.time) === index
        )
        .slice(-300);

      await this.cacheManager.cacheKlines(symbol, interval, updatedKlines);

      if (this.io) {
        this.io.emit(`kline:${symbol}:${interval}`, { ...klineData, interval });
      }

      logger.debug("Kline data cached and broadcasted", {
        symbol,
        interval,
        candleCount: updatedKlines.length,
      });
    } catch (error) {
      logger.error("Handle kline data error", {
        error: (error as Error).message,
      });
    }
  }
}

/**
 * Manages subscriptions with reference counting and cleanup
 */
class SubscriptionManager {
  private activeSubscriptions: Map<
    string,
    { count: number; lastUsed: number }
  > = new Map();
  private subscriptionTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingSubscriptions: Set<string> = new Set();

  subscribe(clientId: string, topic: string): void {
    const existing = this.activeSubscriptions.get(topic);
    const now = Date.now();

    if (existing) {
      existing.count += 1;
      existing.lastUsed = now;
      logger.debug("Subscription reference incremented", {
        topic,
        count: existing.count,
        clientId,
      });
    } else {
      this.activeSubscriptions.set(topic, { count: 1, lastUsed: now });
      logger.info("New subscription activated", { topic, clientId });
    }

    const cleanupTimer = this.subscriptionTimers.get(topic);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.subscriptionTimers.delete(topic);
    }
  }

  unsubscribe(clientId: string, topic: string): void {
    const existing = this.activeSubscriptions.get(topic);
    if (!existing) {
      logger.warn("Attempted to unsubscribe from non-existent topic", {
        topic,
        clientId,
      });
      return;
    }

    existing.count -= 1;
    existing.lastUsed = Date.now();

    if (existing.count <= 0) {
      const cleanupDelay = this.getCleanupDelay(topic);
      const cleanupTimer = setTimeout(() => {
        this.cleanupSubscription(topic);
      }, cleanupDelay);

      this.subscriptionTimers.set(topic, cleanupTimer);
      logger.debug("Subscription scheduled for cleanup", {
        topic,
        delay: cleanupDelay,
      });
    } else {
      logger.debug("Subscription reference decremented", {
        topic,
        count: existing.count,
        clientId,
      });
    }
  }

  getPendingSubscriptions(): string[] {
    return Array.from(this.pendingSubscriptions);
  }

  addPendingSubscription(topic: string): void {
    this.pendingSubscriptions.add(topic);
  }

  clearPendingSubscription(topic: string): void {
    this.pendingSubscriptions.delete(topic);
  }

  private getCleanupDelay(topic: string): number {
    if (topic.includes("@markprice")) return 30000;
    if (topic.includes("@kline_1m") || topic.includes("@kline_5m"))
      return 60000;
    if (topic.includes("@kline_1h")) return 300000;
    if (topic.includes("@ticker")) return 120000;
    return 60000;
  }

  private cleanupSubscription(topic: string): void {
    this.activeSubscriptions.delete(topic);
    this.pendingSubscriptions.delete(topic);
    logger.info("Subscription cleaned up", { topic });
  }

  getStats(): {
    activeSubscriptions: number;
    totalReferences: number;
    topics: string[];
  } {
    const topics = Array.from(this.activeSubscriptions.keys());
    const totalReferences = Array.from(
      this.activeSubscriptions.values()
    ).reduce((sum, sub) => sum + sub.count, 0);

    return {
      activeSubscriptions: this.activeSubscriptions.size,
      totalReferences,
      topics,
    };
  }

  clearAll(): void {
    this.activeSubscriptions.clear();
    this.subscriptionTimers.forEach(timer => clearTimeout(timer));
    this.subscriptionTimers.clear();
    this.pendingSubscriptions.clear();
  }
}

export class MarketStreamService {
  private wsManager: WebSocketManager;
  private authManager: AuthManager;
  private cacheManager: CacheManager;
  private messageHandler: MessageHandler;
  private subscriptionManager: SubscriptionManager;
  private io: Server | null = null;

  constructor() {
    this.wsManager = new WebSocketManager();
    this.authManager = new AuthManager();
    this.cacheManager = new CacheManager();
    this.messageHandler = new MessageHandler(this.cacheManager);
    this.subscriptionManager = new SubscriptionManager();
  }

  /**
   * Initialize market stream service with Socket.io instance
   */
  setSocketServer(io: Server): void {
    this.io = io;
    this.messageHandler.setSocketServer(io);
    logger.info("Market stream service initialized with Socket.io");
  }

  /**
   * Connect to Orderly public market WebSocket
   * Uses: wss://ws-evm.orderly.org/ws/stream/public
   */
  async connectToOrderly(symbols: string[]): Promise<void> {
    logger.info("connectToOrderly called with symbols", { symbols });

    try {
      // Get account ID for WebSocket URL
      const accountResult = await query(
        "SELECT account_id FROM kodiak_credentials LIMIT 1"
      );
      if (accountResult.rows.length === 0) {
        logger.error("No account found for WebSocket connection");
        return;
      }

      const accountId = accountResult.rows[0].account_id;
      const ws = await this.wsManager.createConnection(accountId);

      // Authenticate the connection
      await this.authManager.authenticate(ws, accountId);

      // Set up message handling
      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.messageHandler.handleMessage(message);
        } catch (error) {
          logger.error("Failed to parse WebSocket message", {
            error: (error as Error).message,
          });
        }
      });

      // Queue subscriptions for these symbols
      symbols.forEach(symbol => {
        const topic = `${symbol}@kline_1m`;
        this.subscriptionManager.addPendingSubscription(topic);
        logger.info("Added topic to pending subscriptions", { symbol, topic });
      });

      // Send pending subscriptions
      this.sendPendingSubscriptions();
    } catch (error) {
      logger.error("Failed to connect to Orderly", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Send all pending subscriptions
   */
  private sendPendingSubscriptions(): void {
    const ws = this.wsManager.getConnection();
    if (!ws || !this.wsManager.isConnected()) {
      logger.warn("Cannot send subscriptions - WebSocket not connected");
      return;
    }

    const topics = this.subscriptionManager.getPendingSubscriptions();
    logger.info("Sending pending subscriptions", {
      count: topics.length,
      topics,
    });

    topics.forEach(topic => {
      this.subscribeToTopic(ws, topic);
      this.subscriptionManager.clearPendingSubscription(topic);
    });
  }

  /**
   * Send subscription message for a topic
   */
  private subscribeToTopic(ws: WebSocket, topic: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn("Cannot subscribe - WebSocket not open", {
        topic,
        readyState: ws.readyState,
      });
      return;
    }

    try {
      const message = JSON.stringify({
        id: `sub_${topic}_${Date.now()}`,
        event: "subscribe",
        topic: topic,
      });

      ws.send(message);
      logger.info("Subscription message sent to Orderly", { topic });
    } catch (error) {
      logger.error("Failed to send subscription", {
        topic,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Connect to Orderly kline stream
   * Kline topics: kline_1m, kline_5m, kline_15m, kline_30m, kline_1h, kline_1d, kline_1w, kline_1M
   * @deprecated Use subscribe() instead for better resource management
   */
  connectToKline(symbol: string, interval: string): void {
    const topic = `${symbol}@kline_${interval}`;
    this.subscriptionManager.subscribe("legacy-client", topic);
  }

  /**
   * Connect to Orderly mark price stream
   * Mark price topics: {symbol}@markprice (push interval: 1s)
   * @deprecated Use subscribe() instead for better resource management
   */
  connectToMarkPrice(symbol: string): void {
    const topic = `${symbol}@markprice`;
    this.subscriptionManager.subscribe("legacy-client", topic);
  }

  /**
   * Subscribe to market data with reference counting
   */
  subscribe(
    clientId: string,
    topic: string,
    options: { priority?: "high" | "medium" | "low" } = {}
  ): void {
    this.subscriptionManager.subscribe(clientId, topic);
  }

  /**
   * Unsubscribe from market data with reference counting
   */
  unsubscribe(clientId: string, topic: string): void {
    this.subscriptionManager.unsubscribe(clientId, topic);
  }

  /**
   * Get latest tick data from cache
   */
  async getLatestTick(symbol: string): Promise<TickData | null> {
    return this.cacheManager.getTick(symbol);
  }

  /**
   * Get kline data from cache
   */
  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 300
  ): Promise<any[]> {
    return this.cacheManager.getKlines(symbol, interval, limit);
  }

  /**
   * Get latest mark price data from cache
   */
  async getLatestMarkPrice(symbol: string): Promise<any | null> {
    return this.cacheManager.getMarkPrice(symbol);
  }

  /**
   * Disconnect all connections (shutdown)
   */
  disconnectAll(): void {
    this.wsManager.disconnectAll();
    this.subscriptionManager.clearAll();
    logger.info("Market stream service disconnected");
  }

  /**
   * Get service status
   */
  getStatus(): any {
    return {
      connected: this.wsManager.isConnected() ? 1 : 0,
      websockets: this.wsManager.isConnected() ? ["market"] : [],
      pendingSubscriptions:
        this.subscriptionManager.getPendingSubscriptions().length,
      activeHeartbeats: 0, // Simplified
      ...this.subscriptionManager.getStats(),
    };
  }
}

export const marketStreamService = new MarketStreamService();
