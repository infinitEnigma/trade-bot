/**
 * ===========================================
 * 🤖 TRADING DOMAIN - Bot Trading Logic
 * ===========================================
 *
 * Core business logic for automated trading bots,
 * trading strategies, position management, and engine operations.
 *
 * RESPONSIBILITIES:
 * - Bot lifecycle management (start/stop/status)
 * - Trading strategy execution and monitoring
 * - Position synchronization and validation
 * - Engine health monitoring and process management
 * - Trading performance analytics
 *
 * @format
 */

// Export trading-related services
export { EngineManager } from './engine-manager.service.pure';
export { PositionSyncService } from './position-sync.service.pure';
export { PositionValidatorService } from './position-validator.service.pure';

// Export engine sub-services
export * from './engine/index';

// Note: Type exports are not available yet - services need to be updated to export interfaces
