/**
 * ===========================================
 * 📊 CONTEXT-AWARE LOGGER
 * ===========================================
 *
 * Logger wrapper that automatically includes correlation IDs,
 * user context, and operation metadata in all log entries.
 *
 * RESPONSIBILITIES:
 * - Automatic correlation ID inclusion
 * - User context propagation
 * - Request tracing across async boundaries
 * - Performance timing metadata
 * - Structured logging with consistent format
 *
 * @format
 */

import logger from "./logger";
import {
    getCorrelationId,
    getCurrentUserId,
    getCurrentContext,
    createChildContext,
} from "../utils/context";

export interface LogContext {
    correlationId?: string;
    userId?: string;
    userLevel?: string;
    requestId?: string;
    operationDuration?: number;
    component?: string;
    operation?: string;
    [key: string]: any;
}

/**
 * Context-aware logger that automatically includes tracing information
 */
export class ContextAwareLogger {
    private componentName: string;
    private additionalMeta?: Record<string, any>;

    constructor(componentName: string = "unknown") {
        this.componentName = componentName;
    }

    /**
     * Get current context information for logging
     */
    private getContextInfo(additionalMeta?: Record<string, any>): LogContext {
        const correlationId = getCorrelationId();
        const userId = getCurrentUserId();
        const context = getCurrentContext();

        const contextInfo: LogContext = {
            correlationId,
            userId,
            component: this.componentName,
            ...additionalMeta,
        };

        if (context) {
            contextInfo.userLevel = context.userLevel;
            contextInfo.requestId = context.requestId;
            contextInfo.operationDuration = Date.now() - context.startTime;
        }

        return contextInfo;
    }

    /**
     * Info level logging with automatic context
     */
    info(message: string, meta?: Record<string, any>): void {
        logger.info(message, this.getContextInfo(meta));
    }

    /**
     * Error level logging with automatic context
     */
    error(message: string, error?: Error, meta?: Record<string, any>): void {
        const errorInfo: Record<string, any> = { ...meta };

        if (error) {
            errorInfo.error = error.message;
            errorInfo.stack = error.stack;
            errorInfo.errorName = error.name;
        }

        logger.error(message, this.getContextInfo(errorInfo));
    }

    /**
     * Warning level logging with automatic context
     */
    warn(message: string, meta?: Record<string, any>): void {
        logger.warn(message, this.getContextInfo(meta));
    }

    /**
     * Debug level logging with automatic context
     */
    debug(message: string, meta?: Record<string, any>): void {
        logger.debug(message, this.getContextInfo(meta));
    }

    /**
     * Create child logger for sub-operations
     */
    child(operationName: string, additionalMeta?: Record<string, any>): ContextAwareLogger {
        const childLogger = new ContextAwareLogger(`${this.componentName}:${operationName}`);

        // Create child context if we have a current context
        const currentContext = getCurrentContext();
        if (currentContext) {
            const childContext = createChildContext(operationName);
            // Copy user information to child context
            childContext.userId = currentContext.userId;
            childContext.userLevel = currentContext.userLevel;

            // Store additional metadata in child logger
            childLogger.additionalMeta = additionalMeta || {};
        }

        return childLogger;
    }

    /**
     * Start operation timing
     */
    startOperation(operationName: string, meta?: Record<string, any>): OperationTimer {
        return new OperationTimer(this, operationName, meta);
    }

    /**
     * Log performance metrics
     */
    performance(operation: string, duration: number, success: boolean, meta?: Record<string, any>): void {
        const level = success ? 'debug' : 'warn';
        const status = success ? 'completed' : 'failed';

        this.log(level, `Operation ${status}: ${operation}`, {
            operation,
            duration,
            success,
            performance: true,
            ...meta,
        });
    }

    /**
     * Generic log method
     */
    private log(level: string, message: string, meta?: Record<string, any>): void {
        const contextInfo = this.getContextInfo(meta);

        switch (level) {
            case 'info':
                logger.info(message, contextInfo);
                break;
            case 'error':
                logger.error(message, contextInfo);
                break;
            case 'warn':
                logger.warn(message, contextInfo);
                break;
            case 'debug':
            default:
                logger.debug(message, contextInfo);
                break;
        }
    }
}

/**
 * Operation timer for performance tracking
 */
export class OperationTimer {
    private startTime: number;
    private logger: ContextAwareLogger;
    private operationName: string;
    private meta?: Record<string, any>;

    constructor(logger: ContextAwareLogger, operationName: string, meta?: Record<string, any>) {
        this.startTime = Date.now();
        this.logger = logger;
        this.operationName = operationName;
        this.meta = meta;

        this.logger.debug(`Starting operation: ${operationName}`, {
            operation: operationName,
            operationType: 'start',
            ...meta,
        });
    }

    /**
     * Complete the operation with success
     */
    success(resultMeta?: Record<string, any>): void {
        const duration = Date.now() - this.startTime;

        this.logger.performance(this.operationName, duration, true, {
            ...this.meta,
            ...resultMeta,
        });
    }

    /**
     * Complete the operation with failure
     */
    failure(error?: Error, errorMeta?: Record<string, any>): void {
        const duration = Date.now() - this.startTime;

        this.logger.performance(this.operationName, duration, false, {
            ...this.meta,
            ...errorMeta,
        });

        if (error) {
            this.logger.error(`Operation failed: ${this.operationName}`, error, {
                operation: this.operationName,
                operationType: 'error',
                duration,
                ...this.meta,
                ...errorMeta,
            });
        }
    }

    /**
     * Get elapsed time without completing
     */
    getElapsed(): number {
        return Date.now() - this.startTime;
    }
}

// Create singleton instances for common components
export const marketStreamLogger = new ContextAwareLogger('market-stream');
export const positionSyncLogger = new ContextAwareLogger('position-sync');
export const redisLogger = new ContextAwareLogger('redis');
export const websocketLogger = new ContextAwareLogger('websocket');

// Default instance
export const contextLogger = new ContextAwareLogger('application');
