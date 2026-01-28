/** @format */

/**
 * GLOBAL ANALYTICS MANAGER
 *
 * Prevents analytics data flood by coordinating all analytics requests across the app.
 * Single manager for entire app instead of individual analytics instances.
 * Dramatically reduces API calls while maintaining data freshness and user-level limits.
 */

import { UserLevel } from "../../../../shared/src";
import { analyticsService } from "../../features/analytics/services/analyticsService";
import { AnalyticsData, AnalyticsTimeWindow } from "../../features/analytics/types/analytics.types";

interface AnalyticsSubscriber {
    callback: (data: AnalyticsData | null, error?: string) => void;
    id: string;
    symbol: string;
    timeWindow: AnalyticsTimeWindow;
}

class GlobalAnalyticsManager {
    private static instance: GlobalAnalyticsManager;
    private subscribers = new Map<string, AnalyticsSubscriber>();
    private activeRequests = new Map<string, Promise<AnalyticsData>>();
    private cachedResults = new Map<string, { data: AnalyticsData; timestamp: number; userLevel: UserLevel }>();
    private refreshTimer: NodeJS.Timeout | null = null;
    private pageVisibilityHandler: (() => void) | null = null;

    // User level limits
    private readonly USER_LIMITS = {
        [UserLevel.BASIC]: {
            maxDays: 90,
            chunkSize: 30, // Smaller chunks for basic users
            refreshInterval: 600000, // 10 minutes
        },
        [UserLevel.REGISTERED]: {
            maxDays: 180,
            chunkSize: 60,
            refreshInterval: 300000, // 5 minutes
        },
        [UserLevel.VERIFIED]: {
            maxDays: 365,
            chunkSize: 90,
            refreshInterval: 180000, // 3 minutes
        },
    };

    private readonly CACHE_TTL = 300000; // 5 minutes cache TTL
    private readonly MAX_CONCURRENT_REQUESTS = 2; // Limit concurrent analytics requests

    private constructor() {
        this.setupPageVisibilityListener();
    }

    static getInstance(): GlobalAnalyticsManager {
        if (!GlobalAnalyticsManager.instance) {
            GlobalAnalyticsManager.instance = new GlobalAnalyticsManager();
        }
        return GlobalAnalyticsManager.instance;
    }

    /**
     * Subscribe to analytics data updates
     */
    subscribe(
        id: string,
        symbol: string,
        timeWindow: AnalyticsTimeWindow,
        userLevel: UserLevel,
        callback: (data: AnalyticsData | null, error?: string) => void
    ): () => void {
        console.log(`📊 Global Analytics: Subscribing ${id} for ${symbol} ${timeWindow.value}`);

        // Apply user level limits to time window
        const limitedTimeWindow = this.applyUserLevelLimits(timeWindow, userLevel);

        this.subscribers.set(id, {
            callback,
            id,
            symbol,
            timeWindow: limitedTimeWindow
        });

        // Start global timer if this is the first subscriber
        if (this.subscribers.size === 1) {
            this.startGlobalTimer(userLevel);
        }

        // Try to serve cached data immediately
        const cachedData = this.getCachedData(symbol, limitedTimeWindow, userLevel);
        if (cachedData) {
            console.log(`📊 Global Analytics: Serving cached data for ${symbol}`);
            callback(cachedData);
        } else {
            // Trigger initial load
            this.loadAnalyticsData(symbol, limitedTimeWindow, userLevel)
                .then(data => callback(data))
                .catch(error => callback(null, error.message));
        }

        // Return unsubscribe function
        return () => this.unsubscribe(id);
    }

    /**
     * Unsubscribe from analytics updates
     */
    private unsubscribe(id: string): void {
        console.log(`📊 Global Analytics: Unsubscribing ${id}`);

        this.subscribers.delete(id);

        // Stop timer if no more subscribers
        if (this.subscribers.size === 0) {
            this.stopGlobalTimer();
        }
    }

    /**
     * Apply user level limits to time window
     */
    private applyUserLevelLimits(timeWindow: AnalyticsTimeWindow, userLevel: UserLevel): AnalyticsTimeWindow {
        const limits = this.USER_LIMITS[userLevel];
        const limitedDays = Math.min(timeWindow.days, limits.maxDays);

        return {
            ...timeWindow,
            days: limitedDays,
            value: `${limitedDays}d`
        };
    }

    /**
     * Get cached analytics data if still fresh
     */
    private getCachedData(symbol: string, timeWindow: AnalyticsTimeWindow, userLevel: UserLevel): AnalyticsData | null {
        const cacheKey = this.getCacheKey(symbol, timeWindow, userLevel);
        const cached = this.cachedResults.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
            return cached.data;
        }

        // Clean up expired cache
        if (cached) {
            this.cachedResults.delete(cacheKey);
        }

