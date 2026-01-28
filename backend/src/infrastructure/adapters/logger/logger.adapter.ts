/**
 * Logger Adapter - Clean Architecture Implementation with Context Awareness
 *
 * Adapter that implements ILogger interface using the ContextAwareLogger service.
 * This adapter provides a clean abstraction layer for logging operations with automatic
 * context propagation, error classification, and performance tracking while maintaining
 * the existing ILogger interface contract for backward compatibility.
 *
 * @format
 */

import { ILogger } from '../../../shared/src';
import { ContextAwareLogger, createErrorInfo, createEnhancedErrorInfo, createPerformanceMetrics, ErrorCodes } from '../../../core/logging/context-aware-logger.service';

// Import OperationTimer for performance tracking
import { OperationTimer } from '../../../core/logging/context-aware-logger.service';


/**
 * Log context interface for typed logging context
 *
 * Replaces the previous `any` type with a structured interface that provides
 * type safety while maintaining flexibility for custom logging context data.
 * This interface defines common logging context fields used throughout the application.
 */
interface LogContext {
    [key: string]: unknown;
    service?: string;
    component?: string;
    userId?: string;
    sessionId?: string;
    correlationId?: string;
    requestId?: string;
    timestamp?: number;
    custom?: Record<string, unknown>;
}

/**
 * Log metadata interface for typed metadata
 *
 * Replaces the previous `any` type with a structured interface that provides
 * type safety for log metadata. This interface defines common metadata fields
 * such as error information, performance metrics, and request details.
 */
interface LogMetadata {
    [key: string]: unknown;
    error?: Error | string;
    details?: unknown;
    stack?: string;
    duration?: number;
    method?: string;
    path?: string;
    status?: number;
    custom?: Record<string, unknown>;
}

/**
 * Logger Adapter with Context Awareness
 *
 * Implements the ILogger interface using the ContextAwareLogger service.
 * Provides a clean abstraction layer for logging operations with automatic
 * context propagation, error classification, and performance tracking.
 * 
 * Key Features:
 * - Automatic correlation ID and user context inclusion
 * - Error classification and structured error information
 * - Performance metrics and operation timing
 * - Backward compatibility with existing ILogger interface
 * - Enhanced child logger functionality with context propagation
 */
export class LoggerAdapter implements ILogger {
    private context: LogContext = {};
    private contextAwareLogger: ContextAwareLogger;

    constructor(componentName?: string) {
        // Initialize with context-aware logger, using component name if provided
        this.contextAwareLogger = new ContextAwareLogger(componentName || 'logger-adapter');
    }

    /**
     * Debug level logging with automatic context
     */
    debug(message: string, meta?: LogMetadata): void {
        if (meta) {
            this.contextAwareLogger.debug(message, { ...this.context, ...meta });
        } else {
            this.contextAwareLogger.debug(message, this.context);
        }
    }

    /**
     * Info level logging with automatic context
     */
    info(message: string, meta?: LogMetadata): void {
        if (meta) {
            this.contextAwareLogger.info(message, { ...this.context, ...meta });
        } else {
            this.contextAwareLogger.info(message, this.context);
        }
    }

    /**
     * Warning level logging with automatic context
     */
    warn(message: string, meta?: LogMetadata): void {
        if (meta) {
            this.contextAwareLogger.warn(message, { ...this.context, ...meta });
        } else {
            this.contextAwareLogger.warn(message, this.context);
        }
    }

    /**
     * Error level logging with automatic context and error classification
     */
    error(message: string, meta?: LogMetadata): void {
        // Handle error object if provided in meta
        if (meta?.error instanceof Error) {
            const error = meta.error as Error;
            const enhancedErrorInfo = createEnhancedErrorInfo(error, {
                context: (meta?.details && typeof meta.details === 'object') ? meta.details as Record<string, unknown> : undefined
            });

            this.contextAwareLogger.errorWithInfo(message, enhancedErrorInfo, {
                ...this.context,
                ...meta,
                errorInfo: enhancedErrorInfo
            });
        } else {
            // Standard error logging with automatic error classification if error message provided
            if (meta?.error) {
                const errorMessage = typeof meta.error === 'string' ? meta.error : String(meta.error);
                const error = new Error(errorMessage);
                const enhancedErrorInfo = createEnhancedErrorInfo(error, {
                    context: (meta?.details && typeof meta.details === 'object') ? meta.details as Record<string, unknown> : undefined
                });

                this.contextAwareLogger.errorWithInfo(message, enhancedErrorInfo, {
                    ...this.context,
                    ...meta,
                    errorInfo: enhancedErrorInfo
                });
            } else {
                // Standard error logging without error object
                this.contextAwareLogger.error(message, undefined, { ...this.context, ...meta });
            }
        }
    }

    /**
     * Create a child logger with additional context
     *
     * This allows creating contextual loggers for specific operations,
     * components, or user sessions while maintaining the same interface.
     * The child logger automatically inherits the parent's context and
     * adds the additional context provided.
     */
    child(additionalContext: LogContext): ILogger {
        const childAdapter = new LoggerAdapter();
        childAdapter.context = { ...this.context, ...additionalContext };
        return childAdapter;
    }

    /**
     * Start performance tracking for an operation
     * 
     * Returns an OperationTimer that can be used to track operation duration
     * and log performance metrics. This method provides access to the
     * ContextAwareLogger's performance tracking capabilities while maintaining
     * the ILogger interface contract.
     * 
     * @param operationName - Name of the operation to track
     * @param meta - Additional metadata for the operation
     * @returns OperationTimer instance for tracking the operation
     */
    startOperation(operationName: string, meta?: LogMetadata): OperationTimer {
        return this.contextAwareLogger.startOperation(operationName, { ...this.context, ...meta });
    }
}

// Export singleton instance for backward compatibility
export const loggerAdapter = new LoggerAdapter();
