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
export { botStatusService } from './bot-status.service';
export { botPerformanceService } from './bot-performance.service';
export { engineManager } from './engine-manager.service';
export { positionSyncService } from './position-sync.service';
export { positionValidatorService } from './position-validator.service';

// Export engine sub-services
export * from './engine/index';

// Note: Type exports are not available yet - services need to be updated to export interfaces
