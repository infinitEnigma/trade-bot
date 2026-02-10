/** @format */

import { Request, Response, NextFunction } from "express";
import {
    AppError,
    SharedErrorCodes,
    createErrorResponse,
    getErrorStatusCode,
    isOperationalError
} from "@trade-bot/shared";
import { securityLogger as logger } from "../../core/logging/context-aware-logger.service";

/**
 * ===========================================
 * 🔴 UNIFIED ERROR HANDLER MIDDLEWARE
 * ===========================================
 *
 * Enterprise-grade error handling middleware that provides consistent,
 * structured error responses across all API endpoints.
 *
 * FEATURES:
 * - Structured error responses with correlation IDs
 * - Proper HTTP status codes
 * - User-friendly error messages
 * - Comprehensive error logging
 * - Graceful degradation for unknown errors
 * - Error classification and monitoring
 *
 * ERROR RESPONSE FORMAT:
 * {
 *   "success": false,
 *   "error": "User-friendly message",
 *   "code": "ERROR_CODE",
 *   "correlationId": "req_123456",
 *   "timestamp": "2023-12-01T10:00:00.000Z",
 *   ...additional context
 * }
 *
 * @format
 */

export interface ErrorHandlerConfig {
    /** Whether to include stack traces in development */
    includeStackTrace?: boolean;

    /** Whether to log error details */
    enableLogging?: boolean;

    /** Custom error transformers */
    errorTransformers?: Array<(error: Error) => Error>;

    /** Custom response transformers */
    responseTransformers?: Array<(response: Record<string, unknown>, error: Error) => Record<string, unknown>>;
}

/**
 * Enhanced error handler middleware with comprehensive error processing
 */
export class ErrorHandlerMiddleware {
    private config: Required<ErrorHandlerConfig>;

    constructor(config: ErrorHandlerConfig = {}) {
        this.config = {
            includeStackTrace: process.env.NODE_ENV === "development",
            enableLogging: true,
            errorTransformers: [],
            responseTransformers: [],
            ...config,
        };
    }

    /**
     * Main error handling middleware
     */
    handle = (error: Error, req: Request, res: Response, _next: NextFunction): void => {
        // Skip if response already sent
        if (res.headersSent) {
            return;
        }

        // Apply error transformers
        let processedError = error;
        for (const transformer of this.config.errorTransformers) {
            try {
                processedError = transformer(processedError);
            } catch (transformError) {
                logger.error("Error transformer failed", transformError as Error, {
                    originalError: processedError.message,
                });
            }
        }

        // Extract correlation ID from request
        const correlationId = this.extractCorrelationId(req);

        // Log error with context
        if (this.config.enableLogging) {
            this.logError(processedError, req, correlationId);
        }

        // Create structured error response
        const errorResponse = this.createErrorResponse(processedError, correlationId);

        // Apply response transformers
        let finalResponse = errorResponse;
        for (const transformer of this.config.responseTransformers) {
            try {
                finalResponse = transformer(finalResponse, processedError);
            } catch (transformError) {
                logger.error("Response transformer failed", transformError as Error);
            }
        }

        // Send response
        const statusCode = this.getStatusCode(processedError);
        res.status(statusCode).json(finalResponse);
    };

    /**
     * Create structured error response
     */
    private createErrorResponse(error: Error, correlationId?: string): Record<string, unknown> {
        if (error instanceof AppError) {
            // Use AppError's built-in response method
            return error.toResponse(correlationId);
        }

        // Handle unknown errors with fallback
        return createErrorResponse(error, correlationId);
    }

    /**
     * Extract correlation ID from request
     */
    private extractCorrelationId(req: Request): string | undefined {
        const correlationId = req.headers['x-correlation-id'];
        const requestId = req.headers['x-request-id'];
        const customCorrelationId = (req as unknown as { correlationId?: string }).correlationId;

        return (
            (typeof correlationId === 'string' ? correlationId : undefined) ||
            customCorrelationId ||
            (typeof requestId === 'string' ? requestId : undefined)
        );
    }

    /**
     * Get appropriate HTTP status code for error
     */
    private getStatusCode(error: Error): number {
        return getErrorStatusCode(error);
    }

    /**
     * Log error with comprehensive context
     */
    private logError(error: Error, req: Request, correlationId?: string): void {
        const isOperational = isOperationalError(error);

        const logData = {
            error: error.message,
            name: error.name,
            method: req.method,
            url: req.url,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            userId: (req as unknown as { user?: { userId?: string } }).user?.userId,
            isOperational,
            stack: this.config.includeStackTrace ? error.stack : undefined,
        };

        if (isOperational) {
            // Operational errors (expected, user errors)
            logger.warn("Operational error handled", logData);
        } else {
            // Programming errors (unexpected, system errors)
            logger.error("Programming error handled", error, logData);
        }
    }
}

/**
 * Factory function for creating error handler middleware
 */
export function createErrorHandler(config?: ErrorHandlerConfig): ErrorHandlerMiddleware {
    return new ErrorHandlerMiddleware(config);
}

/**
 * Default error handler instance
 */
export const errorHandler = new ErrorHandlerMiddleware();

/**
 * Convenience middleware function
 */
export const handleErrors = errorHandler.handle;

/**
 * Utility functions for error handling
 */
export class ErrorHandlerUtils {
    /**
     * Wrap async route handlers to catch errors
     */
    static asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => unknown) {
        return (req: Request, res: Response, next: NextFunction) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    /**
     * Create custom error for specific scenarios
     */
    static createCustomError(
        message: string,
        code: SharedErrorCodes,
        statusCode: number = 500,
        context: Record<string, unknown> = {}
    ): AppError {
        return new AppError(message, code, statusCode, context);
    }

    /**
     * Check if error should trigger monitoring alert
     */
    static shouldAlert(error: Error): boolean {
        if (error instanceof AppError) {
            // Alert on critical system errors
            return [
                SharedErrorCodes.INTERNAL_ERROR,
                SharedErrorCodes.DATABASE_ERROR,
                SharedErrorCodes.EXTERNAL_SERVICE_ERROR,
                SharedErrorCodes.CONFIGURATION_ERROR,
            ].includes(error.code);
        }

        // Alert on unknown errors
        return true;
    }

    /**
     * Get error severity level for monitoring
     */
    static getSeverity(error: Error): 'low' | 'medium' | 'high' | 'critical' {
        if (error instanceof AppError) {
            switch (error.code) {
                case SharedErrorCodes.INTERNAL_ERROR:
                case SharedErrorCodes.DATABASE_ERROR:
                case SharedErrorCodes.CONFIGURATION_ERROR:
                    return 'critical';

                case SharedErrorCodes.EXTERNAL_SERVICE_ERROR:
                case SharedErrorCodes.CONNECTION_ERROR:
                    return 'high';

                case SharedErrorCodes.UNAUTHENTICATED:
                case SharedErrorCodes.INSUFFICIENT_PERMISSIONS:
                    return 'medium';

                default:
                    return 'low';
            }
        }

        // Unknown errors are potentially critical
        return 'high';
    }
}
