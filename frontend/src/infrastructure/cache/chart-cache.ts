/** @format */

import { CandleData } from "../../shared/components/charts/CandlestickChart";
import { PriceDataPoint } from "../../features/analytics/types/analytics.types";

/**
 * LRU Cache for Chart Data
 *
 * Prevents memory leaks by implementing Least Recently Used cache
 * with automatic cleanup and configurable limits.
 */

/**
 * Union type for supported chart data formats
 * CandleData - Used for trading charts with 'time' property
 * PriceDataPoint - Used for analytics with 'timestamp' property
 */
type ChartCacheData = CandleData[] | PriceDataPoint[];

/**
 * Browser Performance Memory API interface
 * Used for memory pressure detection in supported browsers
 */
interface MemoryInfo {
    totalJSHeapSize: number;
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
}

interface CacheEntry {
    data: ChartCacheData;
    timestamp: number;
    accessCount: number;
    lastAccessed: number;
}

interface CacheOptions {
    maxEntries?: number; // Maximum number of cache entries
    maxDataPoints?: number; // Maximum data points per entry
    ttlMs?: number; // Time to live in milliseconds
    cleanupIntervalMs?: number; // Cleanup interval
    compressionEnabled?: boolean; // Enable data compression
    memoryPressureThreshold?: number; // Memory pressure threshold (0-1)
    adaptiveCleanup?: boolean; // Enable adaptive cleanup based on usage
}

class ChartDataLRUCache {
    private cache = new Map<string, CacheEntry>();
    private options: Required<CacheOptions>;
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(options: CacheOptions = {}) {
        this.options = {
            maxEntries: options.maxEntries ?? 10,
            maxDataPoints: options.maxDataPoints ?? 1000,
            ttlMs: options.ttlMs ?? 30 * 60 * 1000, // 30 minutes
            cleanupIntervalMs: options.cleanupIntervalMs ?? 5 * 60 * 1000, // 5 minutes
            compressionEnabled: options.compressionEnabled ?? false,
            memoryPressureThreshold: options.memoryPressureThreshold ?? 0.8, // 80%
            adaptiveCleanup: options.adaptiveCleanup ?? true,
        };

        this.startCleanupTimer();
    }

    // Get data from cache
    get(key: string): ChartCacheData | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if entry has expired
        if (Date.now() - entry.timestamp > this.options.ttlMs) {
            this.cache.delete(key);
            return null;
        }

        // Update access statistics
        entry.accessCount++;
        entry.lastAccessed = Date.now();

