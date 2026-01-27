/**
 * ===========================================
 * 📊 SHARED LOGGING TYPES
 * ===========================================
 * Comprehensive logging types for platform-wide use
 * Provides structured error handling, performance metrics,
 * and consistent logging patterns.
 *
 * RESPONSIBILITIES:
 * - Standardized error classification and severity levels
 * - Structured error information with rich context
 * - Performance metrics and operation tracking
 * - Database, HTTP, and user context metadata
 * - Stack trace parsing and error analysis
 *
 * BENEFITS:
 * - Consistent error handling across all services
 * - Rich debugging information for production issues
 * - Type-safe logging infrastructure
 * - Platform-wide error classification system
 * - Enhanced observability and monitoring
 *
 * @format
 */

/**
 * Error severity levels for logging and monitoring
 * Used for prioritization, alerting, and log filtering
 */
export type LoggerErrorSeverity = 'critical' | 'high' | 'medium' | 'low' | 'debug';

/**
 * Comprehensive error classification system
 * Enables precise error categorization and handling
 */
export type LoggerErrorType =
    | 'validation'
    | 'database'
    | 'network'
    | 'authentication'
    | 'business'
    | 'integration'
    | 'timeout'
    | 'permission'
    | 'configuration'
    | 'rate_limit'
    | 'data_processing'
    | 'external_service'
    | 'unknown';

/**
 * Structured error information for consistent error logging
 * Contains all relevant details for debugging and monitoring
 */
export interface ErrorInfo {
    error?: string;
    errorMessage?: string;
    errorName?: string;
    errorCode?: string;
    errorStack?: string;
    originalError?: string;
    isOperational?: boolean;
    errorType?: LoggerErrorType;
    errorSeverity?: LoggerErrorSeverity;
    timestamp?: number;
    context?: Record<string, unknown>;
    stackFrames?: StackFrame[];
}

/**
 * Stack frame information from parsed stack traces
 * Used for detailed error analysis and debugging
 */
export interface StackFrame {
    file?: string;
    line?: number;
    column?: number;
    functionName?: string;
    isInternal?: boolean;
    sourceCode?: string;
}

/**
 * Performance metrics for operation timing and monitoring
 * Enables performance tracking and optimization
 */
export interface PerformanceMetrics {
    duration?: number;
    durationMs?: number;
    startTime?: number;
    endTime?: number;
    operation?: string;
    operationType?: string;
    success?: boolean;
    performance?: boolean;
}

/**
 * Database operation metrics
 * Provides insights into database performance and usage
 */
export interface DatabaseMetrics {
    query?: string;
    table?: string;
    rowCount?: number;
    affectedRows?: number;
    queryDuration?: number;
    databaseOperation?: string;
}

/**
 * HTTP request information
 * Captures request details for monitoring and debugging
 */
export interface HttpRequestInfo {
    method?: string;
    path?: string;
    statusCode?: number;
    requestId?: string;
    userAgent?: string;
    ipAddress?: string;
}

/**
 * User context information
 * Associates logs with user sessions and operations
 */
export interface UserContextInfo {
    userId?: string;
    userLevel?: string;
    userEmail?: string;
    userRole?: string;
    sessionId?: string;
}

/**
 * Extended log context with type-safe metadata patterns
 * Maintains backward compatibility while providing structured logging
 */
export interface LogContext {
    correlationId?: string;
    userId?: string;
    userLevel?: string;
    requestId?: string;
    operationDuration?: number;
    component?: string;
    operation?: string;

    // Type-safe metadata extensions
    errorInfo?: ErrorInfo;
    performanceMetrics?: PerformanceMetrics;
    databaseMetrics?: DatabaseMetrics;
    httpRequest?: HttpRequestInfo;
    userContext?: UserContextInfo;

    // Maintain backward compatibility with dynamic properties
    [key: string]: unknown;
}

