/** @format */

import { UserLevel } from "@trade-bot/shared";

/**
 * WebSocket-specific types for the messaging infrastructure
 * These types are internal to the WebSocket implementation
 */

/**
 * Internal WebSocket client state
 * Extends the public interface with implementation details
 */
export interface WebSocketClientState {
    /** Public client information */
    public: {
        userId: string;
        userLevel: UserLevel;
        socketId: string;
        subscriptions: Set<string>;
        connectedAt: Date;
        lastActivity: Date;
        ipAddress: string;
    };

    /** Internal implementation details */
    private: {
        rateLimitTokens: number;
        lastRateLimitReset: Date;
        connectionHealth: WebSocketConnectionHealth;
        pendingSubscriptions: Set<string>;
        subscriptionHistory: SubscriptionHistory[];
    };
}

/**
 * WebSocket connection health tracking
 */
export interface WebSocketConnectionHealth {
    messagesSent: number;
    messagesReceived: number;
    errors: number;
    lastPing: Date;
    lastPong: Date;
    averageLatency: number;
    reconnectCount: number;
}

/**
 * Subscription history for analytics
 */
export interface SubscriptionHistory {
    topic: string;
    subscribedAt: Date;
    unsubscribedAt?: Date;
    messageCount: number;
}

/**
 * Rate limiting state per user
 */
export interface RateLimitState {
    tokens: number;
    lastRefill: Date;
    blockedUntil?: Date;
}

/**
 * WebSocket event context for logging and tracing
 */
export interface WebSocketEventContext {
    socketId: string;
    userId: string;
    userLevel: UserLevel;
    correlationId: string;
    timestamp: Date;
    event: string;
    payload?: unknown;
}

/**
 * Subscription request validation
 */
export interface SubscriptionRequest {
    topic: string;
    clientId: string;
    timestamp: Date;
    isValid: boolean;
    reason?: string;
}

/**
 * Market data subscription state
 */
export interface MarketSubscription {
    symbol: string;
    clientId: string;
    subscribedAt: Date;
    lastUpdate: Date;
    updateCount: number;
    isActive: boolean;
}

/**
 * WebSocket service internal metrics
 */
export interface InternalMetrics {
    /** Connection lifecycle */
    connections: {
        totalEstablished: number;
        totalClosed: number;
        activeNow: number;
        peakConcurrent: number;
        averageSessionDuration: number;
    };

    /** Message processing */
    messages: {
        totalReceived: number;
        totalSent: number;
        errors: number;
        averageProcessingTime: number;
        peakMessagesPerSecond: number;
    };

    /** Subscriptions */
    subscriptions: {
        activeSubscriptions: number;
        totalSubscriptions: number;
        averageSubscriptionsPerUser: number;
        topTopics: Array<{ topic: string; count: number }>;
    };

    /** Performance */
    performance: {
        memoryUsage: number;
        cpuUsage: number;
        garbageCollections: number;
        eventLoopLag: number;
    };

    /** Errors */
    errors: {
        authenticationErrors: number;
        rateLimitHits: number;
        connectionErrors: number;
        messageProcessingErrors: number;
    };
}

/**
 * WebSocket configuration constants
 */
