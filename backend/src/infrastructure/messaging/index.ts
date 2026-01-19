/**
 * ===========================================
 * 📡 MESSAGING INFRASTRUCTURE - Real-time Services
 * ===========================================
 *
 * Infrastructure layer for real-time messaging,
 * WebSocket connections, and market data streaming.
 *
 * RESPONSIBILITIES:
 * - WebSocket connection management
 * - Market data streaming and subscriptions
 * - Real-time event broadcasting
 * - Message routing and filtering
 *
 * @format
 */

// Export messaging infrastructure services
export { marketStreamService } from './market-stream.service';

// Export market-stream sub-services
export * from './market-stream/index';
