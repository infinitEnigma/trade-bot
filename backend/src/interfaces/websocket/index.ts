/**
 * ===========================================
 * 🌐 WEBSOCKET INTERFACES - Real-time Communication
 * ===========================================
 *
 * WebSocket event handlers and real-time communication
 * interfaces for the Trade Bot platform.
 *
 * RESPONSIBILITIES:
 * - WebSocket connection management
 * - Real-time event broadcasting
 * - Market data subscriptions
 * - Live trading updates
 * - User notification delivery
 *
 * @format
 */

// Export WebSocket event handlers (to be implemented)
export { marketDataHandler } from './market-data';
export { tradingHandler } from './trading';
export { notificationHandler } from './notifications';

// For now, WebSocket handling is done in index.ts
// Future: Extract to dedicated WebSocket interface handlers
