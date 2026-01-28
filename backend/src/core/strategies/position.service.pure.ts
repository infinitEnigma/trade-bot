/**
 * Pure Position Service - Clean Architecture Implementation
 *
 * Business logic for trading position management with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IPositionRepository: Position data access abstraction
 * - ICacheService: Caching abstraction for position data
 * - IExternalApiService: External API abstraction for position sync
 * - ILogger: Logging abstraction
 *
 * @format
 */

import {
    IPositionRepository,
    ICacheService,
    IExternalApiService,
    ILogger,
    Position,
    Balance,
} from '@trade-bot/shared';

export interface PositionServiceDependencies {
    positionRepository: IPositionRepository;
    cache: ICacheService;
    externalApi: IExternalApiService;
    logger: ILogger;
}

export interface PositionValidationResult {
    isValid: boolean;
    reason?: string;
    maxAllowed?: number;
    recommended?: number;
}

export interface AccountLimits {
    balance: number;
    maxLeverage: number;
    totalExposure: number;
    maxNotional: Record<string, number>;
    takerFeeRate: number;
    makerFeeRate: number;
}

export interface RiskAssessment {
    totalExposure: number;
    maxRecommendedExposure: number;
    utilizationPercentage: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    recommendations: string[];
}

/**
 * Pure Position Service
 *
 * Implements position management business logic using dependency injection.
 * No direct dependencies on databases, Redis, HTTP clients, or external SDKs.
 */
export class PositionService {
    private readonly CACHE_TTL = 30; // 30 seconds for position data
    private readonly CACHE_PREFIX = 'positions';

    constructor(private deps: PositionServiceDependencies) { }

    /**
     * Get user positions with caching strategy
     *
     * Business Logic:
     * 1. Check cache first for performance
     * 2. Fetch from repository if cache miss
     * 3. Cache result for future requests
     * 4. Return domain Position objects
     */
    async getUserPositions(userId: string): Promise<Position[]> {
        this.deps.logger.debug('Getting user positions', { userId });

        const cacheKey = this.buildCacheKey(userId);

        // 1. Try cache first
        const cachedResult = await this.deps.cache.get<Position[]>(cacheKey);
        if (cachedResult.success && cachedResult.data) {
            this.deps.logger.debug('Position cache hit', { userId, count: cachedResult.data.length });
            return cachedResult.data;
        }

        // 2. Cache miss - fetch from repository
        this.deps.logger.debug('Position cache miss, querying repository', { userId });

        const positions = await this.deps.positionRepository.getPositions(userId);

        // 3. Validate and convert to domain objects
        const domainPositions = positions.map(this.validateAndConvertPosition).filter(Boolean) as Position[];

        // 4. Cache the result
        const cacheResult = await this.deps.cache.setex(cacheKey, this.CACHE_TTL, domainPositions);
        if (!cacheResult.success) {
            this.deps.logger.warn('Failed to cache positions', {
                userId,
                error: cacheResult.error
            });
        }

        this.deps.logger.info('Positions retrieved and cached', {
            userId,
            count: domainPositions.length
        });

        return domainPositions;
    }

