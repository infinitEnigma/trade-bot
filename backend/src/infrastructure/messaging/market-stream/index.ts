/** @format */

import WebSocket from "ws";
import { Server } from "socket.io";
import { marketStreamLogger as logger } from "../../../core/logging/context-aware-logger.service";

import { TickData, KlineData, MarketStreamStatus, MarkPriceData } from "./types";
import { WebSocketManager } from "./websocket-manager";
import { AuthManager } from "./auth-manager";
import { CacheManager } from "./cache-manager";
import { SubscriptionManager } from "./subscription-manager";
import { MessageHandler } from "./message-handler";

/**
 * Main market stream service that orchestrates all components
 * Provides high-level API for market data streaming functionality
 */
export class MarketStreamService {
  private wsManager: WebSocketManager;
  private authManager: AuthManager;
  private cacheManager: CacheManager;
  private messageHandler: MessageHandler;
  private subscriptionManager: SubscriptionManager;
  private io: Server | null = null;

  constructor(
    wsManager?: WebSocketManager,
    authManager?: AuthManager,
    cacheManager?: CacheManager,
    messageHandler?: MessageHandler,
    subscriptionManager?: SubscriptionManager
  ) {
    this.wsManager = wsManager || WebSocketManager.createWithAutoCleanup();
    this.authManager = authManager || new AuthManager();
    this.cacheManager = cacheManager || new CacheManager();
    this.subscriptionManager = subscriptionManager || new SubscriptionManager();
    this.messageHandler = messageHandler || new MessageHandler(this.cacheManager);
  }

  /**
   * Destructor to ensure proper cleanup when instance is garbage collected
   */
  [Symbol.dispose](): void {
    this.cleanupForTests();
  }

  /**
   * Initialize market stream service with Socket.io instance
   */
  setSocketServer(io: Server): void {
    this.io = io;
    this.messageHandler.setSocketServer(io);
    this.messageHandler.setWebSocketManager(this.wsManager);
    logger.info("Market stream service initialized with Socket.io and backpressure support");
  }

  /**
   * Connect to Orderly public market WebSocket
   * Uses: wss://ws-evm.orderly.org/ws/stream/public
   */
  async connectToOrderly(symbols: string[]): Promise<void> {
    logger.info("connectToOrderly called with symbols", { symbols });

    try {
      // Get account ID for WebSocket URL
      const accountId = await this.authManager.getAccountId();
      if (!accountId) {
        logger.error("No account found for WebSocket connection");
        return;
      }

      const ws = await this.wsManager.createConnection(accountId);

      // Start queue processor when we have an active connection
      this.wsManager.startQueueProcessor();

      // Authenticate the connection
      await this.authManager.authenticate(ws, accountId);

      // Set up message handling
      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.messageHandler.handleMessage(message);
        } catch (error) {
          logger.error("Failed to parse WebSocket message", error as Error);
        }
      });

      // Queue subscriptions for these symbols (both kline and mark price)
      symbols.forEach(symbol => {
        const klineTopic = `${symbol}@kline_1m`;
        const markPriceTopic = `${symbol}@markprice`;
        this.subscriptionManager.addPendingSubscription(klineTopic);
        this.subscriptionManager.addPendingSubscription(markPriceTopic);
        logger.info("Added topics to pending subscriptions", {
          symbol,
          klineTopic,
          markPriceTopic
        });
      });

      // Send pending subscriptions
      this.sendPendingSubscriptions();
    } catch (error) {
      logger.error("Failed to connect to Orderly", error as Error);
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
        topic,
      });

      ws.send(message);
      logger.info("Subscription message sent to Orderly", { topic });
    } catch (error) {
      logger.error("Failed to send subscription", error as Error, { topic });
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
    topic: string
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
  ): Promise<KlineData[]> {
    return this.cacheManager.getKlines(symbol, interval, limit);
  }

  /**
   * Get latest mark price data from cache
   */
  async getLatestMarkPrice(symbol: string): Promise<MarkPriceData | null> {
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
  getStatus(): MarketStreamStatus {
    const subscriptionStats = this.subscriptionManager.getStats();

    return {
      connected: this.wsManager.isConnected(),
      websockets: this.wsManager.isConnected() ? ["market"] : [],
      pendingSubscriptions:
        this.subscriptionManager.getPendingSubscriptions().length,
      activeHeartbeats: 0, // Simplified - could be enhanced
      subscriptionStats,
    };
  }

  /**
   * Get detailed service statistics
   */
  async getDetailedStats(): Promise<{
    websocket: unknown;
    cache: unknown;
    subscriptions: unknown;
    messageHandler: unknown;
  }> {
    const websocket = this.wsManager.getStats();
    const cache = await this.cacheManager.getStats();
    const subscriptions = this.subscriptionManager.getDetailedStats();
    const messageHandler = this.messageHandler.getStats();

    return {
      websocket,
      cache,
      subscriptions,
      messageHandler,
    };
  }

  /**
   * Cleanup method for test environments
   * Stops all connections, timers, and intervals
   */
  cleanupForTests(): void {
    try {
      // Disconnect all WebSocket connections
      this.wsManager.disconnectAll();

      // Clear all subscriptions
      this.subscriptionManager.clearAll();

      // Clear pending subscriptions
      const pendingSubscriptions = this.subscriptionManager.getPendingSubscriptions();
      pendingSubscriptions.forEach(topic => {
        this.subscriptionManager.clearPendingSubscription(topic);
      });

      // Clear processing queue
      this.messageHandler.clearProcessingQueue();

      // Clear any remaining intervals and timeouts in WebSocket manager
      this.wsManager.cleanupAllIntervals();

      logger.info("Market stream service cleaned up for tests", {
        pendingSubscriptions: pendingSubscriptions.length,
        queueCleared: true,
        intervalsCleared: true,
      });
    } catch (error) {
      logger.error("Error during market stream cleanup", error as Error);
    }
  }
}

// Export singleton instance
export const marketStreamService = new MarketStreamService();
