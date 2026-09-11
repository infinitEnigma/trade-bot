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
      //logger.info("WebSocket subscription successful", { topic });
    } else {
      logger.error("WebSocket subscription failed", undefined, { topic, message });
    }
  }

  /**
   * Handle market data messages
   */
  private async handleMarketData(message: BaseWebSocketMessage): Promise<void> {
    const topic = message.topic;

    //logger.debug("Processing market data message", { topic });

    try {
      if (isKlineMessage(message) && hasKlineData(message.data)) {
        await this.handleKlineData(message);
        //} else if (isTickerMessage(message) && hasTickerData(message.data)) {
        //  await this.handleTickerData(message.data.symbol, message.data);
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
  /*private async handleTickerData(symbol: string, data: { price?: string; lastPrice?: string; volume?: string; bid?: string; ask?: string; change24h?: string }): Promise<void> {
    try {
      // Remove .e suffix from symbol (Orderly Network uses PERP_BTC_USDC.e format)
      const cleanedSymbol = symbol.replace(/\.e$/, "");

      const tickData: TickData = {
        symbol: cleanedSymbol,
        price: parseFloat(data.price || data.lastPrice || "0"),
        volume: parseFloat(data.volume || "0"),
        timestamp: Date.now(),
        bid: parseFloat(data.bid || "0"),
        ask: parseFloat(data.ask || "0"),
        change24h: parseFloat(data.change24h || "0"),
      };

      // Cache the tick data
      await this.cacheManager.cacheTick(cleanedSymbol, tickData);

      // Broadcast to all clients subscribed to this symbol
      //this.broadcastToSymbol(cleanedSymbol, tickData);

      logger.debug("Ticker data processed and broadcasted", {
        symbol: cleanedSymbol,
        price: tickData.price,
      });
    } catch (error) {
      logger.error("Error handling ticker data", error as Error, { symbol });
      throw error; // Re-throw to propagate to outer catch
    }
  }*/

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
      // Remove .e suffix from symbol (Orderly Network uses PERP_BTC_USDC.e format)
      //const symbol = symbolWithSuffix.replace(/\.e$/, "");
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
        interval,
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

      // Broadcast the new candle to WebSocket clients
      await this.broadcastToKlines(symbol, interval, newCandle as unknown as Record<string, unknown>);

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

      // Remove .e suffix from symbol (Orderly Network uses PERP_BTC_USDC.e format)
      const symbolWithSuffix = (message.topic || "").split("@")[0];
      const symbol = symbolWithSuffix.replace(/\.e$/, "");

      const priceData = {
        symbol,
        price: typeof markPriceData.price === 'number'
          ? markPriceData.price
          : parseFloat(markPriceData.price || "0"),
        timestamp: markPriceData.timestamp || Date.now(),
      };

      // Cache the mark price data
      await this.cacheManager.cacheMarkPrice(symbol, priceData);

      // Broadcast to all clients subscribed to mark price for this symbol
      await this.broadcastToMarkPrice(symbol, priceData as unknown as Record<string, unknown>);

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
   * Broadcast tick data to clients subscribed to a symbol
   */
  /*private async broadcastToSymbol(symbol: string, data: TickData): Promise<void> {
    if (!this.io) {
      logger.warn("Cannot broadcast - Socket.IO server not initialized");
      return;
    }

    try {
      this.io.emit(`market:${symbol}`, data);
      logger.debug("Tick data broadcasted to clients", {
        symbol,
        price: data.price,
      });
    } catch (error) {
      logger.error("Failed to broadcast tick data", error as Error, {
        symbol,
      });
    }
  }*/

  /**
   * Safely emit an event to all connected sockets.
   * Uses direct socket iteration instead of io.emit() to avoid
   * "socket.client.writeToEngine is not a function" errors that occur
   * when polling-transport sockets are in a transitional state.
   */
  private safeEmit(event: string, data: Record<string, unknown>): number {
    if (!this.io) return 0;

    let delivered = 0;
    this.io.sockets.sockets.forEach((socket) => {
      if (!socket.connected) return;
      try {
        socket.emit(event, data);
        delivered++;
      } catch {
        // Socket disconnected mid-emit (polling gap), skip silently
      }
    });
    return delivered;
  }

  /**
   * Broadcast kline data to clients subscribed to klines for a symbol/interval
   */
  private async broadcastToKlines(symbol: string, interval: string, data: Record<string, unknown>): Promise<void> {
    if (!this.io) {
      logger.warn("Cannot broadcast - Socket.IO server not initialized");
      return;
    }

    const delivered = this.safeEmit(`kline:${symbol}:${interval}`, data);
    if (delivered > 0) {
      logger.debug("Kline data broadcasted to clients", { symbol, interval, recipients: delivered });
    }
  }

  /**
   * Broadcast mark price data to clients subscribed to mark price for a symbol
   */
  private async broadcastToMarkPrice(symbol: string, data: Record<string, unknown>): Promise<void> {
    if (!this.io) {
      logger.warn("Cannot broadcast - Socket.IO server not initialized");
      return;
    }

    const delivered = this.safeEmit(`markprice:${symbol}`, data);
    if (delivered > 0) {
      logger.debug("Mark price data broadcasted to clients", { symbol, recipients: delivered });
    }
  }

  /**
   * Send a message to a specific client room
   */
  async broadcastToRoom(room: string, event: string, data: Record<string, unknown>): Promise<boolean> {
    if (!this.io) {
      logger.warn("Cannot broadcast - Socket.IO server not initialized");
      return false;
    }

    try {
      this.io.to(room).emit(event, data);
      logger.debug("Message broadcasted to room", { room, event });
      return true;
    } catch (error) {
      logger.error("Failed to broadcast to room", error as Error, { room, event });
      return false;
    }
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

  /**
   * Clear processing queue for test purposes
   */
  clearProcessingQueue(): void {
    logger.debug("Message handler processing queue cleared");
  }
}