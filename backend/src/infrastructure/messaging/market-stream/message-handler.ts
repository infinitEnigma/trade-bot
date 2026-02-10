/** @format */

import { Server } from "socket.io";
import { marketStreamLogger as logger } from "../../../core/logging/context-aware-logger.service";
import {
  TickData,
  KlineData,
  BaseWebSocketMessage,
  isAuthMessage,
  isSubscriptionMessage,
  isMarketDataMessage,
  isTickerMessage,
  isKlineMessage,
  isMarkPriceMessage,
  hasTickerData,
  hasKlineData,
  hasMarkPriceData
} from "./types";
import { CacheManager } from "./cache-manager";
import { errorNotificationService } from "../../../core/notifications";
import { WebSocketManager, MessagePriority } from "./websocket-manager";

/**
 * Handles WebSocket message processing and broadcasting
 * Routes incoming market data messages to appropriate handlers and broadcasts to clients
 * Uses queue-based backpressure for flow control
 */
export class MessageHandler {
  private io: Server | null = null;
  private cacheManager: CacheManager;
  private wsManager: WebSocketManager | null = null;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Set the Socket.io server instance for broadcasting
   */
  setSocketServer(io: Server): void {
    this.io = io;
    logger.debug("Message handler Socket.io server set");
  }

  /**
   * Set the WebSocket manager for backpressure-aware messaging
   */
  setWebSocketManager(wsManager: WebSocketManager): void {
    this.wsManager = wsManager;
    logger.debug("Message handler WebSocket manager set for backpressure handling");
  }

  /**
   * Process incoming WebSocket messages from the market data feed
   */
  async handleMessage(message: BaseWebSocketMessage): Promise<void> {
    try {
      // Handle authentication responses
      if (isAuthMessage(message)) {
        this.handleAuthResponse(message);
        return;
      }

      // Handle subscription responses
      if (isSubscriptionMessage(message)) {
        this.handleSubscriptionResponse(message);
        return;
      }

      // Handle market data messages
      if (isMarketDataMessage(message)) {
        await this.handleMarketData(message);
        return;
      }

      // Log unhandled messages for debugging
      logger.debug("Unhandled WebSocket message", { message });
    } catch (error) {
      const err = error as Error;
      logger.error("Message handler error", err, {
        messageType: message?.event || message?.method,
        topic: message?.topic,
      });

      // Notify about critical background task failures
      await errorNotificationService.notifyBackgroundFailure(
        "websocket_message_processing",
        err,
        {
          messageType: message?.event || message?.method,
          topic: message?.topic,
          hasSocketServer: this.io !== null,
        }
      );
    }
  }

  /**
   * Handle authentication response messages
   */
  private handleAuthResponse(message: BaseWebSocketMessage): void {
    const isSuccess = message.success || message.code === 0;

    if (isSuccess) {
      logger.info("WebSocket authentication successful");
    } else {
      logger.error("WebSocket authentication failed", undefined, { message });
    }
  }

  /**
   * Handle subscription response messages
   */
  private handleSubscriptionResponse(message: BaseWebSocketMessage): void {
    const isSuccess = message.success || message.code === 0;
    const topic = message.topic || (message as Record<string, unknown>).params;

    if (isSuccess) {
      logger.info("WebSocket subscription successful", { topic });
    } else {
      logger.error("WebSocket subscription failed", undefined, { topic, message });
    }
  }

  /**
   * Handle market data messages
   */
  private async handleMarketData(message: BaseWebSocketMessage): Promise<void> {
    const topic = message.topic;

    logger.debug("Processing market data message", { topic });

    try {
      if (isKlineMessage(message) && hasKlineData(message.data)) {
        await this.handleKlineData(message);
      } else if (isTickerMessage(message) && hasTickerData(message.data)) {
        await this.handleTickerData(message.data.symbol, message.data);
      } else if (isMarkPriceMessage(message) && hasMarkPriceData(message.data)) {
        await this.handleMarkPriceData(message);
      } else {
        logger.debug("Unknown market data topic", { topic });
      }
    } catch (error) {
      logger.error("Error processing market data", error as Error, { topic });
      throw error; // Re-throw to propagate to outer catch
    }
  }

  /**
   * Handle ticker data messages
   */
  private async handleTickerData(symbol: string, data: { price?: string; lastPrice?: string; volume?: string; bid?: string; ask?: string; change24h?: string }): Promise<void> {
    try {
      const tickData: TickData = {
        symbol,
        price: parseFloat(data.price || data.lastPrice || "0"),
        volume: parseFloat(data.volume || "0"),
        timestamp: Date.now(),
        bid: parseFloat(data.bid || "0"),
        ask: parseFloat(data.ask || "0"),
        change24h: parseFloat(data.change24h || "0"),
      };

      // Cache the tick data
      await this.cacheManager.cacheTick(symbol, tickData);

      // Broadcast to all clients subscribed to this symbol
      this.broadcastToSymbol(symbol, tickData);

      logger.debug("Ticker data processed and broadcasted", {
        symbol,
        price: tickData.price,
      });
    } catch (error) {
      logger.error("Error handling ticker data", error as Error, { symbol });
      throw error; // Re-throw to propagate to outer catch
    }
  }

