/**
 * ===========================================
 * 📝 LOGGING DOMAIN - Application Logging
 * ===========================================
 *
 * Centralized logging infrastructure for the Trade Bot platform.
 * Handles structured logging, context propagation, and monitoring.
 *
 * RESPONSIBILITIES:
 * - Structured application logging
 * - Context-aware log correlation
 * - Log level management and filtering
 * - Performance monitoring integration
 * - Error tracking and alerting
 *
 * @format
 */

// Export logging services
export { default as logger } from '../logging/logger.service';
export {
    ContextAwareLogger,
    contextLogger,
    marketStreamLogger,
    positionSyncLogger,
    redisLogger,
    websocketLogger,
    // Infrastructure Layer Loggers
    httpLogger,
    databaseLogger,
    cacheLogger,
    // Core Domain Loggers
    tradingLogger,
    walletLogger,
    authLogger,
    userLogger,
    // Cross-cutting Concern Loggers
    securityLogger,
    validationLogger,
    performanceLogger,
    integrationLogger
} from './context-aware-logger.service';

// Re-export logging types for convenience
export {
    ErrorSeverity,
    //ErrorType,
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
} from './context-aware-logger.service';
