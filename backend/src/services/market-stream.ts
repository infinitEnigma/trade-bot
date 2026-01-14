/** @format */

import WebSocket from 'ws';
import { Server } from 'socket.io';
import logger from './logger';
import { redisService } from './redis';

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
  private klineSubscriptions: Map<string, { symbol: string, interval: string, topic?: string }> = new Map();
  private readonly RECONNECT_DELAY = 3000; // 3 seconds

  /**
   * Initialize market stream service with Socket.io instance
   */
  setSocketServer(io: Server): void {
    this.io = io;
    logger.info('Market stream service initialized with Socket.io');
  }

  /**
   * Connect to Orderly WebSocket and stream data
   */
  connectToOrderly(symbols: string[]): void {
    symbols.forEach((symbol) => {
      if (this.websockets.has(symbol)) {
        logger.debug('Already connected to symbol', { symbol });
        return;
      }

      this.createOrderlyConnection(symbol);
    });
  }

  /**
   * Connect to Orderly kline WebSocket (public)
   */
  connectToKline(symbol: string, interval: string): void {
    const subscriptionId = `kline_${symbol}_${interval}`;
    if (this.klineSubscriptions.has(subscriptionId)) {
      logger.debug('Already subscribed to kline', { symbol, interval });
      return;
    }

    // Get or create kline WebSocket connection
    let ws = this.websockets.get('kline');
    if (!ws) {
      ws = this.createKlineWebSocket();
      this.websockets.set('kline', ws);
    }

    const topic = `${symbol}@kline_${interval}`;

    // Store subscription info for when connection opens
    this.klineSubscriptions.set(subscriptionId, { symbol, interval, topic });

    // Send subscription message if WebSocket is ready
    if (ws.readyState === WebSocket.OPEN) {
      this.sendKlineSubscription(ws, subscriptionId, topic, symbol, interval);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      // Wait for connection to open
      const originalOnOpen = ws.onopen;
      ws.onopen = (event) => {
        // Call original handler if exists
        if (originalOnOpen) {
          originalOnOpen.call(ws, event);
        }

        // Send all pending subscriptions
        this.sendPendingKlineSubscriptions(ws);
      };
    }

    logger.info('Kline subscription queued', { symbol, interval, topic, readyState: ws.readyState });
  }

  /**
   * Send kline subscription message
   */
  private sendKlineSubscription(
    ws: WebSocket,
    subscriptionId: string,
    topic: string,
    symbol: string,
    interval: string
  ): void {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send kline subscription - WebSocket not open', {
        symbol,
        interval,
        readyState: ws.readyState
      });
      return;
    }

    const subscribeMessage = {
      id: subscriptionId,
      topic: topic,
      event: "subscribe"
    };

    try {
      ws.send(JSON.stringify(subscribeMessage));
      logger.info('Kline subscription sent', { symbol, interval, topic });
    } catch (error) {
      logger.error('Failed to send kline subscription', {
        symbol,
        interval,
        topic,
        error: (error as Error).message
      });
    }
  }

  /**
   * Send all pending kline subscriptions
   */
  private sendPendingKlineSubscriptions(ws: WebSocket): void {
    for (const [subscriptionId, subscription] of this.klineSubscriptions.entries()) {
      if (subscription.topic) {
        this.sendKlineSubscription(
          ws,
          subscriptionId,
          subscription.topic,
          subscription.symbol,
          subscription.interval
        );
      }
    }
  }

  /**
   * Create WebSocket connection to Orderly for market data
   */
  private createOrderlyConnection(symbol: string): void {
    try {
      const wsUrl = `wss://ws-evm.orderly.org/ws/stream/${symbol.toLowerCase()}`;

      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        logger.info('Market WebSocket connected', { symbol });
        this.websockets.set(symbol, ws);

        // Clear reconnect timer if exists
        const timer = this.reconnectIntervals.get(symbol);
        if (timer) {
          clearTimeout(timer);
          this.reconnectIntervals.delete(symbol);
        }
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const tickData = JSON.parse(data.toString());
          this.handleMarketData(symbol, tickData);
        } catch (error) {
          logger.error('Market WebSocket message parse error', {
            symbol,
            error: (error as Error).message,
          });
        }
      });

      ws.on('error', (error: Error) => {
        logger.error('Market WebSocket error', { symbol, error: error.message });
      });

      ws.on('close', () => {
        logger.warn('Market WebSocket disconnected', { symbol });
        this.websockets.delete(symbol);

        // Attempt reconnect after delay
        this.scheduleReconnect(symbol);
      });
    } catch (error) {
      logger.error('Market WebSocket connection failed', {
        symbol,
        error: (error as Error).message,
      });

      this.scheduleReconnect(symbol);
    }
  }

  /**
   * Create dedicated WebSocket for kline data
   */
  private createKlineWebSocket(): WebSocket {
    const ws = new WebSocket('wss://ws-evm.orderly.org/ws/stream');

    ws.on('open', () => {
      logger.info('Kline WebSocket connected');
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleKlineData(message);
      } catch (error) {
        logger.error('Kline WebSocket message parse error', {
          error: (error as Error).message,
        });
      }
    });

    ws.on('error', (error: Error) => {
      logger.error('Kline WebSocket error', { error: error.message });
    });

    ws.on('close', () => {
      logger.warn('Kline WebSocket disconnected');
      // Attempt reconnect
      setTimeout(() => {
        if (!this.websockets.has('kline')) {
          this.createKlineWebSocket();
        }
      }, this.RECONNECT_DELAY);
    });

    return ws;
  }

  /**
   * Handle incoming market data and broadcast to clients
   */
  private async handleMarketData(
    symbol: string,
    data: any
  ): Promise<void> {
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

      // Cache latest tick in Redis for latecomer clients
      await redisService.setex(
        `tick:${symbol}`,
        60,
        JSON.stringify(tickData)
      );

      // Broadcast to all connected Socket.io clients
      if (this.io) {
        this.io.emit(`market:${symbol}`, tickData);
      }

      logger.debug('Market data broadcasted', { symbol, price: tickData.price });
    } catch (error) {
      logger.error('Handle market data error', {
        symbol,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle incoming kline data per Orderly docs format
   */
  private async handleKlineData(message: any): Promise<void> {
    try {
      // Check if this is a kline message
      if (message.topic && message.topic.includes('@kline_') && message.data) {
        const klineData: KlineData = message.data;

        // Cache key: kline:PERP_BTC_USDC:1h
        const cacheKey = `kline:${klineData.symbol}:${klineData.type}`;

        // Get existing klines from cache
        const existing = await redisService.get(cacheKey);
        let klines = existing ? JSON.parse(existing) : [];

        // Add new kline in chart format
        const newKline = {
          time: klineData.startTime / 1000, // Convert to Unix timestamp
          open: parseFloat(klineData.open.toString()),
          high: parseFloat(klineData.high.toString()),
          low: parseFloat(klineData.low.toString()),
          close: parseFloat(klineData.close.toString()),
          volume: parseFloat(klineData.volume.toString()),
        };

        // Add to array and keep only last 300 klines
        klines.push(newKline);
        klines = klines.slice(-300);

        // Cache for 1 hour
        await redisService.setex(cacheKey, 3600, JSON.stringify(klines));

        // Broadcast to connected clients
        if (this.io) {
          this.io.emit(`kline:${klineData.symbol}:${klineData.type}`, klineData);
        }

        logger.debug('Kline data cached and broadcasted', {
          symbol: klineData.symbol,
          interval: klineData.type,
          count: klines.length
        });
      }
    } catch (error) {
      logger.error('Handle kline data error', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(symbol: string): void {
    // Avoid duplicate reconnect timers
    if (this.reconnectIntervals.has(symbol)) {
      return;
    }

    const timer = setTimeout(() => {
      logger.info('Attempting reconnect', { symbol });
      this.reconnectIntervals.delete(symbol);
      this.createOrderlyConnection(symbol);
    }, this.RECONNECT_DELAY);

    this.reconnectIntervals.set(symbol, timer);
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
   * Disconnect from symbol
   */
  disconnect(symbol: string): void {
    const ws = this.websockets.get(symbol);
    if (ws) {
      ws.close();
      this.websockets.delete(symbol);
      logger.info('WebSocket disconnected', { symbol });
    }

    const timer = this.reconnectIntervals.get(symbol);
    if (timer) {
      clearTimeout(timer);
      this.reconnectIntervals.delete(symbol);
    }
  }

  /**
   * Disconnect all websockets (shutdown)
   */
  disconnectAll(): void {
    this.websockets.forEach((ws, symbol) => {
      this.disconnect(symbol);
    });

    this.reconnectIntervals.forEach((timer) => {
      clearTimeout(timer);
    });
    this.reconnectIntervals.clear();

    logger.info('All market streams disconnected');
  }

  /**
   * Get connection status
   */
  getStatus(): {
    connected: number;
    symbols: string[];
    klineSubscriptions: number;
  } {
    return {
      connected: this.websockets.size,
      symbols: Array.from(this.websockets.keys()),
      klineSubscriptions: this.klineSubscriptions.size,
    };
  }
}

export const marketStreamService = new MarketStreamService();