  /**
   * Handle kline/candlestick data messages
   */
  private async handleKlineData(message: BaseWebSocketMessage): Promise<void> {
    try {
      const klineData = message.data;
      if (!hasKlineData(klineData)) {
        logger.warn("Invalid kline data format", { message });
        return;
      }

      const [symbol, klinePart] = (message.topic || "").split("@");
      const interval = klinePart.replace("kline_", "");

      const newCandle: KlineData = {
        symbol,
        type: "kline",
        open: parseFloat(klineData.open?.toString() || "0"),
        close: parseFloat(klineData.close?.toString() || "0"),
        high: parseFloat(klineData.high?.toString() || "0"),
        low: parseFloat(klineData.low?.toString() || "0"),
        volume: parseFloat(klineData.volume?.toString() || "0"),
        amount: parseFloat(klineData.amount?.toString() || "0"),
        startTime: parseInt(klineData.startTime?.toString() || "0"),
        endTime: parseInt(klineData.endTime?.toString() || "0"),
      };

      // Get existing klines and add the new one
      const existingKlines = await this.cacheManager.getKlines(
        symbol,
        interval,
        300
      );
      const updatedKlines = [...existingKlines, newCandle]
        .filter(
          (candle, index, arr) =>
            arr.findIndex(c => c.startTime === candle.startTime) === index
        )
        .slice(-300);

      // Cache the updated klines
      await this.cacheManager.cacheKlines(symbol, interval, updatedKlines);

      // Broadcast the new candle
      const broadcastData = { ...klineData, interval };
      this.broadcastToKlines(symbol, interval, broadcastData);

      logger.debug("Kline data processed and broadcasted", {
        symbol,
        interval,
        candleCount: updatedKlines.length,
      });
    } catch (error) {
      logger.error("Error handling kline data", error as Error, {
        topic: message.topic ?? "unknown",
      });
      throw error; // Re-throw to propagate to outer catch
    }
  }

  /**
   * Handle mark price data messages
   */
  private async handleMarkPriceData(message: BaseWebSocketMessage): Promise<void> {
    try {
      const markPriceData = message.data;
      if (!hasMarkPriceData(markPriceData)) {
        logger.warn("Invalid mark price data format", { message });
        return;
      }

      const symbol = (message.topic || "").split("@")[0];
      const priceData = {
        symbol,
        price: parseFloat(markPriceData.price || "0"),
        timestamp: markPriceData.timestamp || Date.now(),
      };

      // Cache the mark price data
      await this.cacheManager.cacheMarkPrice(symbol, priceData);

      // Broadcast to all clients subscribed to mark price for this symbol
      this.broadcastToMarkPrice(symbol, priceData);

      logger.debug("Mark price data processed and broadcasted", {
        symbol,
        price: priceData.price,
      });
    } catch (error) {
      logger.error("Error handling mark price data", error as Error, {
        topic: message.topic ?? "unknown",
      });
      throw error; // Re-throw to propagate to outer catch
    }
  }

  /**
   * Broadcast tick data to clients subscribed to a symbol with backpressure handling
   */
  private async broadcastToSymbol(symbol: string, data: TickData): Promise<void> {
    if (!this.wsManager) {
      logger.warn("Cannot broadcast - no WebSocket manager with backpressure support");
      return;
    }

    // Use backpressure-aware messaging with HIGH priority for real-time market data
    const success = await this.wsManager.sendMessage(
      "market",
      `market:${symbol}`,
      data,
      MessagePriority.HIGH // Real-time market data gets high priority
    );

    if (!success) {
      logger.warn("Failed to queue tick data message", {
        symbol,
        hasData: !!data,
      });
    } else {
      logger.debug("Tick data queued for broadcast with backpressure handling", {
        symbol,
        priority: MessagePriority.HIGH,
      });
    }
  }

  /**
   * Broadcast kline data to clients subscribed to klines for a symbol/interval
   */
  private async broadcastToKlines(symbol: string, interval: string, data: Record<string, unknown>): Promise<void> {
    if (!this.wsManager) {
      logger.warn("Cannot broadcast - no WebSocket manager with backpressure support");
      return;
    }

    // Kline data gets MEDIUM priority (less critical than real-time ticks)
    const success = await this.wsManager.sendMessage(
      "market",
      `kline:${symbol}:${interval}`,
      data,
      MessagePriority.MEDIUM
    );

    if (!success) {
      logger.warn("Failed to queue kline data message", {
        symbol,
        interval,
      });
    }
  }

  /**
   * Broadcast mark price data to clients subscribed to mark price for a symbol
   */
  private async broadcastToMarkPrice(symbol: string, data: Record<string, unknown>): Promise<void> {
    if (!this.wsManager) {
      logger.warn("Cannot broadcast - no WebSocket manager with backpressure support");
      return;
    }

    // Mark price data gets MEDIUM priority
    const success = await this.wsManager.sendMessage(
      "market",
      `markprice:${symbol}`,
      data,
      MessagePriority.MEDIUM
    );

    if (!success) {
      logger.warn("Failed to queue mark price data message", {
        symbol,
      });
    }
  }

  /**
   * Send a message to a specific client room with backpressure handling
   */
  async broadcastToRoom(room: string, event: string, data: Record<string, unknown>, priority: MessagePriority = MessagePriority.MEDIUM): Promise<boolean> {
    if (!this.wsManager) {
      logger.warn("Cannot broadcast - no WebSocket manager with backpressure support");
      return false;
    }

    return await this.wsManager.sendMessage("market", event, data, priority);
  }

  /**
   * Get message handler statistics
   */
  getStats(): {
    hasSocketServer: boolean;
    activeRooms: string[];
  } {
    return {
      hasSocketServer: this.io !== null,
      activeRooms: this.io
        ? Array.from(this.io.sockets.adapter.rooms.keys())
        : [],
    };
  }
}
