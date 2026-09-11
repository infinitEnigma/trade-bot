/** @format */

/**
 * ===========================================
 * 📡 MESSAGING INFRASTRUCTURE
 * ===========================================
 *
 * Real-time communication and messaging infrastructure providing
 * WebSocket connectivity, market data streaming, and event-driven communication.
 *
 * COMPONENTS:
 * - WebSocket Service: Real-time client connections with authentication
 * - Market Stream Service: Orderly WebSocket integration for market data
 * - Event-driven messaging for real-time updates
 *
 * RESPONSIBILITIES:
 * - Real-time WebSocket connections with JWT authentication
 * - Market data streaming from external APIs (Orderly)
 * - Connection management and health monitoring
 * - Event routing and subscription management
 * - Rate limiting and security for real-time operations
 *
 * @format
 */

// Export WebSocket infrastructure
export * from './websocket.service';
export * from './websocket/auth';
export * from './websocket/handlers';
export * from './websocket/types';

// Export market streaming infrastructure
export { marketStreamService } from './market-stream';

// Export messaging types and interfaces
export * from '../../interfaces/websocket';
