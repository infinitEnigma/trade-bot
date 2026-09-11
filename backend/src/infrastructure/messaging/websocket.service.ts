/** @format */

//import { Server as SocketIOServer } from "socket.io";
import { Socket } from "socket.io";
import {
    IWebSocketService,
    WebSocketClient,
    WebSocketMetrics,
    WebSocketConnection,
    IMarketStreamService,
    IAuthService,
    ILogger,
    Server,
} from "../../interfaces/websocket";
import { WebSocketAuthMiddleware } from "./websocket/auth";
import { WebSocketEventHandlers } from "./websocket/handlers";
import { WebSocketError, WEBSOCKET_CONSTANTS } from "./websocket/types";
import { webSocketRateLimiter } from "../security/rate-limiter/websocket-rate-limiter.adapter";

/**
 * WebSocket Service
 * Main service for managing WebSocket connections, authentication, and real-time communication
 */
export class WebSocketService implements IWebSocketService {
    private io: Server | null = null;
    private authMiddleware: WebSocketAuthMiddleware;
    private eventHandlers: WebSocketEventHandlers;
    private clients = new Map<string, WebSocketClient>();
    private startTime = Date.now();

    // Metrics tracking
    private metrics = {
        totalConnections: 0,
        activeConnections: 0,
        messagesProcessed: 0,
        errorsCount: 0,
        lastActivity: Date.now(),
        responseTimes: [] as number[],
    };

    constructor(
        private marketStreamService: IMarketStreamService,
        private authService: IAuthService,
        private logger: ILogger
    ) {
        this.authMiddleware = new WebSocketAuthMiddleware(authService, logger);
        this.eventHandlers = new WebSocketEventHandlers(
            marketStreamService,
            webSocketRateLimiter,
            logger
        );

        this.logger.info("WebSocketService initialized", {
            constants: WEBSOCKET_CONSTANTS,
        });
    }

    /**
     * Initialize the WebSocket service with a Socket.IO server instance
     */
    initialize(io: Server): void {
        if (this.io) {
            throw new Error("WebSocket service already initialized");
        }

        this.io = io;
        this.setupAuthentication();
        this.setupConnectionHandlers();
        this.setupErrorHandling();

        this.logger.info("WebSocket service initialized with Socket.IO server", {
            corsEnabled: true,
            authRequired: true,
        });
    }

    /**
     * Get comprehensive WebSocket metrics
     */
    getMetrics(): WebSocketMetrics {
        const uptime = Date.now() - this.startTime;
        const activeConnections = this.clients.size;

        // Calculate messages per second (rough estimate)
        const messagesPerSecond = uptime > 0 ? (this.metrics.messagesProcessed / (uptime / 1000)) : 0;

        // Calculate error rate (errors per minute)
        const errorRate = uptime > 0 ? (this.metrics.errorsCount / (uptime / 60000)) : 0;

        // Get top subscriptions
        const subscriptionCounts = new Map<string, number>();
        for (const client of this.clients.values()) {
            for (const subscription of client.subscriptions) {
                subscriptionCounts.set(
                    subscription,
                    (subscriptionCounts.get(subscription) || 0) + 1
                );
            }
        }

        const topSubscriptions = Array.from(subscriptionCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([topic, count]) => ({ topic, count }));

        // Calculate average response time
        const averageResponseTime = this.metrics.responseTimes.length > 0
            ? Math.round((this.metrics.responseTimes.reduce((sum, time) => sum + time, 0) / this.metrics.responseTimes.length) * 100) / 100
            : 0;

        // Calculate health score (0-100)
        const healthScore = this.calculateHealthScore(activeConnections, messagesPerSecond, errorRate);

        return {
            activeConnections,
            messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
            errorRate: Math.round(errorRate * 100) / 100,
            topSubscriptions,
            healthScore,
            memoryUsage: this.getMemoryUsage(),
            averageResponseTime,
        };
    }

    /**
     * Get detailed connection information
     */
    getConnections(): WebSocketConnection[] {
        return Array.from(this.clients.values()).map(client => ({
            socketId: client.socketId,
            userId: client.userId,
            userLevel: client.userLevel,
            connectedAt: client.connectedAt,
            lastActivity: client.lastActivity,
            subscriptionCount: client.subscriptions.size,
            ipAddress: client.ipAddress,
        }));
    }

    /**
     * Forcefully disconnect a specific client
     */
    disconnectClient(socketId: string): void {
        const socket = this.io?.sockets.sockets.get(socketId);
        if (socket) {
            socket.disconnect(true);
            this.clients.delete(socketId);
            this.logger.info("Client forcefully disconnected", { socketId });
        } else {
            this.logger.warn("Attempted to disconnect non-existent socket", { socketId });
        }
    }

