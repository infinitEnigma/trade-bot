/** @format */

import { logger } from "../../core/logging";

/**
 * ===========================================
 * 💾 KODIAK RESPONSE CACHE - API Call Reduction
 * ===========================================
 *
 * Intelligent caching system for Kodiak API responses.
 * Reduces external API calls while maintaining data freshness.
 *
 * FEATURES:
 * - Time-based expiration with configurable TTL
 * - Cache hit/miss tracking for monitoring
 * - Automatic cleanup of expired entries
 * - Different TTL values per endpoint type
 * - Memory-efficient storage with access tracking
 *
 * CACHE STRATEGY:
 * - Positions: 30 seconds (frequently changing)
 * - Trades: 30 seconds (new trades appear)
 * - Balance: 15 seconds (critical financial data)
 * - Account Info: 60 seconds (rarely changes)
 *
 * @format
 */

export interface CacheEntry<T = unknown> {
    /** Cached data */
    data: T;

    /** When this entry expires (timestamp) */
    expires: number;

    /** When this entry was last accessed */
    lastAccessed: number;

    /** Cache key for identification */
    key: string;

    /** User ID that owns this cache entry */
    userId: string;

    /** Endpoint type for analytics */
    endpoint: string;
}

export interface CacheConfig {
    /** Default TTL in milliseconds */
    defaultTtlMs: number;

    /** Maximum cache entries */
    maxEntries: number;

    /** Cleanup interval in milliseconds */
    cleanupIntervalMs: number;

    /** Endpoint-specific TTL overrides */
    endpointTtlMs: {
        positions: 600000,   // ⬆️ 10min - was 30s (still reasonable for trading)
        trades: 600000,      // ⬆️ 10min - was 30s (reduce API calls)
        balance: 300000,     // ⬆️ 5min - was 15s (balance changes less frequently)
        accountInfo: 1800000,// ⬆️ 30min - was 60s (account info is stable)
        status: 300000,      // 5min - connection status (unchanged)
    };
}

/**
 * Kodiak Response Cache - Reduces external API calls
 */
