/**
 * ===========================================
 * 🔌 INTERFACE LAYER - API Interfaces
 * ===========================================
 *
 * Interface layer for API boundaries, HTTP routes, middleware,
 * and external communication protocols.
 *
 * RESPONSIBILITIES:
 * - HTTP API routes and controllers
 * - Request/response middleware
 * - WebSocket event handlers
 * - API validation and serialization
 * - External API communication
 *
 * @format
 */

// Export HTTP interfaces
export * from './http/index';

// Export middleware interfaces
export * from './middleware/index';

// Export WebSocket interfaces
export * from './websocket/index';
