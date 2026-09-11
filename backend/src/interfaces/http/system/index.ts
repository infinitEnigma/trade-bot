/**
 * ===========================================
 * 🌐 HTTP INTERFACES - REST API Routes
 * ===========================================
 *
 * HTTP API routes and controllers for the Trade Bot platform.
 * Organized by functional domain for clean API boundaries.
 *
 * RESPONSIBILITIES:
 * - REST API endpoint definitions
 * - Request routing and handling
 * - Response formatting and serialization
 * - API documentation and validation
 *
 * @format
 */

// Export all HTTP route handlers from domain folders
export { authRoutes } from '../auth';
export { userRoutes, userProfileRoutes, userKodiakRoutes } from '../users';
export { marketRoutes, strategyRoutes } from '../trading';
export { botRoutes, botEngineRoutes, botManagementRoutes } from '../bots';
export { walletRoutes, walletBalanceRoutes } from '../wallet';
export { healthRoutes } from './health';
export { securityRoutes } from './security';