        return entry.data;
    }

    // Set data in cache
    set(key: string, data: ChartCacheData): void {
        // Limit data points per entry
        const limitedData = data.slice(-this.options.maxDataPoints);

        const entry: CacheEntry = {
            data: limitedData,
            timestamp: Date.now(),
            accessCount: 1,
            lastAccessed: Date.now(),
        };

        // If cache is full, remove least recently used entry
        if (this.cache.size >= this.options.maxEntries) {
            this.evictLRU();
        }

        this.cache.set(key, entry);

        console.log(`📊 Chart cache: Set ${key} (${limitedData.length} points, ${this.cache.size}/${this.options.maxEntries} entries)`);
    }

    // Check if key exists in cache
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // Check if entry has expired
        if (Date.now() - entry.timestamp > this.options.ttlMs) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    // Delete entry from cache
    delete(key: string): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            console.log(`📊 Chart cache: Deleted ${key}`);
        }
        return deleted;
    }

    // Clear entire cache
    clear(): void {
        const size = this.cache.size;
        this.cache.clear();
        console.log(`📊 Chart cache: Cleared all ${size} entries`);
    }

    // Get cache statistics
    getStats() {
        const entries = Array.from(this.cache.values());
        const totalDataPoints = entries.reduce((sum, entry) => sum + entry.data.length, 0);
        const totalAccessCount = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
        const averageAge = entries.length > 0
            ? entries.reduce((sum, entry) => sum + (Date.now() - entry.timestamp), 0) / entries.length / 1000 / 60
            : 0;

        return {
            entries: this.cache.size,
            maxEntries: this.options.maxEntries,
            totalDataPoints,
            maxDataPointsPerEntry: this.options.maxDataPoints,
            totalAccessCount,
            averageAgeMinutes: Math.round(averageAge),
            ttlMinutes: Math.round(this.options.ttlMs / 1000 / 60),
            keys: Array.from(this.cache.keys()),
        };
    }

    // Manual cleanup (removes expired entries and enforces limits)
    cleanup(): void {
        let expiredCount = 0;
        let evictedCount = 0;

        // Remove expired entries
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > this.options.ttlMs) {
                this.cache.delete(key);
                expiredCount++;
            }
        }

        // If still over limit, remove least recently used
        while (this.cache.size > this.options.maxEntries) {
            this.evictLRU();
            evictedCount++;
        }

        // Perform adaptive cleanup based on memory pressure
        this.adaptiveCleanup();

        if (expiredCount > 0 || evictedCount > 0) {
            console.log(`🧹 Chart cache: Cleaned up ${expiredCount} expired, ${evictedCount} LRU entries`);
        }
    }

    // Force cleanup on page visibility change (when tab becomes hidden)
    private handleVisibilityChange = () => {
        if (document.hidden) {
            // Aggressive cleanup when page is hidden
            this.cleanup();
        }
    };

    // Start automatic cleanup timer
    private startCleanupTimer(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.options.cleanupIntervalMs);

        // Also cleanup when page becomes hidden
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Stop cleanup timer
    private stopCleanupTimer(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Evict least recently used entry
    private evictLRU(): void {
        let lruKey: string | null = null;
        let lruTime = Date.now();

        for (const [key, entry] of this.cache) {
            if (entry.lastAccessed < lruTime) {
                lruTime = entry.lastAccessed;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
            console.log(`📊 Chart cache: Evicted LRU entry ${lruKey}`);
        }
    }

    // Memory pressure detection
    private checkMemoryPressure(): { pressure: number; isHigh: boolean } {
        try {
            // Use Performance.memory if available (Chrome/Edge)
            if ('memory' in performance) {
                const memInfo = performance.memory as unknown as MemoryInfo;
                const usedPercent = memInfo.usedJSHeapSize / memInfo.totalJSHeapSize;
                return {
                    pressure: usedPercent,
                    isHigh: usedPercent > this.options.memoryPressureThreshold
                };
            }

            // Fallback: estimate based on cache size
            const estimatedSize = this.cache.size * 50000; // Rough estimate: 50KB per entry
            const pressure = Math.min(estimatedSize / (50 * 1024 * 1024), 1); // Assume 50MB limit
            return {
                pressure,
                isHigh: pressure > this.options.memoryPressureThreshold
            };
        } catch {
            // If memory detection fails, assume no pressure
            return { pressure: 0, isHigh: false };
        }
    }

    // Adaptive cleanup based on memory pressure
    private adaptiveCleanup(): void {
        const { isHigh, pressure } = this.checkMemoryPressure();

        if (isHigh && this.options.adaptiveCleanup) {
            console.warn(`🚨 High memory pressure detected (${Math.round(pressure * 100)}%), aggressive cleanup`);

            // Aggressive cleanup under memory pressure
            const targetSize = Math.floor(this.options.maxEntries * 0.5); // Reduce to 50% capacity

            while (this.cache.size > targetSize) {
                this.evictLRU();
            }

            // Reduce TTL for remaining entries (temporary)
            const entries = Array.from(this.cache.entries());
            for (const [, entry] of entries) {
                // If entry is older than 5 minutes, reduce TTL
                if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
                    entry.timestamp = Date.now() - (this.options.ttlMs * 0.5); // Reduce effective TTL by half
                }
            }

            console.log(`🧹 Adaptive cleanup: Reduced cache to ${this.cache.size} entries under memory pressure`);
        }
    }

    // Prefetch data for frequently accessed keys
    prefetch(keys: string[]): void {
        // This could be extended to implement predictive caching
        // For now, just ensure these keys are prioritized in LRU
        keys.forEach(key => {
            const entry = this.cache.get(key);
            if (entry) {
                // Update last accessed to prevent early eviction
                entry.lastAccessed = Date.now();
                entry.accessCount += 0.1; // Small boost for prefetching
            }
        });
    }

    // Get memory usage statistics
    getMemoryStats() {
        const { pressure, isHigh } = this.checkMemoryPressure();
        const cacheStats = this.getStats();

        return {
            ...cacheStats,
            memoryPressure: Math.round(pressure * 100),
            isHighMemoryPressure: isHigh,
            estimatedCacheSize: this.cache.size * 50000, // Rough estimate
            pressureThreshold: this.options.memoryPressureThreshold,
        };
    }

    // Cleanup on destroy
    destroy(): void {
        this.stopCleanupTimer();
        this.clear();
    }
}

// Global singleton instance with advanced features enabled
export const chartDataCache = new ChartDataLRUCache({
    maxEntries: 10, // Max 10 symbols cached
    maxDataPoints: 1000, // Max 1000 data points per symbol
    ttlMs: 30 * 60 * 1000, // 30 minutes TTL
    cleanupIntervalMs: 5 * 60 * 1000, // Cleanup every 5 minutes
    compressionEnabled: false, // Enable compression for large datasets (future feature)
    memoryPressureThreshold: 0.8, // Trigger cleanup at 80% memory usage
    adaptiveCleanup: true, // Enable adaptive cleanup based on memory pressure
});

export default chartDataCache;
