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

import { logger } from "../logging";
import {
    getCorrelationId,
    getCurrentUserId,
    getCurrentContext,
    createChildContext,
    RequestContext,
} from "../../shared/utils/context";

// Import from shared logging types
import {
    LoggerErrorSeverity as ErrorSeverity,
    LoggerErrorType,
    ErrorInfo,
    StackFrame,
    PerformanceMetrics,
    DatabaseMetrics,
    HttpRequestInfo,
    UserContextInfo,
    LogContext,
    SharedErrorCodes,
    //ErrorCode,
    createErrorInfo,
    createPerformanceMetrics,
    createDatabaseMetrics,
    createHttpRequestInfo,
    createUserContextInfo,
    parseStackTrace,
    classifyError,
    createEnhancedErrorInfo
} from "@trade-bot/shared";

// Re-export for backward compatibility
export {
    SharedErrorCodes,
    ErrorSeverity,
    LoggerErrorType,
    ErrorInfo,
    StackFrame,
    PerformanceMetrics,
    DatabaseMetrics,
    HttpRequestInfo,
    UserContextInfo,
    LogContext,
    createErrorInfo,
    createPerformanceMetrics,
    createDatabaseMetrics,
    createHttpRequestInfo,
    createUserContextInfo,
    parseStackTrace,
    classifyError,
    createEnhancedErrorInfo
};

/**
 * Context-aware logger that automatically includes tracing information
 */
export class ContextAwareLogger {
    private componentName: string;
    private additionalMeta?: Record<string, unknown>;

    /**
     * Context caching mechanism to optimize performance
     * Caches context information to avoid repeated lookups
     */
    private contextCache: {
        contextRef: RequestContext | undefined;
        cachedInfo: LogContext | undefined;
        generation: number;
    } = {
            contextRef: undefined,
            cachedInfo: undefined,
            generation: 0
        };

    constructor(componentName: string = "unknown") {
        this.componentName = componentName;
    }

    /**
     * Enhanced context caching with improved change detection
     * Handles recent changes to context structure and metadata
     */
    private checkContextChange(): number {
        const currentContext = getCurrentContext();
        const currentCorrelationId = getCorrelationId();
        const currentUserId = getCurrentUserId();

        // Invalidate cache if:
        // 1. Context reference changed, OR
        // 2. Correlation ID changed, OR
        // 3. User ID changed, OR
        // 4. User level changed, OR
        // 5. Request ID changed
        // This ensures we catch all meaningful context changes including recent additions
        const shouldInvalidate =
            currentContext !== this.contextCache.contextRef ||
            currentCorrelationId !== this.contextCache.cachedInfo?.correlationId ||
            currentUserId !== this.contextCache.cachedInfo?.userId ||
            (currentContext?.userLevel !== this.contextCache.cachedInfo?.userLevel) ||
            (currentContext?.requestId !== this.contextCache.cachedInfo?.requestId);

        if (shouldInvalidate) {
            this.contextCache.generation++;
            this.contextCache.contextRef = currentContext;
        }
        return this.contextCache.generation;
    }


    /**
     * Get current context information for logging with caching optimization
     */
    private getContextInfo(additionalMeta?: Record<string, unknown>): LogContext {
        const currentGeneration = this.checkContextChange();

        // Return cached version if context hasn't changed and we have cached info
        if (this.contextCache.cachedInfo && this.contextCache.generation === currentGeneration) {
            return {
                ...this.contextCache.cachedInfo,
                ...this.additionalMeta,
                ...additionalMeta
            };
        }

        // Compute fresh context info
        const correlationId = getCorrelationId();
        const userId = getCurrentUserId();
        const context = getCurrentContext();

        const contextInfo: LogContext = {
            correlationId,
            userId,
            component: this.componentName,
            ...this.additionalMeta,
            ...additionalMeta,
        };

        if (context) {
            contextInfo.userLevel = context.userLevel;
            contextInfo.requestId = context.requestId;
            contextInfo.operationDuration = Date.now() - context.startTime;
        }

        // Cache the result for future calls
        this.contextCache.cachedInfo = contextInfo;
        return contextInfo;
    }

