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
} from '@trade-bot/shared';

export interface BalanceServiceDependencies {
    balanceRepository: IBalanceRepository;
    cache: ICacheService;
    externalApi: IExternalApiService;
    logger: ILogger;
}

/**
 * Legacy Balance Format - For API compatibility during migration
 *
 * Matches the format returned by the legacy impure balance service.
 * Used when LEGACY_BALANCE_API=true to maintain backward compatibility.
 */
export interface LegacyBalanceFormat {
    walletBalance: number;
    accountBalance: number;
    availableBalance: number;
    reservedBalance: number;
    totalAssets: number;
    timestamp: string;
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
     * 4. Return domain Balance object or legacy format based on feature flag
     */
    async getUserBalance(userId: string): Promise<Balance | LegacyBalanceFormat> {
        this.deps.logger.debug('Getting user balance', { userId });

        const cacheKey = this.buildCacheKey(userId);

        // 1. Try cache first
        const cachedResult = await this.deps.cache.get<Balance>(cacheKey);
        if (cachedResult.success && cachedResult.data) {
            this.deps.logger.debug('Balance cache hit', { userId });
            const balance = cachedResult.data;

            // Return legacy format if feature flag is enabled
            if (this.shouldReturnLegacyFormat()) {
                return this.convertToLegacyFormat(balance);
            }
            return balance;
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

        // Return legacy format if feature flag is enabled
        if (this.shouldReturnLegacyFormat()) {
            return this.convertToLegacyFormat(balance);
        }

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
            // Always get domain balance for business logic operations
            const balance = await this.getDomainBalance(userId);
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
        // Always get domain balance for business logic operations
        const balance = await this.getDomainBalance(userId);
        return balance.getUtilizationPercentage();
    }

    /**
     * Get domain Balance object (internal business logic method)
     *
     * Always returns the rich domain object for internal operations,
     * regardless of API compatibility settings.
     */
    private async getDomainBalance(userId: string): Promise<Balance> {
        const cacheKey = this.buildCacheKey(userId);

        // Try cache first
        const cachedResult = await this.deps.cache.get<Balance>(cacheKey);
        if (cachedResult.success && cachedResult.data) {
            return cachedResult.data;
        }

        // Cache miss - fetch from external API
        const apiResult: ApiResult<Balance> = await this.deps.externalApi.getBalance(userId);

        if (!apiResult.success) {
            throw new Error(`Balance fetch failed: ${apiResult.error}`);
        }

        const balance = apiResult.data!;
        this.validateBalance(balance);

        // Cache the result
        await this.deps.cache.setex(cacheKey, this.CACHE_TTL, balance);

        return balance;
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
     * Check if legacy API format should be returned
     *
     * Based on LEGACY_BALANCE_API environment flag for backward compatibility
     * during gradual migration to pure services.
     */
    private shouldReturnLegacyFormat(): boolean {
        return process.env.LEGACY_BALANCE_API === 'true';
    }

    /**
     * Convert domain Balance object to legacy format
     *
     * Maintains API compatibility during migration by converting
     * the rich domain object back to the flat legacy format.
     */
    private convertToLegacyFormat(balance: Balance): LegacyBalanceFormat {
        return {
            walletBalance: balance.total,
            accountBalance: balance.total,
            availableBalance: balance.available,
            reservedBalance: balance.locked,
            totalAssets: balance.total,
            timestamp: balance.lastUpdated.toISOString()
        };
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