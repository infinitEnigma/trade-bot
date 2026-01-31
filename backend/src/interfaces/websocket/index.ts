/** @format */

import { UserLevel, User, TokenPayload } from "@trade-bot/shared";
import { TickData } from "../../infrastructure/messaging/market-stream/types";

/**
 * WebSocket Service Interface
 * Defines the contract for WebSocket server management
 */
export interface IWebSocketService {
    /** Initialize the WebSocket service with a Socket.IO server instance */
    initialize(io: Server): void;

    /** Get comprehensive WebSocket metrics for monitoring */
    getMetrics(): WebSocketMetrics;

    /** Forcefully disconnect a specific client */
    disconnectClient(socketId: string): void;

    /** Get detailed connection information */
    getConnections(): WebSocketConnection[];
}

/**
 * WebSocket Client Representation
 * Contains authenticated client information and connection state
 */
export interface WebSocketClient {
    /** Unique user identifier */
    userId: string;

    /** User's verification level */
    userLevel: UserLevel;

    /** Socket.IO socket ID */
    socketId: string;

    /** Active subscriptions (rooms/symbols) */
    subscriptions: Set<string>;

    /** Connection establishment timestamp */
    connectedAt: Date;

    /** Last activity timestamp */
    lastActivity: Date;

    /** Client IP address */
    ipAddress: string;
}

/**
 * WebSocket Metrics for Monitoring
 * Comprehensive health and performance metrics
 */
export interface WebSocketMetrics {
    /** Number of currently active connections */
    activeConnections: number;

    /** Messages processed per second */
    messagesPerSecond: number;

    /** Error rate (errors per minute) */
    errorRate: number;

    /** Most popular subscriptions with counts */
    topSubscriptions: Array<{ topic: string; count: number }>;

    /** Connection health score (0-100) */
    healthScore: number;

    /** Memory usage for WebSocket connections */
    memoryUsage: number;

    /** Average response time for operations */
    averageResponseTime: number;
}

/**
 * WebSocket Connection Information
 * Detailed information about individual connections
 */
export interface WebSocketConnection {
    socketId: string;
    userId: string;
    userLevel: UserLevel;
    connectedAt: Date;
    lastActivity: Date;
    subscriptionCount: number;
    ipAddress: string;
}

/**
 * WebSocket Event Types
 * Defines all possible WebSocket event types
 */
export enum WebSocketEvent {
    CONNECT = "connect",
    DISCONNECT = "disconnect",
    SUBSCRIBE = "subscribe",
    UNSUBSCRIBE = "unsubscribe",
    SUBSCRIBE_MARKET = "subscribe_market",
    UNSUBSCRIBE_MARKET = "unsubscribe_market",
    ERROR = "error",
    AUTH_ERROR = "auth_error",
}

/**
 * WebSocket Market Unsubscribe Payload
 * Type-safe message structure for market unsubscribe event
 */
export interface WebSocketMarketUnsubscribePayload {
    symbol: string;
}

/**
 * WebSocket Message Payloads
 * Type-safe message structures for different event types
 */
export interface WebSocketAuthPayload {
    token: string;
}

export interface WebSocketSubscriptionPayload {
    room: string;
}

export interface WebSocketMarketSubscriptionPayload {
    symbol: string;
}

export interface WebSocketErrorPayload {
    code: string;
    message: string;
    correlationId?: string;
    details?: Record<string, unknown>;
}

/**
 * WebSocket Configuration
 * Configuration options for WebSocket service
 */
export interface WebSocketConfig {
    /** Maximum connections per user */
    maxConnectionsPerUser: number;

    /** Maximum total connections */
    maxTotalConnections: number;

    /** Rate limiting window (milliseconds) */
    rateLimitWindowMs: number;

    /** Maximum requests per window */
    rateLimitMaxRequests: number;

    /** Connection timeout (milliseconds) */
    connectionTimeoutMs: number;

    /** Heartbeat interval (milliseconds) */
    heartbeatIntervalMs: number;

    /** Maximum subscription limit per user */
    maxSubscriptionsPerUser: number;
}

/**
 * WebSocket Service Dependencies
 * Interfaces for service dependencies (dependency injection)
 */
export interface IMarketStreamService {
    subscribe(clientId: string, topic: string): void;
    unsubscribe(clientId: string, topic: string): void;
    getLatestTick(symbol: string): Promise<TickData | null>;
    connectToOrderly(symbols: string[]): Promise<void>;
    setSocketServer(io: Server): void;
}

export interface IAuthService {
    validateToken(token: string): Promise<TokenPayload | null>;
    getUserById(userId: string): Promise<User | null>;
}

export interface ILogger {
    info(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
    debug(message: string, meta?: unknown): void;
    child(meta: unknown): ILogger;
}

export interface IRateLimiter {
    canSubscribe(userId: string): Promise<boolean>;
    recordSubscription(userId: string): Promise<void>;
}

// Type imports for external dependencies
import { Server as SocketIOServer, Socket } from "socket.io";

// Re-export Socket.IO types for convenience
export type Server = SocketIOServer;
export type { Socket };