        return null;
    }

    /**
     * Load analytics data with coordination
     */
    private async loadAnalyticsData(
        symbol: string,
        timeWindow: AnalyticsTimeWindow,
        userLevel: UserLevel
    ): Promise<AnalyticsData> {
        const requestKey = `${symbol}-${timeWindow.value}`;
        const cacheKey = this.getCacheKey(symbol, timeWindow, userLevel);

        // Check if request is already in progress
        const existingRequest = this.activeRequests.get(requestKey);
        if (existingRequest) {
            console.log(`📊 Global Analytics: Reusing active request for ${requestKey}`);
            return existingRequest;
        }

        // Check concurrent request limit
        if (this.activeRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
            throw new Error('Too many concurrent analytics requests. Please try again later.');
        }

        // Create new request
        const requestPromise = this.executeAnalyticsRequest(symbol, timeWindow, userLevel);
        this.activeRequests.set(requestKey, requestPromise);

        try {
            const result = await requestPromise;
            this.cachedResults.set(cacheKey, {
                data: result,
                timestamp: Date.now(),
                userLevel
            });
            return result;
        } finally {
            this.activeRequests.delete(requestKey);
        }
    }

    /**
     * Execute the actual analytics request
     */
    private async executeAnalyticsRequest(
        symbol: string,
        timeWindow: AnalyticsTimeWindow,
        userLevel: UserLevel
    ): Promise<AnalyticsData> {
        console.log(`📊 Global Analytics: Loading ${symbol} ${timeWindow.value} for ${userLevel}`);

        try {
            // Check page visibility - don't load if page is hidden
            if (document.visibilityState === 'hidden') {
                throw new Error('Page is not visible - skipping background analytics load');
            }

            const limits = this.USER_LIMITS[userLevel];
            const result = await analyticsService.loadAnalyticsDataWithLimits(
                symbol,
                timeWindow,
                userLevel,
                limits.chunkSize
            );

            console.log(`📊 Global Analytics: Loaded ${symbol} successfully`);
            return result;

        } catch (error) {
            console.error(`📊 Global Analytics: Failed to load ${symbol}:`, error);

            // If it's a visibility error, don't throw - just return null data
            if (error instanceof Error && error.message.includes('Page is not visible')) {
                throw error;
            }

            // For other errors, rethrow
            throw error;
        }
    }

    /**
     * Start global refresh timer based on user level
     */
    private startGlobalTimer(userLevel: UserLevel): void {
        if (this.refreshTimer) return;

        const limits = this.USER_LIMITS[userLevel];
        console.log(`📊 Global Analytics: Starting global timer (${limits.refreshInterval / 1000}s)`);

        this.refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.refreshAllActiveAnalytics();
            }
        }, limits.refreshInterval);
    }

    /**
     * Stop global refresh timer
     */
    private stopGlobalTimer(): void {
        if (this.refreshTimer) {
            console.log('📊 Global Analytics: Stopping global timer');
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Refresh all active analytics subscriptions
     */
    private async refreshAllActiveAnalytics(): Promise<void> {
        if (this.subscribers.size === 0) return;

        console.log(`📊 Global Analytics: Refreshing ${this.subscribers.size} active subscriptions`);

        // Group subscribers by symbol/timeWindow to avoid duplicate requests
        const requestGroups = new Map<string, AnalyticsSubscriber[]>();

        this.subscribers.forEach(subscriber => {
            const key = `${subscriber.symbol}-${subscriber.timeWindow.value}`;
            if (!requestGroups.has(key)) {
                requestGroups.set(key, []);
            }
            requestGroups.get(key)!.push(subscriber);
        });

        // Process each unique request
        for (const [requestKey, subscribers] of requestGroups) {
            try {
                const [symbol] = requestKey.split('-');
                const subscriber = subscribers[0]; // Use first subscriber for user level

                const data = await this.loadAnalyticsData(
                    symbol,
                    subscriber.timeWindow,
                    UserLevel.VERIFIED // Default to verified for refresh (could be improved)
                );

                // Notify all subscribers for this request
                subscribers.forEach(sub => {
                    try {
                        sub.callback(data);
                    } catch (error) {
                        console.error(`📊 Global Analytics: Subscriber ${sub.id} callback failed:`, error);
                    }
                });

            } catch (error) {
                // Notify subscribers of error
                subscribers.forEach(sub => {
                    try {
                        sub.callback(null, (error as Error).message);
                    } catch (callbackError) {
                        console.error(`📊 Global Analytics: Error callback failed for ${sub.id}:`, callbackError);
                    }
                });
            }
        }
    }

    /**
     * Setup page visibility listener
     */
    private setupPageVisibilityListener(): void {
        if (typeof document !== 'undefined') {
            this.pageVisibilityHandler = () => {
                if (document.visibilityState === 'visible') {
                    console.log('📊 Global Analytics: Page became visible, resuming analytics');
                    // Could trigger a refresh here if needed
                } else {
                    console.log('📊 Global Analytics: Page hidden, analytics paused');
                }
            };

            document.addEventListener('visibilitychange', this.pageVisibilityHandler);
        }
    }

    /**
     * Get cache key for analytics data
     */
    private getCacheKey(symbol: string, timeWindow: AnalyticsTimeWindow, userLevel: UserLevel): string {
        return `analytics-${symbol}-${timeWindow.value}-${userLevel}`;
    }

    /**
     * Force refresh for specific analytics
     */
    async forceRefresh(symbol: string, timeWindow: AnalyticsTimeWindow, userLevel: UserLevel): Promise<void> {
        console.log(`📊 Global Analytics: Force refresh requested for ${symbol}`);

        const cacheKey = this.getCacheKey(symbol, timeWindow, userLevel);
        this.cachedResults.delete(cacheKey);

        await this.loadAnalyticsData(symbol, timeWindow, userLevel);
    }

    /**
     * Get subscriber count for debugging
     */
    getSubscriberCount(): number {
        return this.subscribers.size;
    }

    /**
     * Get active request count
     */
    getActiveRequestCount(): number {
        return this.activeRequests.size;
    }

    /**
     * Cleanup all subscribers and timers
     */
    cleanup(): void {
        console.log('📊 Global Analytics: Cleaning up');
        this.subscribers.clear();
        this.activeRequests.clear();
        this.cachedResults.clear();
        this.stopGlobalTimer();

        if (this.pageVisibilityHandler) {
            document.removeEventListener('visibilitychange', this.pageVisibilityHandler);
        }
    }
}

// Export singleton instance
export const globalAnalyticsManager = GlobalAnalyticsManager.getInstance();