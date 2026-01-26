/**
 * Logger Adapter - Clean Architecture Implementation
 *
 * Adapter that implements ILogger interface using the existing Winston logger service.
 * This adapter provides a clean abstraction layer for logging operations,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { ILogger } from '@trade-bot/shared';
import logger from '../../../core/logging/logger.service';

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
 * Logger Adapter
 *
 * Implements the ILogger interface using the existing Winston-based logger service.
 * Provides a clean abstraction layer for logging operations with child logger support.
 */
export class LoggerAdapter implements ILogger {
    private context: LogContext = {};

    /**
     * Debug level logging
     */
    debug(message: string, meta?: LogMetadata): void {
        if (meta) {
            logger.debug(message, { ...this.context, ...meta });
        } else {
            logger.debug(message, this.context);
        }
    }

    /**
     * Info level logging
     */
    info(message: string, meta?: LogMetadata): void {
        if (meta) {
            logger.info(message, { ...this.context, ...meta });
        } else {
            logger.info(message, this.context);
        }
    }

    /**
     * Warning level logging
     */
    warn(message: string, meta?: LogMetadata): void {
        if (meta) {
            logger.warn(message, { ...this.context, ...meta });
        } else {
            logger.warn(message, this.context);
        }
    }

    /**
     * Error level logging
     */
    error(message: string, meta?: LogMetadata): void {
        if (meta) {
            logger.error(message, { ...this.context, ...meta });
        } else {
            logger.error(message, this.context);
        }
    }

    /**
     * Create a child logger with additional context
     *
     * This allows creating contextual loggers for specific operations,
     * components, or user sessions while maintaining the same interface.
     */
    child(additionalContext: LogContext): ILogger {
        const childAdapter = new LoggerAdapter();
        childAdapter.context = { ...this.context, ...additionalContext };
        return childAdapter;
    }
}

// Export singleton instance
export const loggerAdapter = new LoggerAdapter();