/**
 * ===========================================
 * 🛡️ MIDDLEWARE INTERFACES - Request Processing
 * ===========================================
 *
 * HTTP middleware for request processing, authentication,
 * validation, and cross-cutting concerns.
 *
 * RESPONSIBILITIES:
 * - Request authentication and authorization
 * - Input validation and sanitization
 * - CSRF protection and security
 * - Request logging and monitoring
 * - CORS and rate limiting
 *
 * @format
 */

// Export authentication middleware
export { authMiddleware, AuthenticatedRequest } from './auth';

// Export security middleware
export { csrfMiddleware, csrfTokenMiddleware, CSRFRequest } from './csrf';

// Export logging middleware
export { httpLogger, errorLogger } from './logger';

// Export context middleware
export { contextMiddleware } from './context';

// Export role protection middleware
export { requireRole, requireAnyRole, hasRole, hasAnyRole } from './role-protection';

// Export validation middleware
export { validateRequest, commonSchemas, validators } from './validation';
