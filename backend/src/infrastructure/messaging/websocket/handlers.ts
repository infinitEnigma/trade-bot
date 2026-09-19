/** @format */

import { Socket } from "socket.io";
import {
  WebSocketClient,
  IRateLimiter,
  ILogger,
} from "../../../interfaces/websocket";
import {
  WebSocketError,
  WebSocketErrorCode,
  WEBSOCKET_CONSTANTS,
  WebSocketUtils,
} from "./types";
import { externalTrafficObserver } from "../../external/external-traffic-observer";

/**
 * WebSocket Event Handlers
 * Handles all WebSocket event processing with proper error handling and rate limiting
 */
export class WebSocketEventHandlers {
    constructor(
        private rateLimiter: IRateLimiter,
        private logger: ILogger
    ) { }

    /**
     * Handle room subscription
     */
    async handleSubscribe(socket: Socket, room: string): Promise<void> {
        const client = (socket as unknown as { client: WebSocketClient }).client;
        const correlationId = WebSocketUtils.generateCorrelationId();

        try {
            this.logger.debug("Processing subscribe request", {
                socketId: socket.id,
                userId: client.userId,
                room,
                correlationId,
            });

            // Rate limiting check
            if (!(await this.checkRateLimit(client.userId, "subscribe"))) {
                throw new WebSocketError(
                    "Rate limit exceeded",
                    WebSocketErrorCode.RATE_LIMIT_EXCEEDED,
                    429,
                    { userId: client.userId, socketId: socket.id, correlationId }
                );
            }

            // Validate room name
            if (!WebSocketUtils.isValidTopic(room)) {
                throw new WebSocketError(
                    "Invalid subscription topic",
                    WebSocketErrorCode.INVALID_SUBSCRIPTION,
                    400,
                    { room, correlationId }
                );
            }

            // Check subscription limits
      if (
        client.subscriptions.size >=
        WEBSOCKET_CONSTANTS.SUBSCRIPTIONS.MAX_PER_USER
      ) {
                throw new WebSocketError(
                    "Subscription limit exceeded",
                    WebSocketErrorCode.SUBSCRIPTION_LIMIT_EXCEEDED,
                    429,
                    {
                        currentSubscriptions: client.subscriptions.size,
                        maxSubscriptions: WEBSOCKET_CONSTANTS.SUBSCRIPTIONS.MAX_PER_USER,
                        correlationId,
                    }
                );
            }

            // Subscribe to room
            socket.join(room);
            client.subscriptions.add(room);
            client.lastActivity = new Date();

            this.logger.info("Client subscribed to room", {
                socketId: socket.id,
                userId: client.userId,
                room,
                totalSubscriptions: client.subscriptions.size,
                correlationId,
            });
        } catch (error) {
            if (error instanceof WebSocketError) {
                this.logger.warn("Subscription failed", {
                    socketId: socket.id,
                    userId: client.userId,
                    room,
                    error: error.message,
                    code: error.code,
                    correlationId,
                });

                // Emit error to client
                socket.emit("error", {
                    event: "subscribe",
                    error: error.message,
                    code: error.code,
                    correlationId,
                });
            } else {
        const errorObj =
          error instanceof Error ? error : new Error(String(error));
                this.logger.error("Unexpected subscription error", {
                    socketId: socket.id,
                    userId: client.userId,
                    room,
                    correlationId,
                    error: errorObj,
                });

                socket.emit("error", {
                    event: "subscribe",
                    error: "Subscription failed",
                    code: WebSocketErrorCode.INTERNAL_ERROR,
                    correlationId,
                });
            }
        }
    }