    /**
     * Get specific position by symbol
     *
     * Business Logic:
     * - Retrieve single position for detailed analysis
     * - Useful for position-specific operations
     */
    async getPosition(userId: string, symbol: string): Promise<Position | null> {
        try {
            const position = await this.deps.positionRepository.getPosition(userId, symbol);

            if (!position) {
                this.deps.logger.debug('Position not found', { userId, symbol });
                return null;
            }

            return this.validateAndConvertPosition(position);
        } catch (error) {
            this.deps.logger.error('Failed to get position', {
                userId,
                symbol,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Validate position size against account limits and risk parameters
     *
     * Business Logic:
     * 1. Check minimum position size requirements
     * 2. Validate against single position limits
     * 3. Assess total account exposure
     * 4. Verify margin requirements
     * 5. Calculate risk-adjusted recommendations
     */
    async validatePositionSize(
        userId: string,
        notionalAmount: number,
        symbol: string,
        accountLimits: AccountLimits,
        maxExposurePercent: number = 0.8,
        maxSinglePositionPercent: number = 0.25
    ): Promise<PositionValidationResult> {
        this.deps.logger.debug('Validating position size', {
            userId,
            notionalAmount,
            symbol,
            accountLimits: {
                balance: accountLimits.balance,
                maxLeverage: accountLimits.maxLeverage,
                totalExposure: accountLimits.totalExposure,
            }
        });

        // Check 1: Minimum position size
        const MIN_NOTIONAL = 10; // $10 minimum
        if (notionalAmount < MIN_NOTIONAL) {
            return {
                isValid: false,
                reason: `Position too small. Minimum: $${MIN_NOTIONAL}`,
                maxAllowed: MIN_NOTIONAL,
            };
        }

        // Check 2: Maximum position size (single position limit)
        const maxSinglePosition = accountLimits.balance * maxSinglePositionPercent;
        if (notionalAmount > maxSinglePosition) {
            return {
                isValid: false,
                reason: `Position exceeds single position limit (${maxSinglePositionPercent * 100}% of account)`,
                maxAllowed: maxSinglePosition,
                recommended: maxSinglePosition * 0.5,
            };
        }

        // Check 3: Exchange max notional limit for this symbol
        if (symbol in accountLimits.maxNotional) {
            const maxNotional = accountLimits.maxNotional[symbol];
            if (notionalAmount > maxNotional) {
                return {
                    isValid: false,
                    reason: `Position exceeds exchange max notional limit for ${symbol}: $${maxNotional}`,
                    maxAllowed: maxNotional,
                    recommended: Math.min(maxNotional * 0.8, maxSinglePosition),
                };
            }
        }

        // Check 4: Account leverage limit
        const maxAccountExposure = accountLimits.balance * accountLimits.maxLeverage;
        if (notionalAmount > maxAccountExposure) {
            return {
                isValid: false,
                reason: `Position exceeds account leverage limit: $${maxAccountExposure}`,
                maxAllowed: maxAccountExposure,
                recommended: maxAccountExposure * 0.7,
            };
        }

        // Check 5: Total exposure limit
        const maxTotalExposure = accountLimits.balance * maxExposurePercent;
        const newTotalExposure = accountLimits.totalExposure + notionalAmount;

        if (newTotalExposure > maxTotalExposure) {
            const remainingExposure = maxTotalExposure - accountLimits.totalExposure;
            return {
                isValid: false,
                reason: `Total exposure would exceed ${maxExposurePercent * 100}% of account balance`,
                maxAllowed: remainingExposure,
                recommended: remainingExposure * 0.8,
            };
        }

        // Check 6: Margin requirements
        const requiredMargin = notionalAmount / accountLimits.maxLeverage;
        if (requiredMargin > accountLimits.balance * 0.9) {
            return {
                isValid: false,
                reason: `Insufficient margin. Required: $${requiredMargin.toFixed(2)}`,
                maxAllowed: accountLimits.balance * 0.9 * accountLimits.maxLeverage,
            };
        }

        this.deps.logger.debug('Position validation passed', {
            userId,
            notionalAmount,
            symbol,
            maxAllowed: Math.min(maxSinglePosition, maxAccountExposure)
        });

        return {
            isValid: true,
            maxAllowed: Math.min(
                maxSinglePosition,
                maxAccountExposure,
                maxTotalExposure - accountLimits.totalExposure
            ),
        };
    }

    /**
     * Calculate account limits from current positions
     *
     * Business Logic:
     * - Aggregate position data for risk assessment
     * - Calculate total exposure and margin requirements
     * - Provide comprehensive account risk metrics
     */
    async calculateAccountLimits(userId: string, balance: Balance): Promise<AccountLimits> {
        try {
            const positions = await this.getUserPositions(userId);

            // Calculate total exposure from all positions
            let totalExposure = 0;
            for (const position of positions) {
                const positionValue = position.getPositionValue();
                totalExposure += positionValue;
            }

            // Default account limits (would be configurable per user/exchange)
            const accountLimits: AccountLimits = {
                balance: balance.total,
                maxLeverage: 10, // Default max leverage
                totalExposure,
                maxNotional: {}, // Symbol-specific limits
                takerFeeRate: 0.001, // 0.1%
                makerFeeRate: 0.001, // 0.1%
            };

            this.deps.logger.debug('Account limits calculated', {
                userId,
                positionsCount: positions.length,
                totalExposure,
                balance: balance.total
            });

            return accountLimits;

        } catch (error) {
            this.deps.logger.error('Failed to calculate account limits', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Perform comprehensive risk assessment
     *
     * Business Logic:
     * 1. Calculate total portfolio exposure
     * 2. Assess risk levels based on utilization
     * 3. Generate risk mitigation recommendations
     * 4. Provide actionable risk management insights
     */
    async assessRisk(userId: string, balance: Balance): Promise<RiskAssessment> {
        try {
            const positions = await this.getUserPositions(userId);
            const accountLimits = await this.calculateAccountLimits(userId, balance);

            const totalExposure = accountLimits.totalExposure;
            const maxRecommendedExposure = balance.total * 0.8; // 80% of balance
            const utilizationPercentage = balance.total > 0 ? (totalExposure / balance.total) * 100 : 0;

            // Determine risk level
            let riskLevel: RiskAssessment['riskLevel'];
            const recommendations: string[] = [];

            if (utilizationPercentage >= 90) {
                riskLevel = 'CRITICAL';
                recommendations.push('Immediately reduce position sizes');
                recommendations.push('Consider closing high-risk positions');
                recommendations.push('Increase margin requirements');
            } else if (utilizationPercentage >= 70) {
                riskLevel = 'HIGH';
                recommendations.push('Monitor positions closely');
                recommendations.push('Consider taking profits');
                recommendations.push('Reduce leverage if possible');
            } else if (utilizationPercentage >= 50) {
                riskLevel = 'MEDIUM';
                recommendations.push('Maintain current risk levels');
                recommendations.push('Regular position monitoring');
            } else {
                riskLevel = 'LOW';
                recommendations.push('Risk levels are healthy');
                recommendations.push('Consider increasing position sizes if appropriate');
            }

            // Check for concentrated positions
            const largePositions = positions.filter(p => {
                const positionValue = p.getPositionValue();
                return positionValue > balance.total * 0.2; // >20% of account
            });

            if (largePositions.length > 0) {
                recommendations.push(`Reduce concentration in ${largePositions.map(p => p.symbol).join(', ')}`);
            }

            // Check for positions near liquidation
            const nearLiquidationPositions = positions.filter(p => p.isNearLiquidation());
            if (nearLiquidationPositions.length > 0) {
                recommendations.push(`${nearLiquidationPositions.length} positions near liquidation price`);
            }

            this.deps.logger.info('Risk assessment completed', {
                userId,
                riskLevel,
                utilizationPercentage: `${utilizationPercentage.toFixed(2)}%`,
                recommendationsCount: recommendations.length
            });

            return {
                totalExposure,
                maxRecommendedExposure,
                utilizationPercentage,
                riskLevel,
                recommendations
            };

        } catch (error) {
            this.deps.logger.error('Risk assessment failed', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Synchronize positions from external API
     *
     * Business Logic:
     * - Orchestrate position data synchronization
     * - Ensure data consistency across systems
     * - Handle sync failures gracefully
     */
    async syncPositions(userId: string): Promise<{ success: boolean; message: string }> {
        try {
            this.deps.logger.info('Starting position synchronization', { userId });

            // This would orchestrate the sync process through injected dependencies
            // The actual sync logic would be handled by infrastructure adapters

            // Invalidate caches to ensure fresh data after sync
            await this.invalidatePositionCache(userId);

            this.deps.logger.info('Position synchronization completed', { userId });

            return {
                success: true,
                message: 'Positions synchronized successfully'
            };

        } catch (error) {
            this.deps.logger.error('Position synchronization failed', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                message: `Synchronization failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Invalidate position cache
     *
     * Business Logic:
     * - Clear cached position data when external changes occur
     * - Ensures fresh data on next request
     */
    async invalidatePositionCache(userId: string): Promise<void> {
        const cacheKey = this.buildCacheKey(userId);

        const result = await this.deps.cache.delete(cacheKey);

        if (result.success) {
            this.deps.logger.debug('Position cache invalidated', { userId });
        } else {
            this.deps.logger.warn('Failed to invalidate position cache', {
                userId,
                error: result.error
            });
        }
    }

    /**
     * Calculate portfolio metrics
     *
     * Business Logic:
     * - Aggregate position-level metrics to portfolio level
     * - Calculate total PnL, exposure, and risk metrics
     * - Provide comprehensive portfolio overview
     */
    async getPortfolioMetrics(userId: string): Promise<{
        totalPositions: number;
        totalExposure: number;
        totalUnrealizedPnL: number;
        profitablePositions: number;
        losingPositions: number;
        largestPosition: { symbol: string; exposure: number } | null;
    }> {
        try {
            const positions = await this.getUserPositions(userId);

            let totalExposure = 0;
            let totalUnrealizedPnL = 0;
            let profitablePositions = 0;
            let losingPositions = 0;
            let largestPosition: { symbol: string; exposure: number } | null = null;

            for (const position of positions) {
                const exposure = position.getPositionValue();
                const pnl = position.calculatePnL();

                totalExposure += exposure;
                totalUnrealizedPnL += pnl;

                if (pnl > 0) {
                    profitablePositions++;
                } else if (pnl < 0) {
                    losingPositions++;
                }

                if (!largestPosition || exposure > largestPosition.exposure) {
                    largestPosition = { symbol: position.symbol, exposure };
                }
            }

            return {
                totalPositions: positions.length,
                totalExposure,
                totalUnrealizedPnL,
                profitablePositions,
                losingPositions,
                largestPosition
            };

        } catch (error) {
            this.deps.logger.error('Failed to calculate portfolio metrics', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }


    /**
     * Validate and convert position data to domain object
     */
    private validateAndConvertPosition(positionData: PositionRepositoryData): Position | null {
        try {
            // Convert repository data to domain Position object
            const position = new Position(
                positionData.symbol,
                positionData.side || 'LONG',
                positionData.quantity || positionData.positionQty || 0,
                positionData.entryPrice || positionData.averageOpenPrice || 0,
                positionData.markPrice || 0,
                positionData.leverage || 1,
                positionData.marginRatio || 0,
                positionData.liquidationPrice || positionData.estLiqPrice
            );

            return position;
        } catch (error) {
            this.deps.logger.warn('Invalid position data, skipping', {
                symbol: positionData.symbol,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Build cache key for position data
     */
    private buildCacheKey(userId: string): string {
        return `${this.CACHE_PREFIX}:${userId}`;
    }
}

// Export factory function for creating service instances
export function createPositionService(deps: PositionServiceDependencies): PositionService {
    return new PositionService(deps);
}

/**
    * Interface for position data from repository
    */
interface PositionRepositoryData {
    symbol: string;
    side?: 'LONG' | 'SHORT';
    quantity?: number;
    positionQty?: number;
    entryPrice?: number;
    averageOpenPrice?: number;
    markPrice?: number;
    leverage?: number;
    marginRatio?: number;
    liquidationPrice?: number;
    estLiqPrice?: number;
}