export class KodiakCache<T = unknown> {
    private cache = new Map<string, CacheEntry<T>>();
    private config: Required<CacheConfig>;
    private cleanupTimer?: NodeJS.Timeout;
    private stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        cleanups: 0,
    };

    constructor(config?: Partial<CacheConfig>) {
        this.config = {
            defaultTtlMs: 30000, // 30 seconds default
            maxEntries: 1000,    // Reasonable memory usage
            cleanupIntervalMs: 60000, // Cleanup every minute
            endpointTtlMs: {
                positions: 600000,   // ⬆️ 10min - was 30s (still reasonable for trading)
                trades: 600000,      // ⬆️ 10min - was 30s (reduce API calls)
                balance: 300000,     // ⬆️ 5min - was 15s (balance changes less frequently)
                accountInfo: 1800000,// ⬆️ 30min - was 60s (account info is stable)
                status: 300000,      // 5min - connection status (unchanged)
            },
            ...config,
        };

        // Start periodic cleanup
        this.startCleanupTimer();

        logger.info("KodiakCache initialized", {
            defaultTtlMs: this.config.defaultTtlMs,
            maxEntries: this.config.maxEntries,
            cleanupIntervalMs: this.config.cleanupIntervalMs,
        });
    }

    /**
     * Get cached data if available and not expired
     */
    get(key: string): T | null {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            return null;
        }

        // Check if expired
        if (entry.expires < Date.now()) {
            this.cache.delete(key);
            this.stats.misses++;
            this.stats.evictions++;
            logger.debug("Cache entry expired and removed", {
                key,
                userId: entry.userId,
                endpoint: entry.endpoint,
                age: Date.now() - entry.lastAccessed,
            });
            return null;
        }

        // Update access time and return data
        entry.lastAccessed = Date.now();
        this.stats.hits++;
        logger.debug("Cache hit", {
            key,
            userId: entry.userId,
            endpoint: entry.endpoint,
            age: Date.now() - entry.lastAccessed,
        });

        return entry.data;
    }

    /**
     * Set data in cache with appropriate TTL
     */
    set(key: string, data: T, customTtlMs?: number): void {
        const userId = this.extractUserIdFromKey(key);
        const endpoint = this.extractEndpointFromKey(key);
        const ttlMs = customTtlMs || this.getTtlForEndpoint(endpoint);

        // Check cache size limits BEFORE adding new entry
        // Evict if adding this entry would exceed the limit
        if (this.cache.size >= this.config.maxEntries) {
            logger.debug("Cache eviction triggered", {
                currentSize: this.cache.size,
                maxSize: this.config.maxEntries,
                keyToBeAdded: key
            });
            this.evictOldest();
        }

        const entry: CacheEntry<T> = {
            data,
            expires: Date.now() + ttlMs,
            lastAccessed: Date.now(),
            key,
            userId,
            endpoint,
        };

        this.cache.set(key, entry);
        this.stats.sets++;

        logger.debug("Cache entry added", {
            key,
            cacheSize: this.cache.size,
            maxSize: this.config.maxEntries
        });
    }

    /**
     * Delete cache entry
     */
    delete(key: string): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            logger.debug("Cache entry deleted", { key });
        }
        return deleted;
    }

    /**
     * Clear all cache entries for a user
     */
    clearUserCache(userId: string): number {
        let cleared = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (entry.userId === userId) {
                this.cache.delete(key);
                cleared++;
            }
        }

        if (cleared > 0) {
            logger.info("User cache cleared", { userId, entriesCleared: cleared });
        }

        return cleared;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const now = Date.now();
        const entries = Array.from(this.cache.values());

        return {
            ...this.stats,
            totalEntries: this.cache.size,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            averageAge: entries.length > 0
                ? entries.reduce((sum, entry) => sum + (now - entry.lastAccessed), 0) / entries.length
                : 0,
            oldestEntry: entries.length > 0
                ? Math.min(...entries.map(entry => now - entry.lastAccessed))
                : 0,
            newestEntry: entries.length > 0
                ? Math.max(...entries.map(entry => now - entry.lastAccessed))
                : 0,
        };
    }

    /**
     * Get TTL for specific endpoint
     */
    private getTtlForEndpoint(endpoint: string): number {
        return this.config.endpointTtlMs[endpoint as keyof typeof this.config.endpointTtlMs] || this.config.defaultTtlMs;
    }

    /**
     * Extract user ID from cache key
     */
    private extractUserIdFromKey(key: string): string {
        // Key format: "endpoint:userId" or "endpoint:userId:extra"
        const parts = key.split(':');
        return parts.length >= 2 ? parts[1] : 'unknown';
    }

    /**
     * Extract endpoint from cache key
     */
    private extractEndpointFromKey(key: string): string {
        // Key format: "endpoint:userId" or "endpoint:userId:extra"
        const parts = key.split(':');
        return parts.length >= 1 ? parts[0] : 'unknown';
    }

    /**
     * Evict oldest entries when cache is full
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestAccess = Infinity;

        logger.debug("Starting eviction process", {
            currentSize: this.cache.size,
            maxSize: this.config.maxEntries
        });

        for (const [key, entry] of this.cache.entries()) {
            logger.debug("Checking entry for eviction", {
                key,
                lastAccessed: entry.lastAccessed,
                oldestAccess: oldestAccess
            });
            if (entry.lastAccessed < oldestAccess) {
                oldestAccess = entry.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            logger.debug("Evicting oldest entry", {
                key: oldestKey,
                age: Date.now() - oldestAccess
            });
            this.cache.delete(oldestKey);
            this.stats.evictions++;
        } else {
            logger.debug("No entry to evict found");
        }
    }

    /**
     * Periodic cleanup of expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.expires < now) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.stats.cleanups++;
            this.stats.evictions += cleaned;
            logger.debug("Cache cleanup completed", {
                entriesRemoved: cleaned,
                remainingEntries: this.cache.size,
            });
        }
    }

    /**
     * Start periodic cleanup timer
     */
    private startCleanupTimer(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.config.cleanupIntervalMs);

        // Prevent timer from keeping process alive
        this.cleanupTimer.unref();
    }

    /**
     * Stop cleanup timer
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        this.cache.clear();
        logger.info("KodiakCache destroyed");
    }
}

// Export singleton instance
export const kodiakCache = new KodiakCache();