    /**
     * Set up WebSocket authentication middleware
     */
    private setupAuthentication(): void {
        if (!this.io) return;

        this.io.use(async (socket, next) => {
            try {
                this.logger.debug("WebSocket authentication middleware invoked", {
                    socketId: socket.id,
                    ip: socket.handshake.address,
                    userAgent: socket.handshake.headers["user-agent"],
                });

                const client = await this.authMiddleware.authenticate(socket);
                (socket as unknown as { client: WebSocketClient }).client = client;
                this.clients.set(socket.id, client);
                this.metrics.totalConnections++;
                this.metrics.activeConnections = this.clients.size;

                this.logger.debug("WebSocket authentication successful", {
                    socketId: socket.id,
                    userId: client.userId,
                    userLevel: client.userLevel,
                });

                next();
            } catch (error) {
                if (error instanceof WebSocketError) {
                    this.logger.error("WebSocket authentication failed - service", {
                        socketId: socket.id,
                        error: error.message,
                        code: error.code,
                        ip: socket.handshake.address,
                    });

                    // Emit auth error before disconnecting
                    /*socket.emit("auth_error", {
                        error: error.message,
                        code: error.code,
                    });*/
                } else {
                    const errorObj = error instanceof Error ? error : new Error(String(error));
                    this.logger.error("Unexpected authentication error", {
                        socketId: socket.id,
                        ip: socket.handshake.address,
                        error: errorObj,
                    });
                }

                this.metrics.errorsCount++;
                next(new Error(error instanceof Error ? error.message : "Authentication failed"));
            }
        });
    }

    /**
     * Set up WebSocket connection event handlers
     */
    private setupConnectionHandlers(): void {
        if (!this.io) return;

        this.io.on("connection", async (socket) => {
            const client = (socket as unknown as { client: WebSocketClient }).client;

            this.logger.info("WebSocket client connected", {
                socketId: socket.id,
                userId: client.userId,
                userLevel: client.userLevel,
                ip: client.ipAddress,
                activeConnections: this.clients.size,
            });

            // connectToOrderly requires a user accountId — only available for REGISTERED/VERIFIED users.
            // BASIC users connect via WebSocket to receive any ongoing broadcasts,
            // but they cannot initiate the Orderly stream themselves.
            if (client.userLevel === "REGISTERED" || client.userLevel === "VERIFIED") {
                await this.marketStreamService.connectToOrderly(["PERP_BTC_USDC", "PERP_ETH_USDC"]);
            }

            // Set up event handlers
            socket.on("subscribe", (room: string) => {
                const startTime = Date.now();
                this.metrics.messagesProcessed++;
                this.eventHandlers.handleSubscribe(socket, room)
                    .then(() => {
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        // Keep only last 1000 response times for memory efficiency
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    })
                    .catch(error => {
                        const errorObj = error instanceof Error ? error : new Error(String(error));
                        this.logger.error("Subscribe handler error", {
                            socketId: socket.id,
                            error: errorObj,
                        });
                        this.metrics.errorsCount++;
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    });
            });

            socket.on("unsubscribe", (room: string) => {
                const startTime = Date.now();
                this.metrics.messagesProcessed++;
                this.eventHandlers.handleUnsubscribe(socket, room)
                    .then(() => {
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    })
                    .catch(error => {
                        const errorObj = error instanceof Error ? error : new Error(String(error));
                        this.logger.error("Unsubscribe handler error", {
                            socketId: socket.id,
                            error: errorObj,
                        });
                        this.metrics.errorsCount++;
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    });
            });

            socket.on("subscribe_market", (symbol: string) => {
                const startTime = Date.now();
                this.metrics.messagesProcessed++;
                this.eventHandlers.handleMarketSubscribe(socket, symbol)
                    .then(() => {
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    })
                    .catch(error => {
                        const errorObj = error instanceof Error ? error : new Error(String(error));
                        this.logger.error("Market subscribe handler error", {
                            socketId: socket.id,
                            error: errorObj,
                        });
                        this.metrics.errorsCount++;
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    });
            });

            socket.on("unsubscribe_market", (symbol: string) => {
                const startTime = Date.now();
                this.metrics.messagesProcessed++;
                this.eventHandlers.handleMarketUnsubscribe(socket, symbol)
                    .then(() => {
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    })
                    .catch(error => {
                        const errorObj = error instanceof Error ? error : new Error(String(error));
                        this.logger.error("Market unsubscribe handler error", {
                            socketId: socket.id,
                            error: errorObj,
                        });
                        this.metrics.errorsCount++;
                        this.metrics.responseTimes.push(Date.now() - startTime);
                        if (this.metrics.responseTimes.length > 1000) {
                            this.metrics.responseTimes.shift();
                        }
                    });
            });

            socket.on("disconnect", () => {
                this.handleDisconnect(socket);
            });

            // Update activity timestamp
            this.metrics.lastActivity = Date.now();
        });
    }