/**
 * Standardized error codes for consistent error classification
 * Enables programmatic error handling and monitoring
 */
export const ErrorCodes = {
    // Database errors
    DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
    DB_QUERY_TIMEOUT: 'DB_QUERY_TIMEOUT',
    DB_CONSTRAINT_VIOLATION: 'DB_CONSTRAINT_VIOLATION',
    DB_TRANSACTION_FAILED: 'DB_TRANSACTION_FAILED',
    DB_POOL_EXHAUSTED: 'DB_POOL_EXHAUSTED',

    // Network errors
    NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
    NETWORK_CONNECTION_FAILED: 'NETWORK_CONNECTION_FAILED',
    NETWORK_SSL_ERROR: 'NETWORK_SSL_ERROR',
    NETWORK_DNS_ERROR: 'NETWORK_DNS_ERROR',

    // Validation errors
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    VALIDATION_SCHEMA_ERROR: 'VALIDATION_SCHEMA_ERROR',
    VALIDATION_TYPE_ERROR: 'VALIDATION_TYPE_ERROR',

    // Authentication errors
    AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
    AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
    AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
    AUTH_PERMISSION_DENIED: 'AUTH_PERMISSION_DENIED',

    // Business logic errors
    BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
    BUSINESS_INVALID_STATE: 'BUSINESS_INVALID_STATE',
    BUSINESS_LIMIT_EXCEEDED: 'BUSINESS_LIMIT_EXCEEDED',

    // Integration errors
    INTEGRATION_API_ERROR: 'INTEGRATION_API_ERROR',
    INTEGRATION_SERVICE_UNAVAILABLE: 'INTEGRATION_SERVICE_UNAVAILABLE',
    INTEGRATION_AUTHENTICATION_FAILED: 'INTEGRATION_AUTHENTICATION_FAILED',

    // Configuration errors
    CONFIG_MISSING: 'CONFIG_MISSING',
    CONFIG_INVALID: 'CONFIG_INVALID',
    CONFIG_ENV_VARIABLE_MISSING: 'CONFIG_ENV_VARIABLE_MISSING',

    // Rate limiting errors
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    RATE_LIMIT_SERVICE_UNAVAILABLE: 'RATE_LIMIT_SERVICE_UNAVAILABLE',

    // Generic errors
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

/**
 * Union type of all error codes for type safety
 */
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Helper functions for creating type-safe metadata objects
 * These functions ensure consistent structure and optional fields
 */
export function createErrorInfo(error: Error, options?: {
    errorType?: ErrorInfo['errorType'];
    errorCode?: string;
    isOperational?: boolean;
}): ErrorInfo {
    return {
        error: error.message,
        errorMessage: error.message,
        errorName: error.name,
        errorStack: error.stack,
        errorType: options?.errorType || 'unknown',
        errorCode: options?.errorCode,
        isOperational: options?.isOperational,
    };
}

export function createPerformanceMetrics(options?: {
    duration?: number;
    operation?: string;
    operationType?: string;
    success?: boolean;
}): PerformanceMetrics {
    return {
        duration: options?.duration,
        durationMs: options?.duration,
        operation: options?.operation,
        operationType: options?.operationType,
        success: options?.success,
        performance: true,
    };
}

export function createDatabaseMetrics(options?: {
    query?: string;
    table?: string;
    rowCount?: number;
    queryDuration?: number;
}): DatabaseMetrics {
    return {
        query: options?.query,
        table: options?.table,
        rowCount: options?.rowCount,
        queryDuration: options?.queryDuration,
        databaseOperation: options?.query ? 'query' : undefined,
    };
}

export function createHttpRequestInfo(options?: {
    method?: string;
    path?: string;
    statusCode?: number;
    requestId?: string;
}): HttpRequestInfo {
    return {
        method: options?.method,
        path: options?.path,
        statusCode: options?.statusCode,
        requestId: options?.requestId,
    };
}

export function createUserContextInfo(options?: {
    userId?: string;
    userLevel?: string;
    userEmail?: string;
    userRole?: string;
}): UserContextInfo {
    return {
        userId: options?.userId,
        userLevel: options?.userLevel,
        userEmail: options?.userEmail,
        userRole: options?.userRole,
    };
}

/**
 * Parse stack trace into structured stack frames
 * Enables detailed error analysis and debugging
 */
export function parseStackTrace(stack?: string): StackFrame[] {
    if (!stack) return [];

    const frames: StackFrame[] = [];
    const stackLines = stack.split('\n');

    // Skip the first line (error message)
    for (let i = 1; i < stackLines.length; i++) {
        const line = stackLines[i].trim();
        if (!line || line.startsWith('    at ') || line.startsWith('at ')) {
            try {
                const frame = parseStackLine(line);
                if (frame) {
                    frames.push(frame);
                }
            } catch (error) {
                // Skip malformed stack lines
                continue;
            }
        }
    }

    return frames;
}

/**
 * Parse individual stack trace line
 * Handles various stack trace formats from different environments
 */
function parseStackLine(line: string): StackFrame | null {
    // Clean up the line
    let cleanLine = line.trim();
    if (cleanLine.startsWith('at ')) {
        cleanLine = cleanLine.substring(3);
    } else if (cleanLine.startsWith('    at ')) {
        cleanLine = cleanLine.substring(6);
    }

    // Skip native code and internal Node.js frames
    if (cleanLine.includes('(native)') ||
        cleanLine.includes('(internal/') ||
        cleanLine.includes('(node:') ||
        cleanLine.includes('(module.js') ||
        cleanLine.includes('(events.js') ||
        cleanLine.includes('(timers.js')) {
        return null;
    }

    // Parse different stack trace formats
    const frame: StackFrame = {
        isInternal: false
    };

    // Format: functionName (file:line:column)
    const parenMatch = cleanLine.match(/^(.+) \((.+):(\d+):(\d+)\)$/);
    if (parenMatch) {
        frame.functionName = parenMatch[1] || 'anonymous';
        frame.file = parenMatch[2];
        frame.line = parseInt(parenMatch[3]);
        frame.column = parseInt(parenMatch[4]);
        return frame;
    }

    // Format: at file:line:column
    const simpleMatch = cleanLine.match(/^(.+):(\d+):(\d+)$/);
    if (simpleMatch) {
        frame.file = simpleMatch[1];
        frame.line = parseInt(simpleMatch[2]);
        frame.column = parseInt(simpleMatch[3]);
        return frame;
    }

    // Format: functionName (file:line)
    const noColumnMatch = cleanLine.match(/^(.+) \((.+):(\d+)\)$/);
    if (noColumnMatch) {
        frame.functionName = noColumnMatch[1] || 'anonymous';
        frame.file = noColumnMatch[2];
        frame.line = parseInt(noColumnMatch[3]);
        return frame;
    }

    // Format: <anonymous> (file:line:column)
    const anonymousMatch = cleanLine.match(/^<anonymous> \((.+):(\d+):(\d+)\)$/);
    if (anonymousMatch) {
        frame.functionName = 'anonymous';
        frame.file = anonymousMatch[1];
        frame.line = parseInt(anonymousMatch[2]);
        frame.column = parseInt(anonymousMatch[3]);
        return frame;
    }

    // If we can't parse it, return null
    return null;
}

/**
 * Classify error based on error type, message, and stack trace
 * Enables automatic error categorization and handling
 */
export function classifyError(error: Error): {
    errorType: LoggerErrorType;
    errorCode: ErrorCode;
    errorSeverity: LoggerErrorSeverity;
} {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();
    const stackTrace = error.stack || '';

    // Database errors
    if (errorName.includes('database') ||
        errorName.includes('query') ||
        errorMessage.includes('database') ||
        errorMessage.includes('connection pool') ||
        errorMessage.includes('query timeout') ||
        errorMessage.includes('sql') ||
        errorMessage.includes('postgres') ||
        errorMessage.includes('pg::') ||
        stackTrace.includes('database/') ||
        stackTrace.includes('pool.ts')) {

        if (errorMessage.includes('connection') && errorMessage.includes('failed')) {
            return {
                errorType: 'database',
                errorCode: ErrorCodes.DB_CONNECTION_FAILED,
                errorSeverity: 'high'
            };
        } else if (errorMessage.includes('timeout')) {
            return {
                errorType: 'database',
                errorCode: ErrorCodes.DB_QUERY_TIMEOUT,
                errorSeverity: 'high'
            };
        } else if (errorMessage.includes('pool exhausted') || errorMessage.includes('too many clients')) {
            return {
                errorType: 'database',
                errorCode: ErrorCodes.DB_POOL_EXHAUSTED,
                errorSeverity: 'critical'
            };
        } else {
            return {
                errorType: 'database',
                errorCode: ErrorCodes.DB_QUERY_TIMEOUT,
                errorSeverity: 'high'
            };
        }
    }

    // Network errors
    if (errorName.includes('network') ||
        errorName.includes('fetch') ||
        errorName.includes('request') ||
        errorMessage.includes('network') ||
        errorMessage.includes('fetch') ||
        errorMessage.includes('request failed') ||
        errorMessage.includes('connection refused') ||
        errorMessage.includes('etimedout') ||
        errorMessage.includes('econnreset') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('socket hang up') ||
        stackTrace.includes('axios') ||
        stackTrace.includes('node-fetch') ||
        stackTrace.includes('http') ||
        stackTrace.includes('https')) {

        if (errorMessage.includes('timeout')) {
            return {
                errorType: 'network',
                errorCode: ErrorCodes.NETWORK_TIMEOUT,
                errorSeverity: 'high'
            };
        } else if (errorMessage.includes('connection refused') || errorMessage.includes('econnrefused')) {
            return {
                errorType: 'network',
                errorCode: ErrorCodes.NETWORK_CONNECTION_FAILED,
                errorSeverity: 'high'
            };
        } else {
            return {
                errorType: 'network',
                errorCode: ErrorCodes.NETWORK_CONNECTION_FAILED,
                errorSeverity: 'high'
            };
        }
    }

    // Authentication errors (check before validation since auth errors may contain "invalid")
    if (errorName.includes('auth') ||
        errorName.includes('token') ||
        errorName.includes('jwt') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('authorization') ||
        errorMessage.includes('token') ||
        errorMessage.includes('jwt') ||
        errorMessage.includes('invalid credentials') ||
        errorMessage.includes('permission denied') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('forbidden') ||
        (errorMessage.includes('invalid') && (errorMessage.includes('token') || errorMessage.includes('jwt') || errorMessage.includes('auth'))) ||
        stackTrace.includes('auth') ||
        stackTrace.includes('jwt')) {

        if (errorMessage.includes('expired')) {
            return {
                errorType: 'authentication',
                errorCode: ErrorCodes.AUTH_TOKEN_EXPIRED,
                errorSeverity: 'medium'
            };
        } else if (errorMessage.includes('permission denied') || errorMessage.includes('forbidden')) {
            return {
                errorType: 'authentication',
                errorCode: ErrorCodes.AUTH_PERMISSION_DENIED,
                errorSeverity: 'medium'
            };
        } else if (errorMessage.includes('invalid') && (errorMessage.includes('token') || errorMessage.includes('jwt') || errorMessage.includes('auth'))) {
            return {
                errorType: 'authentication',
                errorCode: ErrorCodes.AUTH_TOKEN_INVALID,
                errorSeverity: 'medium'
            };
        } else {
            return {
                errorType: 'authentication',
                errorCode: ErrorCodes.AUTH_INVALID_CREDENTIALS,
                errorSeverity: 'medium'
            };
        }
    }

    // Validation errors
    if (errorName.includes('validation') ||
        errorName.includes('joi') ||
        errorName.includes('zod') ||
        errorMessage.includes('validation') ||
        errorMessage.includes('invalid') ||
        errorMessage.includes('schema') ||
        errorMessage.includes('required') ||
        errorMessage.includes('must be') ||
        errorMessage.includes('should be') ||
        stackTrace.includes('validation') ||
        stackTrace.includes('schema')) {

        return {
            errorType: 'validation',
            errorCode: ErrorCodes.VALIDATION_FAILED,
            errorSeverity: 'medium'
        };
    }

    // Rate limiting errors
    if (errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('429') ||
        stackTrace.includes('rate-limit')) {

        return {
            errorType: 'rate_limit',
            errorCode: ErrorCodes.RATE_LIMIT_EXCEEDED,
            errorSeverity: 'medium'
        };
    }

    // Configuration errors
    if (errorMessage.includes('configuration') ||
        errorMessage.includes('env') ||
        errorMessage.includes('environment') ||
        errorMessage.includes('missing') ||
        errorMessage.includes('not configured') ||
        errorMessage.includes('undefined') ||
        stackTrace.includes('config')) {

        return {
            errorType: 'configuration',
            errorCode: ErrorCodes.CONFIG_MISSING,
            errorSeverity: 'high'
        };
    }

    // Business logic errors
    if (errorMessage.includes('business') ||
        errorMessage.includes('rule') ||
        errorMessage.includes('limit exceeded') ||
        errorMessage.includes('invalid state') ||
        errorMessage.includes('cannot') ||
        errorMessage.includes('not allowed') ||
        stackTrace.includes('business') ||
        stackTrace.includes('domain')) {

        return {
            errorType: 'business',
            errorCode: ErrorCodes.BUSINESS_RULE_VIOLATION,
            errorSeverity: 'medium'
        };
    }

    // Integration errors (external services)
    if (errorMessage.includes('integration') ||
        errorMessage.includes('api') ||
        errorMessage.includes('service unavailable') ||
        errorMessage.includes('503') ||
        errorMessage.includes('external') ||
        errorMessage.includes('third party') ||
        stackTrace.includes('integration') ||
        stackTrace.includes('external')) {

        if (errorMessage.includes('unavailable') || errorMessage.includes('503')) {
            return {
                errorType: 'integration',
                errorCode: ErrorCodes.INTEGRATION_SERVICE_UNAVAILABLE,
                errorSeverity: 'high'
            };
        } else {
            return {
                errorType: 'integration',
                errorCode: ErrorCodes.INTEGRATION_API_ERROR,
                errorSeverity: 'high'
            };
        }
    }

    // Default classification
    return {
        errorType: 'unknown',
        errorCode: ErrorCodes.UNKNOWN_ERROR,
        errorSeverity: 'high'
    };
}

/**
 * Enhanced error info creation with automatic classification and stack trace parsing
 * Provides comprehensive error context for debugging and monitoring
 */
export function createEnhancedErrorInfo(error: Error, options?: {
    errorType?: ErrorInfo['errorType'];
    errorCode?: string;
    isOperational?: boolean;
    context?: Record<string, unknown>;
}): ErrorInfo {
    // Automatic classification
    const classification = classifyError(error);

    // Parse stack trace
    const stackFrames = parseStackTrace(error.stack);

    return {
        error: error.message,
        errorMessage: error.message,
        errorName: error.name,
        errorStack: error.stack,
        errorType: options?.errorType || classification.errorType,
        errorCode: options?.errorCode || classification.errorCode,
        errorSeverity: classification.errorSeverity,
        isOperational: options?.isOperational,
        timestamp: Date.now(),
        context: options?.context,
        stackFrames: stackFrames,
    };
}