export const WEBSOCKET_CONSTANTS = {
    /** Rate limiting */
    RATE_LIMIT: {
        TOKENS_PER_WINDOW: parseInt(process.env.WEBSOCKET_RATE_LIMIT_TOKENS_PER_WINDOW || "100"),
        WINDOW_MS: parseInt(process.env.WEBSOCKET_RATE_LIMIT_WINDOW_MS || "60000"), // 1 minute
        REFILL_RATE: parseInt(process.env.WEBSOCKET_RATE_LIMIT_REFILL_RATE || "10"), // tokens per second
    },

    /** Connection limits */
    CONNECTIONS: {
        MAX_PER_USER: parseInt(process.env.WEBSOCKET_CONNECTIONS_MAX_PER_USER || "5"),
        MAX_TOTAL: parseInt(process.env.WEBSOCKET_CONNECTIONS_MAX_TOTAL || "1000"),
        TIMEOUT_MS: parseInt(process.env.WEBSOCKET_CONNECTIONS_TIMEOUT_MS || "30000"),
    },

    /** Subscriptions */
    SUBSCRIPTIONS: {
        MAX_PER_USER: parseInt(process.env.WEBSOCKET_SUBSCRIPTIONS_MAX_PER_USER || "50"),
        CLEANUP_INTERVAL_MS: parseInt(process.env.WEBSOCKET_SUBSCRIPTIONS_CLEANUP_INTERVAL_MS || "300000"), // 5 minutes
    },

    /** Health monitoring */
    HEALTH: {
        CHECK_INTERVAL_MS: parseInt(process.env.WEBSOCKET_HEALTH_CHECK_INTERVAL_MS || "30000"),
        METRICS_RETENTION_MS: parseInt(process.env.WEBSOCKET_HEALTH_METRICS_RETENTION_MS || "3600000"), // 1 hour
    },

    /** Message processing */
    MESSAGES: {
        MAX_BATCH_SIZE: parseInt(process.env.WEBSOCKET_MESSAGES_MAX_BATCH_SIZE || "100"),
        PROCESSING_TIMEOUT_MS: parseInt(process.env.WEBSOCKET_MESSAGES_PROCESSING_TIMEOUT_MS || "5000"),
        QUEUE_SIZE_WARNING: parseInt(process.env.WEBSOCKET_MESSAGES_QUEUE_SIZE_WARNING || "1000"),
    },
} as const;

/**
 * WebSocket error codes specific to this service
 */
export enum WebSocketErrorCode {
    AUTHENTICATION_FAILED = "WS_AUTH_FAILED",
    INVALID_TOKEN = "WS_INVALID_TOKEN",
    USER_NOT_FOUND = "WS_USER_NOT_FOUND",
    INSUFFICIENT_PERMISSIONS = "WS_INSUFFICIENT_PERMISSIONS",
    RATE_LIMIT_EXCEEDED = "WS_RATE_LIMIT",
    INVALID_SUBSCRIPTION = "WS_INVALID_SUBSCRIPTION",
    CONNECTION_LIMIT_EXCEEDED = "WS_CONNECTION_LIMIT",
    SUBSCRIPTION_LIMIT_EXCEEDED = "WS_SUBSCRIPTION_LIMIT",
    MARKET_DATA_UNAVAILABLE = "WS_MARKET_DATA_UNAVAILABLE",
    INTERNAL_ERROR = "WS_INTERNAL_ERROR",
}

/**
 * WebSocket-specific error class
 */
export class WebSocketError extends Error {
    public readonly code: WebSocketErrorCode;
    public readonly statusCode: number;
    public readonly context: Record<string, unknown>;

    constructor(
        message: string,
        code: WebSocketErrorCode,
        statusCode: number = 400,
        context: Record<string, unknown> = {}
    ) {
        super(message);
        this.name = "WebSocketError";
        this.code = code;
        this.statusCode = statusCode;
        this.context = context;
    }

    toJSON() {
        return {
            error: this.message,
            code: this.code,
            context: this.context,
        };
    }
}

/**
 * Utility functions for WebSocket operations
 */
export class WebSocketUtils {
    /**
     * Validate subscription topic format
     */
    static isValidTopic(topic: string): boolean {
        // Basic validation - can be enhanced
        return typeof topic === "string" && topic.length > 0 && topic.length <= 100;
    }

    /**
     * Validate market symbol format
     */
    static isValidSymbol(symbol: string): boolean {
        // PERP_ prefix required for perpetual contracts
        const symbolRegex = /^PERP_[A-Z]+_USDC$/;
        return symbolRegex.test(symbol);
    }

    /**
     * Generate correlation ID for WebSocket events
     */
    static generateCorrelationId(): string {
        return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Check if user level meets requirements
     */
    static hasRequiredLevel(userLevel: UserLevel, required: UserLevel): boolean {
        const levels = ["BASIC", "VERIFIED", "PREMIUM"];
        const userIndex = levels.indexOf(userLevel);
        const requiredIndex = levels.indexOf(required);
        return userIndex >= requiredIndex;
    }

    /**
     * Calculate rate limit tokens to consume
     */
    static calculateRateLimitCost(event: string): number {
        switch (event) {
            case "subscribe_market":
                return 2; // Market subscriptions cost more
            case "subscribe":
                return 1; // Basic subscriptions
            default:
                return 1;
        }
    }
}
