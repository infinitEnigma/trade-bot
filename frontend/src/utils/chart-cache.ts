/** @format */

/**
 * LRU Cache for Chart Data
 *
 * Prevents memory leaks by implementing Least Recently Used cache
 * with automatic cleanup and configurable limits.
 */

interface CacheEntry {
    data: any[];
    timestamp: number;
    accessCount: number;
    lastAccessed: number;
}

interface CacheOptions {
    maxEntries?: number; // Maximum number of cache entries
    maxDataPoints?: number; // Maximum data points per entry
    ttlMs?: number; // Time to live in milliseconds
    cleanupIntervalMs?: number; // Cleanup interval
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
        };

        this.startCleanupTimer();
    }

    // Get data from cache
    get(key: string): any[] | null {
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
    set(key: string, data: any[]): void {
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

    // Cleanup on destroy
    destroy(): void {
        this.stopCleanupTimer();
        this.clear();
    }
}

// Global singleton instance
export const chartDataCache = new ChartDataLRUCache({
    maxEntries: 10, // Max 10 symbols cached
    maxDataPoints: 1000, // Max 1000 data points per symbol
    ttlMs: 30 * 60 * 1000, // 30 minutes TTL
    cleanupIntervalMs: 5 * 60 * 1000, // Cleanup every 5 minutes
});

export default chartDataCache;
