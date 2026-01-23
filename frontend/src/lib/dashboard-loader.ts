/** @format */

/**
 * Smart Dashboard Data Loader
 *
 * Prevents rate limiting by intelligently coordinating initial data loading after login.
 * Implements request prioritization, batching, and progressive loading.
 */

import { authApi, marketApi, balanceApi, tradingApi } from "../infrastructure/api";

interface DashboardData {
    user: any;
    balance: any;
    positions: any;
    trades: any;
    marketData?: any;
}



class DashboardLoader {
    private loading = false;
    private loadedData: Partial<DashboardData> = {};
    private loadPromise: Promise<DashboardData> | null = null;

    /**
     * Load all dashboard data with intelligent coordination
     */
    async loadDashboardData(): Promise<DashboardData> {
        // Return existing load if already in progress
        if (this.loadPromise) {
            console.log('🔄 Dashboard load already in progress, returning promise');
            return this.loadPromise;
        }

        // Prevent multiple simultaneous loads
        if (this.loading) {
            console.log('⏳ Dashboard load in progress, waiting...');
            await new Promise(resolve => setTimeout(resolve, 100));
            return this.loadDashboardData();
        }

        this.loading = true;
        console.log('🚀 Starting coordinated dashboard data load');

        this.loadPromise = this.performCoordinatedLoad();

        try {
            const result = await this.loadPromise;
            console.log('✅ Dashboard data load completed successfully');
            return result;
        } finally {
            this.loading = false;
            this.loadPromise = null;
        }
    }

    /**
     * Perform the coordinated data loading with proper sequencing
     */
    private async performCoordinatedLoad(): Promise<DashboardData> {
        const result: DashboardData = {
            user: null,
            balance: null,
            positions: null,
            trades: null,
        };

        try {
            // Phase 1: Critical data (must succeed for app to function)
            console.log('📍 Phase 1: Loading critical data');
            const criticalData = await this.loadCriticalData();
            result.user = criticalData.user;
            result.balance = criticalData.balance;

            // Phase 2: Trading data (can fail gracefully)
            console.log('📍 Phase 2: Loading trading data');
            const tradingData = await this.loadTradingData();
            result.positions = tradingData.positions;
            result.trades = tradingData.trades;

            // Phase 3: Optional data (load in background, don't block UI)
            console.log('📍 Phase 3: Loading optional data');
            this.loadOptionalData().then(optionalData => {
                if (optionalData.marketData) {
                    console.log('📊 Optional market data loaded');
                    // Could emit event to update UI
                }
            }).catch(error => {
                console.warn('⚠️ Optional data load failed (non-critical)', error);
            });

            return result;

        } catch (error) {
            console.error('❌ Dashboard data load failed', error);

            // Return partial data if available
            return {
                user: result.user || { error: 'Failed to load user data' },
                balance: result.balance || { error: 'Failed to load balance' },
                positions: result.positions || { rows: [] },
                trades: result.trades || { rows: [] },
            };
        }
    }

    /**
     * Load critical data that the app needs to function
     */
    private async loadCriticalData(): Promise<{ user: any; balance: any }> {
        console.log('🔐 Loading critical authentication data');

        // Load user profile and balance in parallel (both are essential)
        const [userResult, balanceResult] = await Promise.allSettled([
            this.loadWithRetry(() => authApi.getMe(), 'user profile', 3),
            this.loadWithRetry(() => balanceApi.getCurrentBalance(), 'balance', 3),
        ]);

        const user = userResult.status === 'fulfilled' ? userResult.value : null;
        const balance = balanceResult.status === 'fulfilled' ? balanceResult.value : null;

        if (!user) {
            throw new Error('Failed to load critical user data');
        }

        console.log('✅ Critical data loaded successfully');
        return { user, balance };
    }

    /**
     * Load trading data with graceful failure handling
     */
    private async loadTradingData(): Promise<{ positions: any; trades: any }> {
        console.log('📊 Loading trading data (can fail gracefully)');

        // Load positions and trades in parallel with error handling
        const [positionsResult, tradesResult] = await Promise.allSettled([
            this.loadWithRetry(() => tradingApi.getKodiakPositions(), 'positions', 2),
            this.loadWithRetry(() => tradingApi.getKodiakTrades(), 'trades', 2),
        ]);

        const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : { rows: [] };
        const trades = tradesResult.status === 'fulfilled' ? tradesResult.value : { rows: [] };

        console.log('✅ Trading data loaded (with graceful failure handling)');
        return { positions, trades };
    }

    /**
     * Load optional data in background (market data, etc.)
     */
    private async loadOptionalData(): Promise<{ marketData?: any }> {
        // Load market data in background with low priority
        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay to prevent immediate load

        try {
            const ticker = await marketApi.getTicker('PERP_BTC_USDC');
            console.log('📈 Optional market data loaded');
            return { marketData: ticker };
        } catch (error) {
            console.warn('⚠️ Failed to load optional market data', error);
            return {};
        }
    }

    /**
     * Load data with retry logic and proper error handling
     */
    private async loadWithRetry<T>(
        loader: () => Promise<T>,
        dataType: string,
        maxRetries: number = 2
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 Loading ${dataType} (attempt ${attempt}/${maxRetries})`);
                const result = await loader();

                if (attempt > 1) {
                    console.log(`✅ ${dataType} loaded successfully on retry ${attempt}`);
                }

                return result;
            } catch (error: any) {
                lastError = error;

                // Don't retry on authentication errors (401/403)
                if (error.response?.status === 401 || error.response?.status === 403) {
                    console.warn(`🚫 ${dataType} failed with auth error (not retrying)`, error.response?.status);
                    throw error;
                }

                // Don't retry on client errors (4xx) except rate limits
                if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
                    console.warn(`🚫 ${dataType} failed with client error (not retrying)`, error.response?.status);
                    throw error;
                }

                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
                    console.warn(`⏳ ${dataType} failed, retrying in ${delay}ms`, error.message);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        console.error(`❌ ${dataType} failed after ${maxRetries} attempts`, lastError);
        throw lastError;
    }

    /**
     * Check if dashboard data is currently loading
     */
    isLoading(): boolean {
        return this.loading;
    }

    /**
     * Get currently loaded data (partial results)
     */
    getLoadedData(): Partial<DashboardData> {
        return { ...this.loadedData };
    }

    /**
     * Clear loaded data cache
     */
    clearCache(): void {
        this.loadedData = {};
        console.log('🧹 Dashboard data cache cleared');
    }
}

// Export singleton instance
export const dashboardLoader = new DashboardLoader();