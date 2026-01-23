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
 * Logger Adapter
 *
 * Implements the ILogger interface using the existing Winston-based logger service.
 * Provides a clean abstraction layer for logging operations with child logger support.
 */
export class LoggerAdapter implements ILogger {
    private context: any = {};

    /**
     * Debug level logging
     */
    debug(message: string, meta?: any): void {
        if (meta) {
            logger.debug(message, { ...this.context, ...meta });
        } else {
            logger.debug(message, this.context);
        }
    }

    /**
     * Info level logging
     */
    info(message: string, meta?: any): void {
        if (meta) {
            logger.info(message, { ...this.context, ...meta });
        } else {
            logger.info(message, this.context);
        }
    }

    /**
     * Warning level logging
     */
    warn(message: string, meta?: any): void {
        if (meta) {
            logger.warn(message, { ...this.context, ...meta });
        } else {
            logger.warn(message, this.context);
        }
    }

    /**
     * Error level logging
     */
    error(message: string, meta?: any): void {
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
    child(additionalContext: any): ILogger {
        const childAdapter = new LoggerAdapter();
        childAdapter.context = { ...this.context, ...additionalContext };
        return childAdapter;
    }
}

// Export singleton instance
export const loggerAdapter = new LoggerAdapter();