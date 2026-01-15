/** @format */

import WebSocket from 'ws';
import { Server } from 'socket.io';
import logger from './logger';
import { redisService } from './redis';
import { query } from '../database/pool';

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

export class MarketStreamService {
  private websockets: Map<string, WebSocket> = new Map();
  private io: Server | null = null;
  private reconnectIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private pendingSubscriptions: Set<string> = new Set();

  // Dynamic subscription management
  private activeSubscriptions: Map<string, { count: number, lastUsed: number }> = new Map();
  private subscriptionTimers: Map<string, NodeJS.Timeout> = new Map();
  private adaptivePollIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  private readonly BASE_URL = 'wss://ws-evm.orderly.org/ws/stream';
  
  private readonly MIN_RECONNECT_DELAY = 1000; // 1 second
  private readonly MAX_RECONNECT_DELAY = 30000; // 30 seconds

  /**
   * Initialize market stream service with Socket.io instance
   */
  setSocketServer(io: Server): void {
    this.io = io;
    logger.info('Market stream service initialized with Socket.io');
  }

  /**
   * Connect to Orderly public market WebSocket
   * Uses: wss://ws-evm.orderly.org/ws/stream/public
   */
  connectToOrderly(symbols: string[]): void {
    logger.info('connectToOrderly called with symbols', { symbols });

    // Ensure we have a market connection
    if (!this.websockets.has('market')) {
      this.createPublicMarketWebSocket().catch((error) => {
        logger.error('Failed to create market WebSocket connection', { error: error.message });
      });
    }

    // Queue subscriptions for these symbols
    symbols.forEach((symbol) => {
      // Use kline format: PERP_BTC_USDC@kline_1m
      const topic = `${symbol}@kline_1m`;
      logger.info('Adding topic to pending subscriptions', { symbol, topic });
      this.pendingSubscriptions.add(topic);
    });

    // Send if already connected
    const ws = this.websockets.get('market');
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.sendPendingSubscriptions(ws);
    }
  }

  /**
   * Connect to Orderly kline stream
   * Kline topics: kline_1m, kline_5m, kline_15m, kline_30m, kline_1h, kline_1d, kline_1w, kline_1M
   * @deprecated Use subscribe() instead for better resource management
   */
  connectToKline(symbol: string, interval: string): void {
    const topic = `${symbol}@kline_${interval}`;
    this.subscribe('legacy-client', topic, { priority: 'medium' });
  }

  /**
   * Connect to Orderly mark price stream
   * Mark price topics: {symbol}@markprice (push interval: 1s)
   * @deprecated Use subscribe() instead for better resource management
   */
  connectToMarkPrice(symbol: string): void {
    const topic = `${symbol}@markprice`;
    this.subscribe('legacy-client', topic, { priority: 'high' });
  }

  /**
   * Create public market WebSocket connection
   * URL: wss://ws-evm.orderly.org/ws/stream/{account_id}
   */
  private async createPublicMarketWebSocket(): Promise<void> {
    if (this.websockets.has('market')) {
      logger.debug('Market WebSocket already exists');
      return;
    }

    try {
      // For public topics: wss://ws-evm.orderly.org/ws/stream/{account_id}
      // We need an account_id for the WebSocket URL
      // Let's get it from the database - use the first available account
      const accountResult = await query('SELECT account_id FROM kodiak_credentials LIMIT 1');
      if (accountResult.rows.length === 0) {
        logger.error('No account found for WebSocket connection');
        this.scheduleReconnect('market');
        return;
      }

      const accountId = accountResult.rows[0].account_id;
      const wsUrl = `${this.BASE_URL}/${accountId}`;
      logger.info('Connecting to Orderly market WebSocket', { url: wsUrl, accountId });

      const ws = new WebSocket(wsUrl);

      ws.on('open', async () => {
        logger.info('Orderly market WebSocket connected successfully');
        this.websockets.set('market', ws);
        this.reconnectAttempts.set('market', 0); // Reset attempts on success

        // Start heartbeat to keep connection alive
        this.startHeartbeat('market', ws);

        // Send authentication message first
        try {
          await this.sendAuthentication(ws, accountId);
          logger.info('WebSocket authentication sent');

          // Wait a bit for auth response, then subscribe
          setTimeout(() => {
            this.sendPendingSubscriptions(ws);
          }, 1000);
        } catch (error) {
          logger.error('Failed to send WebSocket authentication', { error: (error as Error).message });
          this.scheduleReconnect('market');
        }
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const rawMessage = data.toString();
          logger.debug('Raw WebSocket message received', { length: rawMessage.length, preview: rawMessage.substring(0, 200) });

          const message = JSON.parse(rawMessage);
          logger.info('Parsed WebSocket message', { message: JSON.stringify(message) });
          this.handleWebSocketMessage(message, ws);
        } catch (error) {
          logger.error('Orderly WebSocket message parse error', {
            error: (error as Error).message,
            rawLength: data.toString().length,
            rawData: data.toString().substring(0, 500),
          });
        }
      });

      ws.on('error', (error: Error) => {
        logger.error('Orderly market WebSocket error', {
          code: (error as any).code,
          errno: (error as any).errno,
          message: error.message,
        });
      });

      ws.on('close', (code: number, reason: string) => {
        logger.warn('Orderly market WebSocket closed', {
          code, // 1000=normal close, 1001=going away, 1006=abnormal close
          reason,
          willReconnect: 'yes',
        });
        
        this.websockets.delete('market');
        this.stopHeartbeat('market');
        this.scheduleReconnect('market');
      });

      ws.on('pong', () => {
        logger.debug('Heartbeat pong received from Orderly');
      });

    } catch (error) {
      logger.error('Failed to create Orderly market WebSocket', {
        error: (error as Error).message,
      });
      this.scheduleReconnect('market');
    }
  }

  /**
   * Send WebSocket authentication message
   */
  private async sendAuthentication(ws: WebSocket, accountId: string): Promise<void> {
    try {
      // Get API credentials for authentication
      const credsResult = await query(
        'SELECT api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE account_id = $1',
        [accountId]
      );

      if (credsResult.rows.length === 0) {
        throw new Error('No credentials found for WebSocket authentication');
      }

      const apiKey = require('./encryption').encryptionService.decryptApiKey(
        credsResult.rows[0].api_key_encrypted
      );
      const secretKey = require('./encryption').encryptionService.decryptSecretKey(
        credsResult.rows[0].secret_key_encrypted
      );

      // Create authentication message
      const timestamp = Date.now();
      const message = `${timestamp}GET/ws/auth${accountId}`;

      // Generate signature
      const bs58 = await import("bs58");
      const ed25519 = await import("@noble/ed25519");

      const privateKey = bs58.default.decode(secretKey);
      const messageBytes = new TextEncoder().encode(message);
      const signature = await ed25519.sign(messageBytes, privateKey);
      const signatureB64 = Buffer.from(signature).toString("base64url");

      // Send authentication message - Orderly format
      const authMessage = JSON.stringify({
        event: 'auth',
        id: `auth_${Date.now()}`,  // Add unique ID
        params: {
          accountId,
          apiKey,
          signature: signatureB64,
          timestamp,
        },
      });

      ws.send(authMessage);
      logger.info('WebSocket authentication message sent', { accountId, message: authMessage });
    } catch (error) {
      logger.error('Failed to send WebSocket authentication', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Send subscription message for a topic
   */
  private subscribeToTopic(ws: WebSocket, topic: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe - WebSocket not open', { topic, readyState: ws.readyState });
      return;
    }

    try {
      // Orderly subscription format: { id: 'clientID', event: 'subscribe', topic: 'symbol@type' }
      const message = JSON.stringify({
        id: `sub_${topic}_${Date.now()}`,
        event: 'subscribe',
        topic: topic,
      });

      ws.send(message);
      logger.info('Subscription message sent to Orderly', { topic, message });
    } catch (error) {
      logger.error('Failed to send subscription', {
        topic,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Send all pending subscriptions
   */
  private sendPendingSubscriptions(ws: WebSocket): void {
    if (this.pendingSubscriptions.size === 0) {
      return;
    }

    const topics = Array.from(this.pendingSubscriptions);
    logger.info('Sending pending subscriptions', { count: topics.length, topics });

    for (const topic of topics) {
      this.subscribeToTopic(ws, topic);
    }

    // Note: We keep pending subscriptions because if the connection drops,
    // we need to re-subscribe to all topics on reconnect
  }

  /**
   * Handle incoming WebSocket messages from Orderly
   */
  private async handleWebSocketMessage(message: any, ws: WebSocket): Promise<void> {
    try {
      // Handle authentication responses
      if (message.event === 'auth' || message.method === 'AUTH') {
        if (message.success || message.code === 0) {
          logger.info('WebSocket authentication successful');
        } else {
          logger.error('WebSocket authentication failed', { message });
          this.scheduleReconnect('market');
          return;
        }
        return;
      }

      // Handle subscription responses
      if (message.event === 'subscribed' || message.method === 'SUBSCRIBE') {
        if (message.success || message.code === 0) {
          logger.info('WebSocket subscription successful', { topic: message.topic || message.params });
        } else {
          logger.error('WebSocket subscription failed', { message });
        }
        return;
      }

      // Handle market data messages
      if (message.topic && message.data) {
        const topic = message.topic;
        logger.info('Processing market data message', { topic, dataKeys: Object.keys(message.data) });

        // Handle kline messages: topic = 'PERP_BTC_USDC@kline_1m'
        if (topic.includes('@kline_')) {
          logger.info('Detected kline message, calling handleKlineData', { topic });
          await this.handleKlineData(message);
          return;
        }

        // Handle ticker messages: topic = 'ticker' (symbol in data)
        if (topic === 'ticker') {
          logger.info('Detected ticker message, calling handleTickerData');
          await this.handleTickerData(message.data.symbol, message.data);
          return;
        }

        // Handle mark price messages: topic = 'PERP_BTC_USDC@markprice'
        if (topic.includes('@markprice')) {
          logger.info('Detected mark price message, calling handleMarkPriceData', { topic });
          await this.handleMarkPriceData(message);
          return;
        }

        logger.debug('Unhandled Orderly message topic', { topic });
      } else {
        logger.debug('Received message without topic/data', { keys: Object.keys(message), message });
      }
    } catch (error) {
      logger.error('Handle WebSocket message error', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle ticker data and broadcast via Socket.io
   */
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

      // Cache in Redis for latecomer clients
      await redisService.setex(
        `tick:${symbol}`,
        60,
        JSON.stringify(tickData)
      );

      // Broadcast to Socket.io clients
      if (this.io) {
        this.io.emit(`market:${symbol}`, tickData);
      }

      logger.debug('Ticker data cached and broadcasted', { symbol, price: tickData.price });
    } catch (error) {
      logger.error('Handle ticker data error', {
        symbol,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle mark price data from Orderly
   * Expected format from Orderly: { topic: 'PERP_BTC_USDC@markprice', data: { symbol, price, timestamp } }
   */
  private async handleMarkPriceData(message: any): Promise<void> {
    try {
      const markPriceData = message.data;

      if (!markPriceData || !markPriceData.symbol) {
        logger.error('Invalid mark price data format', { keys: markPriceData ? Object.keys(markPriceData) : 'none', message });
        return;
      }

      // Extract symbol from topic (e.g., 'PERP_BTC_USDC@markprice' -> 'PERP_BTC_USDC')
      const topicParts = message.topic.split('@');
      if (topicParts.length !== 2 || topicParts[1] !== 'markprice') {
        logger.error('Invalid mark price topic format', { topic: message.topic });
        return;
      }

      const symbol = topicParts[0];

      logger.info('Processing mark price data', {
        symbol,
        price: markPriceData.price,
        timestamp: markPriceData.timestamp,
      });

      // Create mark price data structure
      const priceData = {
        symbol,
        price: parseFloat(markPriceData.price || 0),
        timestamp: markPriceData.timestamp || Date.now(),
      };

      // Cache in Redis (short TTL since mark price updates frequently)
      const cacheKey = `markprice:${symbol}`;
      await redisService.setex(cacheKey, 30, JSON.stringify(priceData)); // 30 seconds

      // Broadcast to Socket.io clients
      if (this.io) {
        logger.debug('Broadcasting mark price to Socket.io clients');
        this.io.emit(`markprice:${symbol}`, priceData);
      } else {
        logger.warn('Socket.io not available for mark price broadcasting');
      }

      logger.debug('Mark price data cached and broadcasted', {
        symbol,
        price: priceData.price,
        cacheKey,
      });
    } catch (error) {
      logger.error('Handle mark price data error', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle kline data from Orderly
   * Expected format from Orderly: { topic: 'kline_1h', data: { symbol, open, high, low, close, volume, type, startTime, endTime } }
   */
  private async handleKlineData(message: any): Promise<void> {
    try {
      logger.info('Starting handleKlineData processing');
      const klineData = message.data;

      if (!klineData || !klineData.symbol) {
        logger.error('Invalid kline data format', { keys: klineData ? Object.keys(klineData) : 'none', message });
        return;
      }

      logger.info('Kline data validation passed', { symbol: klineData.symbol, type: klineData.type });

      // Extract symbol and interval from topic (e.g., 'PERP_BTC_USDC@kline_1m' -> symbol: 'PERP_BTC_USDC', interval: '1m')
      // Format: {symbol}@kline_{interval}
      const topicParts = message.topic.split('@');
      if (topicParts.length !== 2) {
        logger.error('Invalid topic format', { topic: message.topic });
        return;
      }

      const [symbol, klinePart] = topicParts;
      if (!klinePart.startsWith('kline_')) {
        logger.error('Invalid kline topic format', { topic: message.topic, klinePart });
        return;
      }

      const interval = klinePart.replace('kline_', ''); // Get '1m' from 'kline_1m'

      logger.info('Parsed topic successfully', { symbol, interval });

      // Verify symbol matches data
      if (symbol !== klineData.symbol) {
        logger.warn('Symbol mismatch in kline data', { topicSymbol: symbol, dataSymbol: klineData.symbol });
      }

      logger.info('Handling kline data', {
        symbol,
        interval,
        close: klineData.close,
        startTime: klineData.startTime,
      });

      // Cache key: kline:PERP_BTC_USDC:1h
      const cacheKey = `kline:${symbol}:${interval}`;
      logger.info('Cache key created', { cacheKey });

      // Get existing klines from cache
      logger.info('Fetching existing klines from Redis');
      const existing = await redisService.get(cacheKey);
      let klines = existing ? JSON.parse(existing) : [];
      logger.info('Existing klines loaded', { count: klines.length });

      // Create candle in chart format
      const newCandle = {
        time: Math.floor(klineData.startTime / 1000), // Convert to Unix timestamp
        open: parseFloat(klineData.open.toString()),
        high: parseFloat(klineData.high.toString()),
        low: parseFloat(klineData.low.toString()),
        close: parseFloat(klineData.close.toString()),
        volume: parseFloat(klineData.volume.toString()),
      };
      logger.info('New candle created', { newCandle });

      // Add to array, remove duplicates by timestamp, and keep only last 300 candles
      klines.push(newCandle);

      // Remove duplicates by timestamp (keep the latest one)
      const seen = new Set();
      klines = klines
        .reverse() // Process from newest to oldest
        .filter((candle: any) => {
          if (seen.has(candle.time)) {
            return false; // Duplicate timestamp, skip
          }
          seen.add(candle.time);
          return true; // Keep this candle
        })
        .reverse() // Back to chronological order
        .slice(-300); // Keep only last 300
      logger.info('Klines array updated', { totalCount: klines.length });

      // Cache for 1 hour
      logger.info('Caching klines in Redis');
      await redisService.setex(cacheKey, 3600, JSON.stringify(klines));
      logger.info('Klines cached successfully');

      // Broadcast to Socket.io clients
      if (this.io) {
        logger.info('Broadcasting to Socket.io clients');
        this.io.emit(`kline:${symbol}:${interval}`, {
          ...klineData,
          interval,
        });
        logger.info('Broadcast completed');
      } else {
        logger.warn('Socket.io not available for broadcasting');
      }

      logger.info('Kline data cached and broadcasted', {
        symbol,
        interval,
        candleCount: klines.length,
      });
    } catch (error) {
      logger.error('Handle kline data error', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(wsKey: string, ws: WebSocket): void {
    this.stopHeartbeat(wsKey);

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        logger.debug('Heartbeat ping sent', { wsKey });
      } else {
        clearInterval(heartbeat);
        this.heartbeatIntervals.delete(wsKey);
      }
    }, 30000); // Ping every 30 seconds

    this.heartbeatIntervals.set(wsKey, heartbeat);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(wsKey: string): void {
    const heartbeat = this.heartbeatIntervals.get(wsKey);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeatIntervals.delete(wsKey);
    }
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(wsKey: string): number {
    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    const exponentialDelay = Math.min(
      this.MIN_RECONNECT_DELAY * Math.pow(2, Math.min(attempts, 5)), // Cap at 2^5 = 32x
      this.MAX_RECONNECT_DELAY
    );
    const jitter = Math.random() * 1000; // 0-1 second random jitter
    return exponentialDelay + jitter;
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(wsKey: string): void {
    if (this.reconnectIntervals.has(wsKey)) {
      logger.debug('Reconnect already scheduled', { wsKey });
      return;
    }

    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    const delay = this.calculateBackoff(wsKey);

    logger.info('Scheduling reconnect', {
      wsKey,
      attempt: attempts + 1,
      delayMs: Math.round(delay),
    });

    const timer = setTimeout(async () => {
      logger.info('Attempting reconnect', { wsKey, attempt: attempts + 1 });
      this.reconnectIntervals.delete(wsKey);
      this.reconnectAttempts.set(wsKey, attempts + 1);
      await this.createPublicMarketWebSocket();
    }, delay);

    this.reconnectIntervals.set(wsKey, timer);
  }

  /**
   * Get latest tick data from cache
   */
  async getLatestTick(symbol: string): Promise<TickData | null> {
    try {
      const cached = await redisService.get(`tick:${symbol}`);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      logger.error('Get latest tick error', { symbol, error });
      return null;
    }
  }

  /**
   * Get kline data from cache
   */
  async getKlines(symbol: string, interval: string, limit: number = 300): Promise<any[]> {
    try {
      // Ensure WebSocket connection is active for this symbol/interval
      this.connectToKline(symbol, interval);

      const cacheKey = `kline:${symbol}:${interval}`;
      const cached = await redisService.get(cacheKey);
      if (cached) {
        const klines = JSON.parse(cached);
        return klines.slice(-limit);
      }
      return [];
    } catch (error) {
      logger.error('Get klines error', { symbol, interval, error });
      return [];
    }
  }

  /**
   * Get latest mark price data from cache
   */
  async getLatestMarkPrice(symbol: string): Promise<any | null> {
    try {
      // Ensure WebSocket connection is active for this symbol
      this.connectToMarkPrice(symbol);

      const cacheKey = `markprice:${symbol}`;
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      logger.error('Get mark price error', { symbol, error });
      return null;
    }
  }

  /**
   * Disconnect from WebSocket
   */
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

    logger.info('WebSocket disconnected', { wsKey });
  }

  /**
   * Disconnect all websockets (shutdown)
   */
  disconnectAll(): void {
    this.websockets.forEach((ws, wsKey) => {
      this.disconnect(wsKey);
    });

    this.reconnectIntervals.forEach((timer) => {
      clearTimeout(timer);
    });
    this.reconnectIntervals.clear();

    this.heartbeatIntervals.forEach((timer) => {
      clearInterval(timer);
    });
    this.heartbeatIntervals.clear();

    this.reconnectAttempts.clear();
    this.pendingSubscriptions.clear();

    // Clean up dynamic subscription management
    this.activeSubscriptions.clear();
    this.subscriptionTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.subscriptionTimers.clear();
    this.adaptivePollIntervals.forEach((timer) => {
      clearInterval(timer);
    });
    this.adaptivePollIntervals.clear();

    logger.info('All market streams disconnected');
  }

  /**
   * Subscribe to market data with reference counting
   * Prevents duplicate subscriptions and manages lifecycle
   */
  subscribe(clientId: string, topic: string, options: { priority?: 'high' | 'medium' | 'low' } = {}): void {
    const existing = this.activeSubscriptions.get(topic);
    const now = Date.now();

    if (existing) {
      // Increment reference count
      existing.count += 1;
      existing.lastUsed = now;
      logger.debug('Subscription reference incremented', { topic, count: existing.count, clientId });
    } else {
      // New subscription
      this.activeSubscriptions.set(topic, { count: 1, lastUsed: now });

      // Start adaptive polling for this topic
      this.startAdaptivePolling(topic, options.priority || 'medium');

      // Send WebSocket subscription if connected
      const ws = this.websockets.get('market');
      if (ws && ws.readyState === WebSocket.OPEN) {
        this.subscribeToTopic(ws, topic);
      } else {
        // Queue for when connection is ready
        this.pendingSubscriptions.add(topic);
      }

      logger.info('New subscription activated', { topic, clientId, priority: options.priority });
    }

    // Clear any cleanup timer for this topic
    const cleanupTimer = this.subscriptionTimers.get(topic);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.subscriptionTimers.delete(topic);
    }
  }

  /**
   * Unsubscribe from market data with reference counting
   * Only unsubscribes when no more clients need the data
   */
  unsubscribe(clientId: string, topic: string): void {
    const existing = this.activeSubscriptions.get(topic);

    if (!existing) {
      logger.warn('Attempted to unsubscribe from non-existent topic', { topic, clientId });
      return;
    }

    existing.count -= 1;
    existing.lastUsed = Date.now();

    if (existing.count <= 0) {
      // No more clients need this data - schedule cleanup
      const cleanupDelay = this.getCleanupDelay(topic);
      const cleanupTimer = setTimeout(() => {
        this.cleanupSubscription(topic);
      }, cleanupDelay);

      this.subscriptionTimers.set(topic, cleanupTimer);
      logger.debug('Subscription scheduled for cleanup', { topic, delay: cleanupDelay });
    } else {
      logger.debug('Subscription reference decremented', { topic, count: existing.count, clientId });
    }
  }

  /**
   * Start adaptive polling based on data type and priority
   */
  private startAdaptivePolling(topic: string, priority: 'high' | 'medium' | 'low'): void {
    // Clear any existing polling for this topic
    const existingInterval = this.adaptivePollIntervals.get(topic);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const pollingInterval = this.getPollingInterval(topic, priority);

    // Only start polling for topics that need it (not pure WebSocket topics)
    if (pollingInterval > 0) {
      const interval = setInterval(() => {
        this.pollDataForTopic(topic);
      }, pollingInterval);

      this.adaptivePollIntervals.set(topic, interval);
      logger.debug('Adaptive polling started', { topic, interval: pollingInterval, priority });
    }
  }

  /**
   * Get appropriate polling interval based on topic type and priority
   */
  private getPollingInterval(topic: string, priority: 'high' | 'medium' | 'low'): number {
    // WebSocket-only topics don't need polling
    if (topic.includes('@kline_') || topic.includes('@markprice')) {
      return 0; // WebSocket handles these
    }

    // HTTP-based topics need polling
    if (topic.includes('@ticker')) {
      // Tickers: high priority = poll every 5s, medium = 15s, low = 60s
      switch (priority) {
        case 'high': return 5000;
        case 'medium': return 15000;
        case 'low': return 60000;
        default: return 30000;
      }
    }

    // Futures data: changes infrequently, poll every 5 minutes
    if (topic.includes('futures:')) {
      return 300000; // 5 minutes
    }

    return 30000; // Default 30 seconds
  }

  /**
   * Get cleanup delay based on topic type
   * High-frequency data should be cleaned up quickly, low-frequency can linger longer
   */
  private getCleanupDelay(topic: string): number {
    if (topic.includes('@markprice')) return 30000; // 30s - high frequency
    if (topic.includes('@kline_1m') || topic.includes('@kline_5m')) return 60000; // 1m - medium frequency
    if (topic.includes('@kline_1h')) return 300000; // 5m - low frequency
    if (topic.includes('@ticker')) return 120000; // 2m - moderate frequency

    return 60000; // Default 1 minute
  }

  /**
   * Poll data for a topic (HTTP-based data that needs refreshing)
   */
  private async pollDataForTopic(topic: string): Promise<void> {
    try {
      // This would be called for HTTP-based topics that need polling
      // For now, WebSocket topics are handled automatically
      logger.debug('Polling data for topic', { topic });
    } catch (error) {
      logger.error('Error polling data for topic', { topic, error: (error as Error).message });
    }
  }

  /**
   * Clean up subscription when no longer needed
   */
  private cleanupSubscription(topic: string): void {
    // Remove from active subscriptions
    this.activeSubscriptions.delete(topic);

    // Stop adaptive polling
    const pollingInterval = this.adaptivePollIntervals.get(topic);
    if (pollingInterval) {
      clearInterval(pollingInterval);
      this.adaptivePollIntervals.delete(topic);
    }

    // Send unsubscribe message if WebSocket is connected
    const ws = this.websockets.get('market');
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.unsubscribeFromTopic(ws, topic);
    }

    // Remove from pending subscriptions
    this.pendingSubscriptions.delete(topic);

    logger.info('Subscription cleaned up', { topic });
  }

  /**
   * Send unsubscribe message for a topic
   */
  private unsubscribeFromTopic(ws: WebSocket, topic: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot unsubscribe - WebSocket not open', { topic, readyState: ws.readyState });
      return;
    }

    try {
      const message = JSON.stringify({
        id: `unsub_${topic}_${Date.now()}`,
        event: 'unsubscribe',
        topic: topic,
      });

      ws.send(message);
      logger.info('Unsubscribe message sent to Orderly', { topic, message });
    } catch (error) {
      logger.error('Failed to send unsubscribe', {
        topic,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Update subscription priority (for when user switches to a chart)
   */
  updateSubscriptionPriority(clientId: string, topic: string, newPriority: 'high' | 'medium' | 'low'): void {
    const existing = this.activeSubscriptions.get(topic);
    if (!existing) {
      logger.warn('Cannot update priority for non-existent subscription', { topic, clientId });
      return;
    }

    // Restart adaptive polling with new priority
    this.startAdaptivePolling(topic, newPriority);
    logger.debug('Subscription priority updated', { topic, clientId, newPriority });
  }

  /**
   * Get subscription statistics
   */
  getSubscriptionStats(): {
    activeSubscriptions: number;
    totalReferences: number;
    topics: string[];
    pollingIntervals: number;
  } {
    const topics = Array.from(this.activeSubscriptions.keys());
    const totalReferences = Array.from(this.activeSubscriptions.values())
      .reduce((sum, sub) => sum + sub.count, 0);

    return {
      activeSubscriptions: this.activeSubscriptions.size,
      totalReferences,
      topics,
      pollingIntervals: this.adaptivePollIntervals.size,
    };
  }

  /**
   * Get connection status
   */
  getStatus(): {
    connected: number;
    websockets: string[];
    pendingSubscriptions: number;
    activeHeartbeats: number;
    activeSubscriptions: number;
    totalReferences: number;
  } {
    const stats = this.getSubscriptionStats();

    return {
      connected: this.websockets.size,
      websockets: Array.from(this.websockets.keys()),
      pendingSubscriptions: this.pendingSubscriptions.size,
      activeHeartbeats: this.heartbeatIntervals.size,
      activeSubscriptions: stats.activeSubscriptions,
      totalReferences: stats.totalReferences,
    };
  }
}

export const marketStreamService = new MarketStreamService();