    /**
     * Set up global error handling for WebSocket connections
     */
    private setupErrorHandling(): void {
        if (!this.io) return;

        this.io.on("connection_error", (error) => {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.logger.error("WebSocket connection error", {
                message: error instanceof Error ? error.message : String(error),
                context: (error as { context?: unknown })?.context,
                error: errorObj,
            });
            this.metrics.errorsCount++;
        });
    }

    /**
     * Handle client disconnection
     */
    private handleDisconnect(socket: Socket): void {
        const client = (socket as unknown as { client: WebSocketClient }).client;

        if (client) {
            const connectedDuration = Date.now() - client.connectedAt.getTime();

            this.logger.info("WebSocket client disconnected", {
                socketId: socket.id,
                userId: client.userId,
                userLevel: client.userLevel,
                subscriptionsCount: client.subscriptions.size,
                connectedDurationMs: connectedDuration,
                connectedDurationSec: Math.floor(connectedDuration / 1000),
                remainingConnections: this.clients.size - 1,
            });

            this.clients.delete(socket.id);
            this.metrics.activeConnections = this.clients.size;
        } else {
            this.logger.warn("Client disconnected without client data", {
                socketId: socket.id,
                remainingConnections: this.clients.size - 1,
            });
        }
    }

    /**
     * Calculate health score based on various metrics
     */
    private calculateHealthScore(
        activeConnections: number,
        messagesPerSecond: number,
        errorRate: number
    ): number {
        // Base score starts at 100
        let score = 100;

        // Penalize for no activity (unhealthy if no messages in 5 minutes)
        const timeSinceLastActivity = Date.now() - this.metrics.lastActivity;
        if (timeSinceLastActivity > 300000) { // 5 minutes
            score -= 30;
        }

        // Penalize for high error rate
        if (errorRate > 10) score -= 20; // >10 errors per minute
        else if (errorRate > 5) score -= 10; // >5 errors per minute
        else if (errorRate > 1) score -= 5;  // >1 error per minute

        // Penalize for too many connections (potential resource exhaustion)
        if (activeConnections > WEBSOCKET_CONSTANTS.CONNECTIONS.MAX_TOTAL * 0.8) {
            score -= 15;
        }

        // Reward for healthy message throughput
        if (messagesPerSecond > 50) score += 5;
        else if (messagesPerSecond > 10) score += 2;

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Get memory usage for WebSocket connections
     */
    private getMemoryUsage(): number {
        // Rough estimate: each connection uses about 50KB of memory
        return this.clients.size * 50 * 1024; // Convert to bytes
    }

    /**
     * Cleanup method for test environments
     * Disconnects all clients and clears all state
     */
    cleanupForTests(): void {
        try {
            if (this.io) {
                // Disconnect all clients
                this.io.disconnectSockets(true);

                // Clear all client connections
                this.clients.clear();

                // Reset metrics
                this.metrics = {
                    totalConnections: 0,
                    activeConnections: 0,
                    messagesProcessed: 0,
                    errorsCount: 0,
                    lastActivity: Date.now(),
                    responseTimes: [],
                };

                this.logger.info("WebSocket service cleaned up for tests", {
                    disconnectedClients: 0,
                    clearedConnections: 0,
                });
            }
        } catch (error) {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.logger.error("Error during WebSocket cleanup", {
                message: error instanceof Error ? error.message : String(error),
                context: (error as { context?: unknown })?.context,
                error: errorObj,
            });
        }
    }

    /**
     * Get comprehensive service statistics for monitoring
     */
    getStats(): {
        metrics: WebSocketMetrics;
        connections: WebSocketConnection[];
        serviceHealth: {
            status: 'healthy' | 'warning' | 'critical';
            uptime: number;
            memoryUsage: number;
        };
    } {
        return {
            metrics: this.getMetrics(),
            connections: this.getConnections(),
            serviceHealth: {
                status: this.getMetrics().healthScore >= 80 ? 'healthy' :
                    this.getMetrics().healthScore >= 60 ? 'warning' : 'critical',
                uptime: Date.now() - this.startTime,
                memoryUsage: this.getMemoryUsage(),
            },
        };
    }
}
