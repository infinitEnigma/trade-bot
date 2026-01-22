/**
 * Pure Balance Service - Clean Architecture Implementation
 *
 * Business logic for wallet balance management with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IBalanceRepository: Data access abstraction
 * - ICacheService: Caching abstraction
 * - IExternalApiService: External API abstraction
 * - ILogger: Logging abstraction
 *
 * @format
 */

import {
    IBalanceRepository,
    ICacheService,
    IExternalApiService,
    ILogger,
    Balance,
    ApiResult
} from '../../../../shared';

export interface BalanceServiceDependencies {
    balanceRepository: IBalanceRepository;
    cache: ICacheService;
    externalApi: IExternalApiService;
    logger: ILogger;
}

/**
 * Pure Balance Service
 *
 * Implements wallet balance business logic using dependency injection.
 * No direct dependencies on Redis, HTTP clients, or external SDKs.
 */
export class BalanceService {
    private readonly CACHE_TTL = 300; // 5 minutes for balance data
    private readonly CACHE_KEY_PREFIX = 'balance';

    constructor(private deps: BalanceServiceDependencies) { }

    /**
     * Get user balance with caching strategy
     *
     * Business Logic:
     * 1. Check cache first for performance
     * 2. Fetch from external API if cache miss
     * 3. Cache result for future requests
     * 4. Return domain Balance object
     */
    async getUserBalance(userId: string): Promise<Balance> {
        this.deps.logger.debug('Getting user balance', { userId });

        const cacheKey = this.buildCacheKey(userId);

        // 1. Try cache first
        const cachedResult = await this.deps.cache.get<Balance>(cacheKey);
        if (cachedResult.success && cachedResult.data) {
            this.deps.logger.debug('Balance cache hit', { userId });
            return cachedResult.data;
        }

        // 2. Cache miss - fetch from external API
        this.deps.logger.debug('Balance cache miss, fetching from API', { userId });

        const apiResult: ApiResult<Balance> = await this.deps.externalApi.getBalance(userId);

        if (!apiResult.success) {
            this.deps.logger.error('Failed to get balance from external API', {
                userId,
                error: apiResult.error
            });
            throw new Error(`Balance fetch failed: ${apiResult.error}`);
        }

        const balance = apiResult.data!;
        this.validateBalance(balance);

        // 3. Cache the result
        const cacheResult = await this.deps.cache.setex(cacheKey, this.CACHE_TTL, balance);
        if (!cacheResult.success) {
            this.deps.logger.warn('Failed to cache balance', {
                userId,
                error: cacheResult.error
            });
        }

        this.deps.logger.info('Balance retrieved and cached', {
            userId,
            total: balance.total,
            available: balance.available,
            currency: balance.currency
        });

        return balance;
    }

    /**
     * Invalidate balance cache
     *
     * Business Logic:
     * - Clear cached balance when external changes occur
     * - Ensures fresh data on next request
     */
    async invalidateBalanceCache(userId: string): Promise<void> {
        const cacheKey = this.buildCacheKey(userId);

        const result = await this.deps.cache.delete(cacheKey);

        if (result.success) {
            this.deps.logger.info('Balance cache invalidated', { userId });
        } else {
            this.deps.logger.warn('Failed to invalidate balance cache', {
                userId,
                error: result.error
            });
        }

        // Also invalidate external API cache
        await this.deps.externalApi.invalidateUserCache(userId);
    }

    /**
     * Get balance history from repository
     *
     * Business Logic:
     * - Retrieve historical balance changes
     * - Useful for audit trails and analytics
     */
    async getBalanceHistory(userId: string, limit: number = 50): Promise<any[]> {
        // Note: This would use the repository interface when implemented
        // For now, this is a placeholder for future enhancement
        this.deps.logger.debug('Getting balance history', { userId, limit });

        // This would be implemented when we add balance history to the repository
        // return await this.deps.balanceRepository.getBalanceHistory(userId, limit);

        return []; // Placeholder
    }

    /**
     * Check if user can withdraw amount
     *
     * Business Logic:
     * - Verify sufficient available balance
     * - Apply business rules for withdrawal limits
     */
    async canWithdraw(userId: string, amount: number): Promise<boolean> {
        try {
            const balance = await this.getUserBalance(userId);
            return balance.canWithdraw(amount);
        } catch (error) {
            this.deps.logger.error('Error checking withdrawal capability', {
                userId,
                amount,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Calculate balance utilization percentage
     *
     * Business Logic:
     * - Show how much of balance is locked in positions
     * - Useful for risk management and UI display
     */
    async getBalanceUtilization(userId: string): Promise<number> {
        const balance = await this.getUserBalance(userId);
        return balance.getUtilizationPercentage();
    }

    /**
     * Validate balance data integrity
     *
     * Business Logic:
     * - Ensure balance data is mathematically consistent
     * - Prevent corrupted data from propagating
     */
    private validateBalance(balance: Balance): void {
        if (!balance.isValid()) {
            this.deps.logger.error('Invalid balance data received', {
                total: balance.total,
                available: balance.available,
                locked: balance.locked,
                currency: balance.currency
            });
            throw new Error('Invalid balance data from external source');
        }
    }

    /**
     * Build cache key for balance data
     */
    private buildCacheKey(userId: string): string {
        return `${this.CACHE_KEY_PREFIX}:${userId}`;
    }
}

// Export factory function for creating service instances
export function createBalanceService(deps: BalanceServiceDependencies): BalanceService {
    return new BalanceService(deps);
}