    /**
     * Handle room unsubscription
     */
    async handleUnsubscribe(socket: Socket, room: string): Promise<void> {
        const client = (socket as unknown as { client: WebSocketClient }).client;
        const correlationId = WebSocketUtils.generateCorrelationId();

        try {
            this.logger.debug("Processing unsubscribe request", {
                socketId: socket.id,
                userId: client.userId,
                room,
                correlationId,
            });

            // Validate room name
            if (!WebSocketUtils.isValidTopic(room)) {
                throw new WebSocketError(
                    "Invalid subscription topic",
                    WebSocketErrorCode.INVALID_SUBSCRIPTION,
                    400,
                    { room, correlationId }
                );
            }

            // Check if client is actually subscribed
            if (!client.subscriptions.has(room)) {
                throw new WebSocketError(
                    "Not subscribed to this topic",
                    WebSocketErrorCode.INVALID_SUBSCRIPTION,
                    400,
                    { room, correlationId }
                );
            }

            // Leave room
            socket.leave(room);
            client.subscriptions.delete(room);
            client.lastActivity = new Date();

            this.logger.info("Client unsubscribed from room", {
                socketId: socket.id,
                userId: client.userId,
                room,
                remainingSubscriptions: client.subscriptions.size,
                correlationId,
            });
        } catch (error) {
            if (error instanceof WebSocketError) {
                this.logger.warn("Unsubscribe failed", {
                    socketId: socket.id,
                    userId: client.userId,
                    room,
                    error: error.message,
                    code: error.code,
                    correlationId,
                });

                socket.emit("error", {
                    event: "unsubscribe",
                    error: error.message,
                    code: error.code,
                    correlationId,
                });
            } else {
        const errorObj =
          error instanceof Error ? error : new Error(String(error));
                this.logger.error("Unexpected unsubscribe error", {
                    socketId: socket.id,
                    userId: client.userId,
                    room,
                    correlationId,
                    error: errorObj,
                });

                socket.emit("error", {
                    event: "unsubscribe",
                    error: "Unsubscribe failed",
                    code: WebSocketErrorCode.INTERNAL_ERROR,
                    correlationId,
                });
            }
        }
    }

    /**
     * Handle market data subscription (market streaming not available)
     * Market data is currently served over HTTP (Kodiak REST + cache).
     * Kept as a stub so clients get an explicit, typed error.
     */
    async handleMarketSubscribe(socket: Socket, symbol: string): Promise<void> {
        const client = (socket as unknown as { client?: WebSocketClient }).client;
        const correlationId = WebSocketUtils.generateCorrelationId();

    this.logger.warn(
      "Market data subscription requested but market streaming is not available",
      {
            socketId: socket.id,
            userId: client?.userId,
            symbol,
            correlationId,
      }
    );

        socket.emit("error", {
            event: "subscribe_market",
      error:
        "Market data streaming is not available; market data is served over HTTP",
            code: WebSocketErrorCode.MARKET_DATA_UNAVAILABLE,
            correlationId,
        });
    }

    /**
     * Handle market data unsubscription (market streaming not available)
     */
    async handleMarketUnsubscribe(socket: Socket, symbol: string): Promise<void> {
        const client = (socket as unknown as { client?: WebSocketClient }).client;
        const correlationId = WebSocketUtils.generateCorrelationId();

    this.logger.debug(
      "Market data unsubscribe requested (no-op, streaming not available)",
      {
            socketId: socket.id,
            userId: client?.userId,
            symbol,
            correlationId,
      }
    );
    }

    /**
     * Handle client disconnection
     */
    async handleDisconnect(socket: Socket): Promise<void> {
        const socketWithClient = socket as unknown as { client?: WebSocketClient };
        const client = socketWithClient.client;
        const correlationId = WebSocketUtils.generateCorrelationId();

        try {
            this.logger.info("Client disconnected", {
                socketId: socket.id,
                userId: client?.userId,
                userLevel: client?.userLevel,
                subscriptionsCount: client ? client.subscriptions.size : 0,
        connectedDuration:
          client && client.connectedAt
            ? Date.now() - client.connectedAt.getTime()
            : 0,
                correlationId,
            });

            // Client cleanup is handled by the connection manager
            // This is just for logging
        } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
            this.logger.error("Disconnect handling error", {
                socketId: socket.id,
                correlationId,
                error: errorObj,
            });
        }
    }

    /**
     * Check rate limiting for user actions
     */
  private async checkRateLimit(
    userId: string,
    action: string
  ): Promise<boolean> {
        try {
            const _cost = WebSocketUtils.calculateRateLimitCost(action);
            return await this.rateLimiter.canSubscribe(userId); // Simplified - in real implementation would track tokens
        } catch (error) {
            this.logger.warn("Rate limit check failed", {
                userId,
                action,
                error: (error as Error).message,
            });
            // Fail open - allow action if rate limiter fails
            return true;
        }
    }
}
