/**
 * ===========================================
 * 🔴 REDIS SERVICE COMPONENTS
 * ===========================================
 *
 * Modular Redis service architecture with enterprise-grade reliability.
 * Provides atomic operations, intelligent transactions, and comprehensive monitoring.
 *
 * ARCHITECTURE:
 * - RedisConnectionManager: Connection lifecycle and health
 * - RedisOperations: Basic key-value operations
 * - RedisTransactions: Intelligent transaction recovery
 * - RedisAtomicOperations: Advanced atomic operations
 * - RedisCacheManager: Cache operations with versioning
 * - RedisMetrics: Statistics and health monitoring
 *
 * KEY IMPROVEMENTS:
 * ✅ Fixed race condition in transaction retry logic
 * ✅ Intelligent retry strategies (not identical operations)
 * ✅ Proper exponential backoff (100ms → 30s range)
 * ✅ Circuit breaker integration for cascade failure prevention
 * ✅ Adaptive learning from historical performance
 *
 * @format
 */

// Core components
export { RedisConnectionManager } from './connection-manager';
export type { ConnectionConfig, ConnectionHealth } from './connection-manager';

export { RedisOperations } from './operations';
export type { RedisResult } from './operations';

export { RedisTransactions } from './transactions';
export type { TransactionOptions, SmartRetryResult } from './transactions';

export { RedisAtomicOperations } from './atomic-operations';
export type { AtomicResult } from './atomic-operations';

export { RedisCacheManager } from './cache-manager';
export type { CacheResult } from './cache-manager';

export { RedisMetrics } from './metrics';
export type { CacheStats, TransactionStats, ConflictStats } from './metrics';

export { RedisStreamOperations } from './streams';
export type { StreamMessage, StreamReadOptions } from './streams';
export {
    ENGINE_COMMANDS_STREAM,
    ENGINE_EVENTS_STREAM,
    ENGINE_COMMANDS_CONSUMER_GROUP,
    ENGINE_EVENTS_CONSUMER_GROUP,
    BACKEND_CONSUMER_NAME,
    ENGINE_CONSUMER_NAME,
} from './streams';

// Legacy export for backward compatibility
export { redisService } from '../redis.service';