    /**
     * Info level logging with automatic context
     */
    info(message: string, meta?: Record<string, unknown>): void {
        logger.info(message, this.getContextInfo(meta));
    }

    /**
     * Error level logging with automatic context
     */
    error(message: string, error?: Error, meta?: Record<string, unknown>): void {
        const errorInfo: Record<string, unknown> = { ...meta };

        if (error) {
            errorInfo.error = error.message;
            errorInfo.stack = error.stack;
            errorInfo.errorName = error.name;
        }

        logger.error(message, this.getContextInfo(errorInfo));
    }

    /**
     * Type-safe error logging with structured error information
     */
    errorWithInfo(message: string, errorInfo: ErrorInfo, meta?: Record<string, unknown>): void {
        logger.error(message, this.getContextInfo({
            errorInfo,
            ...meta
        }));
    }

    /**
     * Warning level logging with automatic context
     */
    warn(message: string, meta?: Record<string, unknown>): void {
        logger.warn(message, this.getContextInfo(meta));
    }

    /**
     * Debug level logging with automatic context
     */
    debug(message: string, meta?: Record<string, unknown>): void {
        logger.debug(message, this.getContextInfo(meta));
    }

    /**
     * HTTP level logging with automatic context
     * Matches the Winston HTTP transport for HTTP request/response logging
     */
    http(message: string, meta?: Record<string, unknown>): void {
        logger.http(message, this.getContextInfo(meta));
    }

    /**
     * Create child logger for sub-operations
     */
    child(operationName: string, additionalMeta?: Record<string, unknown>): ContextAwareLogger {
        const childLogger = new ContextAwareLogger(`${this.componentName}:${operationName}`);

        // Store additional metadata in child logger
        childLogger.additionalMeta = additionalMeta || {};

        // Create child context if we have a current context
        const currentContext = getCurrentContext();
        if (currentContext) {
            const childContext = createChildContext(operationName);
            // Copy user information to child context
            childContext.userId = currentContext.userId;
            childContext.userLevel = currentContext.userLevel;
        }

        return childLogger;
    }

    /**
     * Start operation timing
     */
    startOperation(operationName: string, meta?: Record<string, unknown>): OperationTimer {
        return new OperationTimer(this, operationName, meta);
    }

    /**
     * Log performance metrics
     */
    performance(operation: string, duration: number, success: boolean, meta?: Record<string, unknown>): void {
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
    private log(level: string, message: string, meta?: Record<string, unknown>): void {
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
                logger.debug(message, contextInfo);
                break;
            case 'http':
                logger.http(message, contextInfo);
                break;
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
    private meta?: Record<string, unknown>;

    constructor(logger: ContextAwareLogger, operationName: string, meta?: Record<string, unknown>) {
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
    success(resultMeta?: Record<string, unknown>): void {
        const duration = Date.now() - this.startTime;

        this.logger.performance(this.operationName, duration, true, {
            ...this.meta,
            ...resultMeta,
        });
    }

    /**
     * Complete the operation with failure
     */
    failure(error?: Error, errorMeta?: Record<string, unknown>): void {
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

// Infrastructure Layer Loggers
export const httpLogger = new ContextAwareLogger('http');
export const databaseLogger = new ContextAwareLogger('database');
export const cacheLogger = new ContextAwareLogger('cache');

// Core Domain Loggers
export const tradingLogger = new ContextAwareLogger('trading');
export const walletLogger = new ContextAwareLogger('wallet');
export const authLogger = new ContextAwareLogger('auth');
export const userLogger = new ContextAwareLogger('user');

// Cross-cutting Concern Loggers
export const securityLogger = new ContextAwareLogger('security');
export const validationLogger = new ContextAwareLogger('validation');
export const performanceLogger = new ContextAwareLogger('performance');
export const integrationLogger = new ContextAwareLogger('integration');

// Default instance
export const contextLogger = new ContextAwareLogger('application');

// Re-export ErrorCodes from shared for backward compatibility
//export { SharedErrorCodes };
export type ErrorCodes = typeof SharedErrorCodes[keyof typeof SharedErrorCodes];
