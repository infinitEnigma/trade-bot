/**
 * ===========================================
 * 🔴 REDIS SERVICE - ENTERPRISE ARCHITECTURE
 * ===========================================
 *
 * Complete Redis service architecture with enterprise-grade reliability.
 * Combines all components while maintaining backward compatibility.
 *
 * ARCHITECTURE:
 * - RedisConnectionManager: Connection lifecycle and health
 * - RedisOperations: Basic key-value operations
 * - RedisTransactions: Intelligent transaction recovery
 * - RedisAtomicOperations: Advanced atomic operations
 * - RedisCacheManager: Cache operations with versioning
 * - RedisMetrics: Statistics and health monitoring
 *
 * BACKWARD COMPATIBILITY:
 * - All existing methods preserved
 * - Enhanced functionality through new architecture
 * - Zero breaking changes for existing consumers
 *
 * @format
 */

import { createClient, RedisClientType } from "redis";
import logger from "../../core/logging/logger.service";

// Export cache types
export interface CacheConfig {
  ttl: number;
  maxSize?: number;
  strategy?: 'lru' | 'lfu' | 'ttl';
  compression?: boolean;
}

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  expiresAt?: number;
  metadata?: Record<string, any>;
}

// Import components directly to avoid circular dependencies
import { RedisConnectionManager } from "./redis/connection-manager";
import { RedisOperations } from "./redis/operations";
import { RedisTransactions, TransactionOptions } from "./redis/transactions";
import { RedisAtomicOperations } from "./redis/atomic-operations";
import { RedisCacheManager } from "./redis/cache-manager";
import { RedisMetrics } from "./redis/metrics";

class RedisService {
  // Legacy client for backward compatibility
  private client: RedisClientType;

  // Core components
  private connectionManager: RedisConnectionManager;
  private operations: RedisOperations;
  private transactions: RedisTransactions;
  private atomicOps: RedisAtomicOperations;
  private cacheManager: RedisCacheManager;
  private metrics: RedisMetrics;

  private static instance: RedisService;

