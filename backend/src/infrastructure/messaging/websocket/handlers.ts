/** @format */

import { Socket } from "socket.io";
import { WebSocketClient, IMarketStreamService, IRateLimiter, ILogger } from "../../../interfaces/websocket";
import { WebSocketError, WebSocketErrorCode, WEBSOCKET_CONSTANTS, WebSocketUtils } from "./types";

/**
 * WebSocket Event Handlers
 * Handles all WebSocket event processing with proper error handling and rate limiting
 */
export class WebSocketEventHandlers {
    constructor(
        private marketStreamService: IMarketStreamService,
        private rateLimiter: IRateLimiter,
        private logger: ILogger
    ) { }

    /**
     * Handle room subscription
     */
    async handleSubscribe(socket: Socket, room: string): Promise<void> {
        const client = (socket as any).client as WebSocketClient;
        const correlationId = WebSocketUtils.generateCorrelationId();

        try {
            this.logger.debug("Processing subscribe request", {
                socketId: socket.id,
                userId: client.userId,
                room,
                correlationId,
            });

            // Rate limiting check
            if (!this.checkRateLimit(client.userId, "subscribe")) {
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
            if (client.subscriptions.size >= WEBSOCKET_CONSTANTS.SUBSCRIPTIONS.MAX_PER_USER) {
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
                const errorObj = error instanceof Error ? error : new Error(String(error));
                this.logger.error("Unexpected subscription error", errorObj, {
                    socketId: socket.id,
                    userId: client.userId,
                    room,
                    correlationId,
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
        const client = (socket as any).client as WebSocketClient;
        const correlationId = WebSocketUtils.generateCorrelationId();

        try {
            this.logger.debug("Processing unsubscribe request", {
                socketId: socket.id,
                userId: client.userId,
                room,
                correlationId,
            });

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
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.logger.error("Unsubscribe error", errorObj, {
                socketId: socket.id,
                userId: client.userId,
                room,
                correlationId,
            });

            socket.emit("error", {
                event: "unsubscribe",
                error: "Unsubscribe failed",
                code: WebSocketErrorCode.INTERNAL_ERROR,
                correlationId,
            });
        }
    }

    /**
     * Handle market data subscription
     */
    async handleMarketSubscribe(socket: Socket, symbol: string): Promise<void> {
        const client = (socket as any).client as WebSocketClient;
        const correlationId = WebSocketUtils.generateCorrelationId();

        try {
            this.logger.debug("Processing market subscribe request", {
                socketId: socket.id,
                userId: client.userId,
                symbol,
                correlationId,
            });

            // Rate limiting check (market subscriptions cost more)
            if (!this.checkRateLimit(client.userId, "subscribe_market")) {
                throw new WebSocketError(
                    "Rate limit exceeded for market subscription",
                    WebSocketErrorCode.RATE_LIMIT_EXCEEDED,
                    429,
                    { userId: client.userId, symbol, correlationId }
                );
            }

            // Validate symbol format
            if (!WebSocketUtils.isValidSymbol(symbol)) {
                throw new WebSocketError(
                    "Invalid market symbol format",
                    WebSocketErrorCode.INVALID_SUBSCRIPTION,
                    400,
                    { symbol, expectedFormat: "PERP_SYMBOL_USDC", correlationId }
                );
            }

            const room = `market:${symbol}`;

            // Check subscription limits
            if (client.subscriptions.size >= WEBSOCKET_CONSTANTS.SUBSCRIPTIONS.MAX_PER_USER) {
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

            // Join market room
            socket.join(room);
            client.subscriptions.add(room);
            client.lastActivity = new Date();

            // Send latest tick immediately if available
            try {
                const tick = await this.marketStreamService.getLatestTick(symbol);
                if (tick) {
                    socket.emit(room, tick);
                    this.logger.debug("Sent initial tick to subscriber", {
                        socketId: socket.id,
                        symbol,
                        tick,
                        correlationId,
                    });
                }
            } catch (tickError) {
                this.logger.warn("Failed to send initial tick", {
                    socketId: socket.id,
                    symbol,
                    error: (tickError as Error).message,
                    correlationId,
                });
                // Don't fail the subscription for this
            }

            // Connect to Orderly if not already connected
            try {
                await this.marketStreamService.connectToOrderly([symbol]);
                this.logger.debug("Connected to Orderly market stream", {
                    symbol,
                    correlationId,
                });
            } catch (connectError) {
                this.logger.warn("Failed to connect to Orderly", {
                    symbol,
                    error: (connectError as Error).message,
                    correlationId,
                });
                // Subscription still succeeds, data just won't be real-time
            }

            this.logger.info("Client subscribed to market data", {
                socketId: socket.id,
                userId: client.userId,
                symbol,
                room,
                totalSubscriptions: client.subscriptions.size,
                correlationId,
            });

        } catch (error) {
            if (error instanceof WebSocketError) {
                this.logger.warn("Market subscription failed", {
                    socketId: socket.id,
                    userId: client.userId,
                    symbol,
                    error: error.message,
                    code: error.code,
                    correlationId,
                });

                socket.emit("error", {
                    event: "subscribe_market",
                    error: error.message,
                    code: error.code,
                    correlationId,
                });
            } else {
                const errorObj = error instanceof Error ? error : new Error(String(error));
                this.logger.error("Unexpected market subscription error", errorObj, {
                    socketId: socket.id,
                    userId: client.userId,
                    symbol,
                    correlationId,
                });

                socket.emit("error", {
                    event: "subscribe_market",
                    error: "Market subscription failed",
                    code: WebSocketErrorCode.INTERNAL_ERROR,
                    correlationId,
                });
            }
        }
    }

    /**
     * Handle client disconnection
     */
    async handleDisconnect(socket: Socket): Promise<void> {
        const client = (socket as any).client as WebSocketClient;
        const correlationId = WebSocketUtils.generateCorrelationId();

        try {
            this.logger.info("Client disconnected", {
                socketId: socket.id,
                userId: client?.userId,
                userLevel: client?.userLevel,
                subscriptionsCount: client?.subscriptions.size || 0,
                connectedDuration: client ? Date.now() - client.connectedAt.getTime() : 0,
                correlationId,
            });

            // Client cleanup is handled by the connection manager
            // This is just for logging

        } catch (error) {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.logger.error("Disconnect handling error", errorObj, {
                socketId: socket.id,
                correlationId,
            });
        }
    }

    /**
     * Check rate limiting for user actions
     */
    private checkRateLimit(userId: string, action: string): boolean {
        try {
            const cost = WebSocketUtils.calculateRateLimitCost(action);
            return this.rateLimiter.canSubscribe(userId); // Simplified - in real implementation would track tokens
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
