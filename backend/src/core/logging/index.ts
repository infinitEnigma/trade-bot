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
export { default as logger } from './logger.service';
export { ContextAwareLogger, contextLogger, marketStreamLogger, positionSyncLogger, redisLogger, websocketLogger } from './context-aware-logger.service';