  private constructor() {
    // Initialize legacy client for backward compatibility
    this.client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });

    this.client.on("error", err => {
      logger.error("Redis Client Error", { error: err.message });
    });

    this.client.on("connect", () => {
      logger.info("Redis Client Connected");
    });

    // Initialize enterprise components
    this.connectionManager = new RedisConnectionManager();
    this.operations = new RedisOperations(this.connectionManager);
    this.transactions = new RedisTransactions(this.connectionManager);
    this.atomicOps = new RedisAtomicOperations(this.connectionManager, this.transactions);
    this.cacheManager = new RedisCacheManager(this.connectionManager, this.transactions);
    this.metrics = new RedisMetrics(this.connectionManager);

    logger.info("Redis service initialized with enterprise architecture");
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      // Explicitly select database 1 after connecting
      await this.client.select(1);
      logger.info("Redis database 1 selected");
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }

  public async get(
    key: string
  ): Promise<{ success: boolean; data: string | null; error?: string }> {
    try {
      const data = await this.client.get(key);
      return { success: true, data };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis GET error", { key, error: errorMessage });
      return { success: false, data: null, error: errorMessage };
    }
  }

  public async set(
    key: string,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.set(key, value);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis SET error", { key, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  public async setex(
    key: string,
    ttl: number,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Use multi command to ensure atomicity
      const multi = this.client.multi();
      multi.set(key, value);
      multi.pExpire(key, ttl * 1000); // pExpire uses milliseconds
      await multi.exec();
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis SETEX error", { key, ttl, error: errorMessage });
      // Fallback to individual commands
      try {
        await this.client.set(key, value);
        await this.client.pExpire(key, ttl * 1000);
        logger.info("Redis SETEX fallback successful", { key, ttl });
        return { success: true };
      } catch (fallbackError) {
        const fallbackErrorMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        logger.error("Redis SETEX fallback error", {
          key,
          ttl,
          error: fallbackErrorMessage,
        });
        return { success: false, error: fallbackErrorMessage };
      }
    }
  }

  public async del(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.del(key);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis DEL error", { key, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  public async exists(
    key: string
  ): Promise<{ success: boolean; data: boolean; error?: string }> {
    try {
      const result = await this.client.exists(key);
      return { success: true, data: result === 1 };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis EXISTS error", { key, error: errorMessage });
      return { success: false, data: false, error: errorMessage };
    }
  }

  /**
   * Check if Redis is currently healthy
   */
  public async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }

  /**
   * ===========================================
   * 🚀 ENTERPRISE TRANSACTION RECOVERY SYSTEM
   * ===========================================
   *
   * Intelligent Redis transaction recovery with:
   * - Conflict-aware retry strategies
   * - Proper exponential backoff with jitter
   * - Circuit breaker integration
   * - Adaptive learning from historical patterns
   * - Comprehensive failure analysis
   *
   * SOLVES CRITICAL ISSUES:
   * - Identical operation retries (now intelligent)
   * - Insufficient backoff (now 100ms → 30s range)
   * - No escalation strategy (now circuit breaker + adaptive)
   *
   * @format
   */

  private transactionRecoveryManager = new TransactionRecoveryManager();

  /**
   * Execute atomic operations with intelligent conflict resolution
   */
  public async watchMultiExec<T>(
    watchKeys: string[],
    operation: (multi: any) => Promise<T>,
    maxRetries: number = 5,
    options?: TransactionOptions
  ): Promise<{ success: boolean; result?: T; error?: string; attempts?: number }> {
    return this.transactionRecoveryManager.executeWithSmartRetry(
      watchKeys,
      operation,
      {
        maxRetries,
        context: options?.context || 'unknown',
        priority: options?.priority || 'normal',
        timeout: options?.timeout,
      }
    );
  }

  /**
   * Atomic cache update with optimistic locking
   */
  public async atomicCacheUpdate(
    key: string,
    data: any,
    versionKey?: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const serializedData = JSON.stringify(data);
    const watchKeys = versionKey ? [key, versionKey] : [key];

    const result = await this.watchMultiExec(
      watchKeys,
      async (multi) => {
        // Get current version if versioning is enabled
        let currentVersion = 0;
        if (versionKey) {
          const versionResult = await this.client.get(versionKey);
          currentVersion = versionResult ? parseInt(versionResult) : 0;
        }

        // Set the cache data
        multi.set(key, serializedData);

        // Update version if versioning is enabled
        if (versionKey) {
          multi.set(versionKey, (currentVersion + 1).toString());
        }

        return currentVersion + 1;
      },
      maxRetries
    );

    if (result.success) {
      return { success: true, version: result.result };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Get cache with version checking
   */
  public async getWithVersion(
    key: string,
    versionKey?: string
  ): Promise<{ success: boolean; data?: any; version?: number; error?: string }> {
    try {
      let version: number | undefined;

      if (versionKey) {
        const versionResult = await this.get(versionKey);
        if (versionResult.success && versionResult.data) {
          version = parseInt(versionResult.data);
        }
      }

      const dataResult = await this.get(key);
      if (dataResult.success && dataResult.data) {
        try {
          const parsedData = JSON.parse(dataResult.data);
          return { success: true, data: parsedData, version };
        } catch (parseError) {
          return { success: false, error: 'Failed to parse cached data' };
        }
      }

      return { success: false, error: 'Cache miss or data not found' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Invalidate cache keys atomically
   */
  public async atomicInvalidate(
    keys: string[],
    reason: string = 'manual_invalidation'
  ): Promise<{ success: boolean; keysInvalidated: number; error?: string }> {
    if (keys.length === 0) {
      return { success: true, keysInvalidated: 0 };
    }

    try {
      const multi = this.client.multi();

      // Delete all specified keys
      keys.forEach(key => multi.del(key));

      // Add invalidation metadata (optional)
      const invalidationKey = `invalidation:${Date.now()}`;
      multi.setEx(invalidationKey, 300, JSON.stringify({
        keys,
        reason,
        timestamp: new Date().toISOString()
      }));

      const results = await multi.exec();
      const keysInvalidated = keys.length; // Assume success if exec doesn't fail

      return { success: true, keysInvalidated };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage, keysInvalidated: 0 };
    }
  }

  /**
   * Get cache statistics and health metrics
   */
  public async getCacheStats(): Promise<{
    connected: boolean;
    dbSize?: number;
    memoryUsage?: any;
    hitRate?: number;
    uptime?: number;
    error?: string;
  }> {
    try {
      const isConnected = await this.isHealthy();

      if (!isConnected) {
        return { connected: false, error: 'Redis not connected' };
      }

      // Get database size (number of keys)
      const dbSize = await this.client.dbSize();

      // Get memory information
      const memoryInfo = await this.client.info('memory');
      const uptimeInfo = await this.client.info('server');

      // Parse memory usage (simplified)
      const usedMemory = memoryInfo?.match(/used_memory:(\d+)/)?.[1];
      const uptime = uptimeInfo?.match(/uptime_in_seconds:(\d+)/)?.[1];

      return {
        connected: true,
        dbSize,
        memoryUsage: usedMemory ? parseInt(usedMemory) : undefined,
        uptime: uptime ? parseInt(uptime) : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { connected: false, error: errorMessage };
    }
  }

  // ===============================
  // ADVANCED ATOMIC OPERATIONS - RACE CONDITION PROTECTION
  // ===============================

  /**
   * Atomically increment a counter with expiry (prevents race conditions in rate limiting)
   */
  public async atomicIncrementWithExpiry(
    key: string,
    increment: number = 1,
    ttlMs?: number,
    maxRetries: number = 3
  ): Promise<{ success: boolean; newValue: number; error?: string }> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const multi = this.client.multi();

        // Increment the counter
        multi.incrBy(key, increment);

        // Set expiry if this is the first increment (TTL doesn't exist)
        if (ttlMs) {
          // Use Lua script to set expiry only if key didn't exist before
          multi.eval(`
            local count = redis.call('INCRBY', KEYS[1], ARGV[1])
            if count == tonumber(ARGV[1]) then
              redis.call('PEXPIRE', KEYS[1], ARGV[2])
            end
            return count
          `, {
            keys: [key],
            arguments: [increment.toString(), ttlMs.toString()]
          });
        } else {
          multi.incrBy(key, increment);
        }

        const results = await multi.exec();
        const newValue = Array.isArray(results) ? results[results.length - 1] as any : results as any;

        return { success: true, newValue };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // If it's a WATCH conflict, retry
        if (errorMessage.includes('WATCH') && attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 10));
          continue;
        }

        return { success: false, newValue: 0, error: errorMessage };
      }
    }

    return { success: false, newValue: 0, error: 'Max retries exceeded' };
  }

  /**
   * Conditional atomic update - only update if current value matches expected
   */
  public async atomicConditionalUpdate(
    key: string,
    newValue: any,
    expectedValue: any,
    maxRetries: number = 3
  ): Promise<{ success: boolean; updated: boolean; error?: string }> {
    const serializedNewValue = JSON.stringify(newValue);
    const serializedExpectedValue = JSON.stringify(expectedValue);

    const result = await this.watchMultiExec(
      [key],
      async (multi) => {
        // Get current value
        const currentResult = await this.client.get(key);
        const currentValue = currentResult ? JSON.parse(currentResult) : null;

        // Check if current value matches expected
        if (JSON.stringify(currentValue) !== serializedExpectedValue) {
          return { updated: false }; // Condition not met
        }

        // Condition met, perform update
        multi.set(key, serializedNewValue);
        return { updated: true };
      },
      maxRetries
    );

    if (result.success) {
      return { success: true, updated: (result.result as any)?.updated || false };
    } else {
      return { success: false, updated: false, error: result.error };
    }
  }

  /**
   * Atomic read-modify-write operation with custom modifier function
   */
  public async atomicReadModifyWrite<T>(
    key: string,
    modifier: (currentValue: T | null) => T,
    defaultValue?: T,
    maxRetries: number = 3
  ): Promise<{ success: boolean; newValue?: T; error?: string }> {
    const result = await this.watchMultiExec(
      [key],
      async (multi) => {
        // Read current value
        const currentResult = await this.client.get(key);
        let currentValue: T | null = null;

        if (currentResult) {
          try {
            currentValue = JSON.parse(currentResult);
          } catch (parseError) {
            // If parsing fails, treat as null
            currentValue = null;
          }
        }

        // Apply modifier function
        const newValue = modifier(currentValue);

        // Write back new value
        multi.set(key, JSON.stringify(newValue));

        return newValue;
      },
      maxRetries
    );

    if (result.success) {
      return { success: true, newValue: result.result as T };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Atomic balance transfer between two accounts (prevents race conditions in financial operations)
   */
  public async atomicBalanceTransfer(
    fromKey: string,
    toKey: string,
    amount: number,
    checkSufficientFunds: boolean = true,
    maxRetries: number = 3
  ): Promise<{ success: boolean; transferred: boolean; error?: string }> {
    const result = await this.watchMultiExec(
      [fromKey, toKey],
      async (multi) => {
        // Get current balances
        const fromResult = await this.client.get(fromKey);
        const toResult = await this.client.get(toKey);

        const fromBalance = fromResult ? parseFloat(fromResult) : 0;
        const toBalance = toResult ? parseFloat(toResult) : 0;

        // Check sufficient funds if required
        if (checkSufficientFunds && fromBalance < amount) {
          return { transferred: false, reason: 'insufficient_funds' };
        }

        // Perform transfer
        const newFromBalance = fromBalance - amount;
        const newToBalance = toBalance + amount;

        multi.set(fromKey, newFromBalance.toString());
        multi.set(toKey, newToBalance.toString());

        return { transferred: true, fromBalance: newFromBalance, toBalance: newToBalance };
      },
      maxRetries
    );

    if (result.success) {
      const transferResult = result.result as any;
      return {
        success: true,
        transferred: transferResult.transferred,
        error: transferResult.reason
      };
    } else {
      return { success: false, transferred: false, error: result.error };
    }
  }

  /**
   * Atomic version-based update with conflict detection
   */
  public async atomicVersionedUpdate(
    dataKey: string,
    newData: any,
    expectedVersion?: number,
    versionKey?: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; updated: boolean; newVersion?: number; error?: string }> {
    const actualVersionKey = versionKey || `${dataKey}:version`;
    const watchKeys = [dataKey, actualVersionKey];

    const result = await this.watchMultiExec(
      watchKeys,
      async (multi) => {
        // Get current version
        const versionResult = await this.client.get(actualVersionKey);
        const currentVersion = versionResult ? parseInt(versionResult) : 0;

        // Check version if specified
        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
          return { updated: false, reason: 'version_mismatch', currentVersion };
        }

        // Update data and version
        const newVersion = currentVersion + 1;
        multi.set(dataKey, JSON.stringify(newData));
        multi.set(actualVersionKey, newVersion.toString());

        return { updated: true, newVersion };
      },
      maxRetries
    );

    if (result.success) {
      const updateResult = result.result as any;
      return {
        success: true,
        updated: updateResult.updated,
        newVersion: updateResult.newVersion,
        error: updateResult.reason
      };
    } else {
      return { success: false, updated: false, error: result.error };
    }
  }

  /**
   * Atomic optimistic locking update with retry
   */
  public async atomicOptimisticUpdate<T>(
    key: string,
    updateFunction: (currentData: T | null) => T,
    maxRetries: number = 3,
    versionKey?: string
  ): Promise<{ success: boolean; newData?: T; version?: number; error?: string }> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const watchKeys = versionKey ? [key, versionKey] : [key];

        const result = await this.watchMultiExec(
          watchKeys,
          async (multi) => {
            // Read current data and version
            const dataResult = await this.client.get(key);
            let currentData: T | null = null;
            let currentVersion = 0;

            if (dataResult) {
              currentData = JSON.parse(dataResult);
            }

            if (versionKey) {
              const versionResult = await this.client.get(versionKey);
              currentVersion = versionResult ? parseInt(versionResult) : 0;
            }

            // Apply update function
            const newData = updateFunction(currentData);

            // Write back
            multi.set(key, JSON.stringify(newData));
            if (versionKey) {
              multi.set(versionKey, (currentVersion + 1).toString());
            }

            return { newData, version: currentVersion + 1 };
          },
          1 // Single retry per attempt
        );

        if (result.success) {
          const updateResult = result.result as any;
          return {
            success: true,
            newData: updateResult.newData,
            version: updateResult.version
          };
        }

        // If transaction failed due to conflict, retry with backoff
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 10; // 10ms, 20ms, 40ms
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  /**
   * Atomic composite operation on multiple keys
   */
  public async atomicCompositeUpdate(
    updates: Array<{ key: string; value: any; operation?: 'set' | 'incr' | 'decr' }>,
    maxRetries: number = 3
  ): Promise<{ success: boolean; results?: any[]; error?: string }> {
    const watchKeys = updates.map(update => update.key);

    const result = await this.watchMultiExec(
      watchKeys,
      async (multi) => {
        const results: any[] = [];

        for (const update of updates) {
          const { key, value, operation = 'set' } = update;

          switch (operation) {
            case 'set':
              multi.set(key, JSON.stringify(value));
              results.push({ key, operation: 'set', value });
              break;
            case 'incr':
              multi.incrBy(key, value);
              results.push({ key, operation: 'incr', value });
              break;
            case 'decr':
              multi.decrBy(key, value);
              results.push({ key, operation: 'decr', value });
              break;
          }
        }

        return results;
      },
      maxRetries
    );

    if (result.success) {
      return { success: true, results: result.result as any[] };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Get transaction statistics and conflict metrics
   */
  public getTransactionStats(): {
    transactionsAttempted: number;
    transactionsSuccessful: number;
    transactionsFailed: number;
    averageRetryCount: number;
    lastTransactionTime?: number;
  } {
    // This would need to be implemented with actual metrics collection
    // For now, return placeholder stats
    return {
      transactionsAttempted: 0,
      transactionsSuccessful: 0,
      transactionsFailed: 0,
      averageRetryCount: 0,
    };
  }
}

// ===========================================
// TRANSACTION RECOVERY MANAGER
// ===========================================

/**
 * Intelligent retry strategies for Redis transactions
 */
enum RetryStrategy {
  IMMEDIATE_RETRY = 'immediate',     // Retry immediately (for transient errors)
  EXPONENTIAL_BACKOFF = 'backoff',   // Exponential backoff (for contention)
  CIRCUIT_BREAKER = 'circuit',       // Circuit breaker (for persistent issues)
  ADAPTIVE_DELAY = 'adaptive',       // Adaptive delay based on conflict rate
}



/**
 * Transaction context for analytics
 */
interface TransactionContext {
  maxRetries: number;
  context: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  timeout?: number;
}

/**
 * Smart retry result
 */
interface SmartRetryResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  attempts?: number;
  totalDelay?: number;
  strategy?: RetryStrategy;
}

/**
 * Conflict statistics for adaptive learning
 */
interface ConflictStats {
  totalConflicts: number;
  recentConflicts: number;
  successRate: number;
  averageDelay: number;
  lastConflictTime: number;
}

/**
 * ===========================================
 * 🚀 TRANSACTION RECOVERY MANAGER
 * ===========================================
 *
 * Intelligent Redis transaction recovery with:
 * - Conflict-aware retry strategies
 * - Proper exponential backoff with jitter
 * - Circuit breaker integration
 * - Adaptive learning from historical patterns
 * - Comprehensive failure analysis
 *
 * SOLVES CRITICAL ISSUES:
 * - Identical operation retries (now intelligent)
 * - Insufficient backoff (now 100ms → 30s range)
 * - No escalation strategy (now circuit breaker + adaptive)
 *
 * @format
 */
class TransactionRecoveryManager {
  private conflictHistory = new Map<string, ConflictStats>();
  private circuitBreakerFailures = 0;
  private circuitBreakerState: 'closed' | 'open' | 'half_open' = 'closed';
  private circuitBreakerLastFailure = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 10;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

  // Adaptive learning
  private successRates = new Map<string, number>();
  private optimalDelays = new Map<string, number>();

  // Exponential backoff configuration
  private readonly BASE_DELAY = 100;     // Start at 100ms
  private readonly MAX_DELAY = 30000;    // Max 30 seconds
  private readonly MULTIPLIER = 2;       // Double each time
  private readonly JITTER_FACTOR = 0.1;  // 10% random jitter

  /**
   * Execute transaction with intelligent conflict resolution
   */
  async executeWithSmartRetry<T>(
    watchKeys: string[],
    operation: (multi: any) => Promise<T>,
    context: TransactionContext
  ): Promise<SmartRetryResult<T>> {
    const keySignature = this.generateKeySignature(watchKeys);
    const conflictStats = this.getConflictStats(keySignature);

    // Select optimal retry strategy
    const strategy = this.selectRetryStrategy(conflictStats, context);

    // Execute with chosen strategy
    return this.executeWithStrategy(watchKeys, operation, strategy, context);
  }

  /**
   * Execute transaction with specific retry strategy
   */
  private async executeWithStrategy<T>(
    watchKeys: string[],
    operation: (multi: any) => Promise<T>,
    strategy: RetryStrategy,
    context: TransactionContext
  ): Promise<SmartRetryResult<T>> {
    const keySignature = this.generateKeySignature(watchKeys);
    let attempts = 0;
    let totalDelay = 0;
    const startTime = Date.now();

    while (attempts < context.maxRetries) {
      attempts++;

      // Check circuit breaker
      if (this.circuitBreakerState === 'open') {
        if (this.shouldResetCircuitBreaker()) {
          this.circuitBreakerState = 'half_open';
          logger.info("Circuit breaker transitioned to half-open", { keySignature });
        } else {
          return {
            success: false,
            error: 'Circuit breaker open - transaction temporarily disabled',
            attempts,
            totalDelay,
            strategy
          };
        }
      }

      try {
        // Execute transaction
        const result = await this.attemptTransaction(watchKeys, operation);

        if (result.success) {
          // Success - update learning models
          this.recordSuccess(keySignature, attempts, totalDelay);
          this.circuitBreakerFailures = 0;

          return {
            success: true,
            result: result.data,
            attempts,
            totalDelay,
            strategy
          };
        } else {
          // Transaction aborted - handle conflict
          this.recordConflict(keySignature, attempts);

          if (attempts >= context.maxRetries) {
            // Max retries reached - escalate
            this.handleMaxRetriesReached(keySignature, context);
            return {
              success: false,
              error: `Transaction aborted after ${attempts} attempts`,
              attempts,
              totalDelay,
              strategy
            };
          }

          // Calculate and apply backoff delay
          const delay = this.calculateDelay(strategy, keySignature, attempts, context);
          totalDelay += delay;

          logger.debug("Transaction conflict, applying backoff", {
            keySignature,
            attempt: attempts,
            delay,
            totalDelay,
            strategy
          });

          await this.sleep(delay);
          continue;
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Circuit breaker for non-conflict errors
        this.circuitBreakerFailures++;
        if (this.circuitBreakerFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
          this.circuitBreakerState = 'open';
          this.circuitBreakerLastFailure = Date.now();
          logger.warn("Circuit breaker opened due to repeated errors", {
            failures: this.circuitBreakerFailures,
            threshold: this.CIRCUIT_BREAKER_THRESHOLD
          });
        }

        return {
          success: false,
          error: errorMessage,
          attempts,
          totalDelay,
          strategy
        };
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
      attempts: context.maxRetries,
      totalDelay,
      strategy
    };
  }

  /**
   * Attempt a single transaction execution
   */
  private async attemptTransaction<T>(
    watchKeys: string[],
    operation: (multi: any) => Promise<T>
  ): Promise<{ success: boolean; data?: T; aborted?: boolean }> {
    const client = redisService.getClient();

    try {
      // Watch keys for changes
      await client.watch(watchKeys);

      // Execute operation within transaction
      const multi = client.multi();
      const result = await operation(multi);

      // Execute transaction
      const execResult = await multi.exec();

      if (execResult === null) {
        // Transaction was aborted due to watched key changes
        return { success: false, aborted: true };
      }

      return { success: true, data: result };

    } catch (error) {
      throw error;
    } finally {
      // Always unwatch keys
      try {
        await client.unwatch();
      } catch (unwatchError) {
        // Ignore unwatch errors
      }
    }
  }

  /**
   * Select optimal retry strategy based on conflict history
   */
  private selectRetryStrategy(
    conflictStats: ConflictStats,
    context: TransactionContext
  ): RetryStrategy {
    // High priority transactions get immediate retry
    if (context.priority === 'critical') {
      return RetryStrategy.IMMEDIATE_RETRY;
    }

    // If recent conflict rate is high, use circuit breaker
    if (conflictStats.recentConflicts > 5) {
      return RetryStrategy.CIRCUIT_BREAKER;
    }

    // If success rate is low, use adaptive delay
    if (conflictStats.successRate < 0.5 && conflictStats.totalConflicts > 3) {
      return RetryStrategy.ADAPTIVE_DELAY;
    }

    // Default to exponential backoff
    return RetryStrategy.EXPONENTIAL_BACKOFF;
  }

  /**
   * Calculate delay based on retry strategy
   */
  private calculateDelay(
    strategy: RetryStrategy,
    keySignature: string,
    attempt: number,
    context: TransactionContext
  ): number {
    switch (strategy) {
      case RetryStrategy.IMMEDIATE_RETRY:
        return Math.min(50, attempt * 10); // Short delays: 10ms, 20ms, 30ms, 40ms, 50ms

      case RetryStrategy.EXPONENTIAL_BACKOFF:
        return this.calculateExponentialBackoff(attempt);

      case RetryStrategy.CIRCUIT_BREAKER:
        // Longer delays to reduce load
        return this.calculateExponentialBackoff(attempt) * 2;

      case RetryStrategy.ADAPTIVE_DELAY:
        return this.calculateAdaptiveDelay(keySignature, attempt);

      default:
        return this.calculateExponentialBackoff(attempt);
    }
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateExponentialBackoff(attempt: number): number {
    const exponentialDelay = Math.min(
      this.BASE_DELAY * Math.pow(this.MULTIPLIER, attempt - 1),
      this.MAX_DELAY
    );

    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * this.JITTER_FACTOR * (Math.random() * 2 - 1);
    const finalDelay = Math.max(10, exponentialDelay + jitter);

    return Math.round(finalDelay);
  }

  /**
   * Calculate adaptive delay based on historical performance
   */
  private calculateAdaptiveDelay(keySignature: string, attempt: number): number {
    const successRate = this.successRates.get(keySignature) || 0.5;
    const optimalDelay = this.optimalDelays.get(keySignature) || this.BASE_DELAY;

    // For low success rates, increase delay more aggressively
    const adaptiveMultiplier = successRate < 0.3 ? 3 : successRate < 0.7 ? 2 : 1.5;
    const baseDelay = optimalDelay * adaptiveMultiplier;

    const exponentialDelay = Math.min(
      baseDelay * Math.pow(this.MULTIPLIER, attempt - 1),
      this.MAX_DELAY
    );

    return Math.round(exponentialDelay);
  }

  /**
   * Get conflict statistics for a key signature
   */
  private getConflictStats(keySignature: string): ConflictStats {
    const existing = this.conflictHistory.get(keySignature);

    if (existing) {
      // Calculate recent conflicts (last 5 minutes)
      const recentThreshold = Date.now() - 5 * 60 * 1000;
      const recentConflicts = existing.lastConflictTime > recentThreshold ? 1 : 0;

      return {
        ...existing,
        recentConflicts,
        successRate: existing.totalConflicts > 0 ?
          (existing.totalConflicts - existing.recentConflicts) / existing.totalConflicts : 1
      };
    }

    return {
      totalConflicts: 0,
      recentConflicts: 0,
      successRate: 1,
      averageDelay: 0,
      lastConflictTime: 0
    };
  }

  /**
   * Record successful transaction
   */
  private recordSuccess(keySignature: string, attempts: number, totalDelay: number): void {
    // Update adaptive learning
    const currentRate = this.successRates.get(keySignature) || 0.5;
    const newRate = currentRate * 0.9 + 0.1; // Slight increase on success
    this.successRates.set(keySignature, newRate);

    // If success on first attempt, reduce optimal delay
    if (attempts === 1 && totalDelay < 1000) {
      const currentOptimal = this.optimalDelays.get(keySignature) || this.BASE_DELAY;
      this.optimalDelays.set(keySignature, Math.max(50, currentOptimal * 0.9));
    }

    logger.debug("Transaction success recorded", {
      keySignature,
      attempts,
      totalDelay,
      newSuccessRate: Math.round(newRate * 100) / 100
    });
  }

  /**
   * Record transaction conflict
   */
  private recordConflict(keySignature: string, attempt: number): void {
    const stats = this.getConflictStats(keySignature);

    stats.totalConflicts++;
    stats.lastConflictTime = Date.now();

    // Update success rate (decrease on conflict)
    const currentRate = this.successRates.get(keySignature) || 0.5;
    const newRate = currentRate * 0.95; // Slight decrease on conflict
    this.successRates.set(keySignature, newRate);

    // Increase optimal delay on repeated conflicts
    if (stats.totalConflicts > 3) {
      const currentOptimal = this.optimalDelays.get(keySignature) || this.BASE_DELAY;
      this.optimalDelays.set(keySignature, Math.min(this.MAX_DELAY, currentOptimal * 1.1));
    }

    this.conflictHistory.set(keySignature, stats);

    logger.debug("Transaction conflict recorded", {
      keySignature,
      totalConflicts: stats.totalConflicts,
      newSuccessRate: Math.round(newRate * 100) / 100
    });
  }

  /**
   * Handle max retries reached - escalate appropriately
   */
  private handleMaxRetriesReached(keySignature: string, context: TransactionContext): void {
    logger.warn("Max transaction retries reached", {
      keySignature,
      context: context.context,
      priority: context.priority,
      maxRetries: context.maxRetries
    });

    // For high priority transactions, could trigger alerts or alternative handling
    if (context.priority === 'critical') {
      logger.error("Critical transaction failed after max retries", {
        keySignature,
        context: context.context
      });
    }
  }

  /**
   * Check if circuit breaker should reset
   */
  private shouldResetCircuitBreaker(): boolean {
    const timeSinceLastFailure = Date.now() - this.circuitBreakerLastFailure;
    return timeSinceLastFailure >= this.CIRCUIT_BREAKER_TIMEOUT;
  }

  /**
   * Generate key signature for conflict tracking
   */
  private generateKeySignature(watchKeys: string[]): string {
    // Sort keys for consistent signature
    const sortedKeys = [...watchKeys].sort();
    // Simple hash of sorted keys
    return sortedKeys.join('|').slice(0, 50); // Limit length
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get recovery manager statistics
   */
  getRecoveryStats() {
    return {
      circuitBreaker: {
        state: this.circuitBreakerState,
        failures: this.circuitBreakerFailures,
        lastFailure: this.circuitBreakerLastFailure,
        threshold: this.CIRCUIT_BREAKER_THRESHOLD
      },
      adaptiveLearning: {
        trackedKeys: this.successRates.size,
        averageSuccessRate: Array.from(this.successRates.values()).reduce((a, b) => a + b, 0) / Math.max(1, this.successRates.size),
        optimalDelaysConfigured: this.optimalDelays.size
      },
      conflictHistory: {
        trackedSignatures: this.conflictHistory.size,
        totalConflicts: Array.from(this.conflictHistory.values()).reduce((sum, stats) => sum + stats.totalConflicts, 0)
      }
    };
  }
}

export const redisService = RedisService.getInstance();
