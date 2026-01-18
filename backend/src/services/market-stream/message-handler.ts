/** @format */

import { Server } from "socket.io";
import logger from "../../services/logger";
import { TickData, KlineData } from "./types";
import { CacheManager } from "./cache-manager";
import { errorNotificationService } from "../error-notification";

/**
 * Handles WebSocket message processing and broadcasting
 * Routes incoming market data messages to appropriate handlers and broadcasts to clients
 */
export class MessageHandler {
  private io: Server | null = null;
  private cacheManager: CacheManager;

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
   * Process incoming WebSocket messages from the market data feed
   */
  async handleMessage(message: any): Promise<void> {
    try {
      // Handle authentication responses
      if (message.event === "auth" || message.method === "AUTH") {
        this.handleAuthResponse(message);
        return;
      }

      // Handle subscription responses
      if (message.event === "subscribed" || message.method === "SUBSCRIBE") {
        this.handleSubscriptionResponse(message);
        return;
      }

      // Handle market data messages
      if (message.topic && message.data) {
        await this.handleMarketData(message);
        return;
      }

      // Log unhandled messages for debugging
      logger.debug("Unhandled WebSocket message", { message });
    } catch (error) {
      const err = error as Error;
      logger.error("Message handler error", {
        error: err.message,
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
  private handleAuthResponse(message: any): void {
    const isSuccess = message.success || message.code === 0;

    if (isSuccess) {
      logger.info("WebSocket authentication successful");
    } else {
      logger.error("WebSocket authentication failed", { message });
    }
  }

  /**
   * Handle subscription response messages
   */
  private handleSubscriptionResponse(message: any): void {
    const isSuccess = message.success || message.code === 0;
    const topic = message.topic || message.params;

    if (isSuccess) {
      logger.info("WebSocket subscription successful", { topic });
    } else {
      logger.error("WebSocket subscription failed", { topic, message });
    }
  }

  /**
   * Handle market data messages
   */
  private async handleMarketData(message: any): Promise<void> {
    const topic = message.topic;

    logger.debug("Processing market data message", { topic });

    try {
      if (topic.includes("@kline_")) {
        await this.handleKlineData(message);
      } else if (topic === "ticker") {
        await this.handleTickerData(message.data.symbol, message.data);
      } else if (topic.includes("@markprice")) {
        await this.handleMarkPriceData(message);
      } else {
        logger.debug("Unknown market data topic", { topic });
      }
    } catch (error) {
      logger.error("Error processing market data", {
        topic,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle ticker data messages
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

      // Cache the tick data
      await this.cacheManager.cacheTick(symbol, tickData);

      // Broadcast to all clients subscribed to this symbol
      this.broadcastToSymbol(symbol, tickData);

      logger.debug("Ticker data processed and broadcasted", {
        symbol,
        price: tickData.price,
      });
    } catch (error) {
      logger.error("Error handling ticker data", {
        symbol,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle kline/candlestick data messages
   */
  private async handleKlineData(message: any): Promise<void> {
    try {
      const klineData = message.data;
      if (!klineData?.symbol) {
        logger.warn("Invalid kline data format", { message });
        return;
      }

      const [symbol, klinePart] = message.topic.split("@");
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
      logger.error("Error handling kline data", {
        topic: message.topic,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle mark price data messages
   */
  private async handleMarkPriceData(message: any): Promise<void> {
    try {
      const markPriceData = message.data;
      if (!markPriceData?.symbol) {
        logger.warn("Invalid mark price data format", { message });
        return;
      }

      const symbol = message.topic.split("@")[0];
      const priceData = {
        symbol,
        price: parseFloat(markPriceData.price || 0),
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
      logger.error("Error handling mark price data", {
        topic: message.topic,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Broadcast tick data to clients subscribed to a symbol
   */
  private broadcastToSymbol(symbol: string, data: TickData): void {
    if (!this.io) {
      logger.warn("Cannot broadcast - no Socket.io server");
      return;
    }

    // Use subscription-based broadcasting instead of room broadcasting
    // This avoids sending data to clients who haven't explicitly subscribed
    const roomName = `market:${symbol}`;
    this.io.to(roomName).emit(`market:${symbol}`, data);

    logger.debug("Broadcasted tick data to symbol room", {
      symbol,
      room: roomName,
      hasData: !!data,
    });
  }

  /**
   * Broadcast kline data to clients subscribed to klines for a symbol/interval
   */
  private broadcastToKlines(symbol: string, interval: string, data: any): void {
    if (!this.io) {
      logger.warn("Cannot broadcast - no Socket.io server");
      return;
    }

    this.io
      .to(`kline:${symbol}:${interval}`)
      .emit(`kline:${symbol}:${interval}`, data);
  }

  /**
   * Broadcast mark price data to clients subscribed to mark price for a symbol
   */
  private broadcastToMarkPrice(symbol: string, data: any): void {
    if (!this.io) {
      logger.warn("Cannot broadcast - no Socket.io server");
      return;
    }

    this.io.to(`markprice:${symbol}`).emit(`markprice:${symbol}`, data);
  }

  /**
   * Send a message to a specific client room
   */
  broadcastToRoom(room: string, event: string, data: any): void {
    if (!this.io) {
      logger.warn("Cannot broadcast - no Socket.io server");
      return;
    }

    this.io.to(room).emit(event, data);
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
