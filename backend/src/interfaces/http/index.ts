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

// Export all HTTP route handlers
export { authRoutes } from './auth';
export { userRoutes } from './user';
export { balanceRoutes } from './balance';
export { marketRoutes } from './market';
export { strategyRoutes } from './strategies';
export { botRoutes } from './bot';
export { botEngineRoutes } from './bot-engine';
export { botManagementRoutes } from './bot-management';
export { healthRoutes } from './health';
export { securityRoutes } from './security';
export { userKodiakRoutes } from './user-kodiak';
export { userProfileRoutes } from './user-profile';
export { walletRoutes } from './wallet';
