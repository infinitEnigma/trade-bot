/**
 * Pure Position Validator Service - Clean Architecture Implementation
 *
 * Business logic for position validation with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IUserRepository: User data access abstraction
 * - IPositionRepository: Position data access abstraction
 * - ICacheService: Caching abstraction for position data
 * - IExternalApiService: External API abstraction for position validation
 * - ILogger: Logging abstraction
 *
 * @format
 */

import {
    IUserRepository,
    IPositionRepository,
    ICacheService,
    IExternalApiService,
    ILogger
} from '@trade-bot/shared';

export interface PositionValidatorServiceDependencies {
    userRepository: IUserRepository;
    positionRepository: IPositionRepository;
    cache: ICacheService;
    externalApi: IExternalApiService;
    logger: ILogger;
}

export interface AccountLimits {
    balance: number;
    maxLeverage: number;
    totalExposure: number;
    maxNotional: Record<string, number>;
    takerFeeRate: number;
    makerFeeRate: number;
}

export interface PositionValidationResult {
    isValid: boolean;
    reason?: string;
    maxAllowed?: number;
    recommended?: number;
}

/**
 * Pure Position Validator Service
 *
 * Implements position validation business logic using dependency injection.
 * No direct dependencies on databases, Redis, HTTP clients, or external SDKs.
 */
export class PositionValidatorService {
    private readonly CACHE_TTL = 300; // 5 minutes for account limits

    constructor(private deps: PositionValidatorServiceDependencies) { }

    /**
     * Get account limits and current exposure from centralized service
     *
     * Business Logic:
     * 1. Get account info from external API
     * 2. Get positions from external API
     * 3. Calculate total exposure from positions
     * 4. Return comprehensive account limits
     */
    async getAccountLimits(userId: string): Promise<AccountLimits> {
        try {
            // Get account info from centralized service (uses caching)
            const accountResponse = await this.deps.externalApi.getAccountInfo(userId);

            if (!accountResponse.success || !accountResponse.data) {
                throw new Error(accountResponse.error || "Failed to get account info");
            }

            const accountData = accountResponse.data;
            this.deps.logger.info("Account info retrieved", {
                userId,
                maxLeverage: 10, // Default leverage since AccountInfo doesn't have this property
                balance: accountData.totalBalance,
            });

            // Get positions from centralized service
            const positionsResponse = await this.deps.externalApi.getPositions(userId);

            if (!positionsResponse.success || !positionsResponse.data) {
                throw new Error(positionsResponse.error || "Failed to get positions");
            }

            // Calculate total exposure from positions
            let totalExposure = 0;
            const positions = positionsResponse.data || [];
            for (const position of positions) {
                const notionalValue = Math.abs(
                    parseFloat(String(position.quantity || 0)) *
                    parseFloat(String(position.markPrice || 0))
                );
                totalExposure += notionalValue;
            }

            this.deps.logger.info("Current exposure calculated", {
                totalExposure,
                positionsCount: positions.length,
            });

            return {
                balance: parseFloat(accountData.totalBalance || "0"),
                maxLeverage: 10, // Default leverage, should be obtained from account info if available
                totalExposure,
                maxNotional: {},
                takerFeeRate: 0.001, // Default values, should come from account info if available
                makerFeeRate: 0.001,
            };
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.deps.logger.error("Failed to get account limits", {
                error: err.message,
                userId,
            });
            throw new Error(`Account validation failed: ${err.message}`);
        }
    }

    /**
     * Validate position size against account limits and risk parameters
     *
     * Business Logic:
     * 1. Check minimum position size
     * 2. Validate against single position limits
     * 3. Check symbol-specific notional limits
     * 4. Verify leverage and margin requirements
     * 5. Calculate total exposure limits
     */
    async validatePositionSize(
        notionalAmount: number,
        symbol: string,
        accountLimits: AccountLimits,
        maxExposurePercent: number = 0.8,
        maxSinglePositionPercent: number = 0.25
    ): Promise<PositionValidationResult> {
        this.deps.logger.debug("Validating position size", {
            notionalAmount,
            symbol,
            accountLimits: {
                balance: accountLimits.balance,
                maxLeverage: accountLimits.maxLeverage,
                totalExposure: accountLimits.totalExposure,
            },
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

        // Check 3: Orderly max_notional limit for this symbol
        if (symbol in accountLimits.maxNotional) {
            const maxNotional = accountLimits.maxNotional[symbol];
            if (notionalAmount > maxNotional) {
                return {
                    isValid: false,
                    reason: `Position exceeds Orderly max notional limit for ${symbol}: $${maxNotional}`,
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

        // Check 6: Margin requirements (simplified)
        const requiredMargin = notionalAmount / accountLimits.maxLeverage;
        if (requiredMargin > accountLimits.balance * 0.9) {
            return {
                isValid: false,
                reason: `Insufficient margin. Required: $${requiredMargin.toFixed(2)}`,
                maxAllowed: accountLimits.balance * 0.9 * accountLimits.maxLeverage,
            };
        }

        this.deps.logger.debug("Position validation passed", {
            notionalAmount,
            maxAllowed: Math.min(maxSinglePosition, maxAccountExposure),
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
     * Check if user has verified Kodiak credentials (without decrypting)
     * Use this when you only need to check credential existence
     */
    async hasUserKodiakCredentials(userId: string): Promise<boolean> {
        try {
            // This would be implemented through user repository when available
            // For now, we'll use a default implementation
            return true;
        } catch (error) {
            this.deps.logger.error("Failed to check user Kodiak credentials", {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            return false;
        }
    }

    /**
     * Validate user position against account limits
     *
     * Business Logic:
     * 1. Check if user has valid credentials
     * 2. Get account limits from centralized service
     * 3. Validate position size against calculated limits
     * 4. Return validation result with recommendations
     */
    async validateUserPosition(
        userId: string,
        notionalAmount: number,
        symbol: string,
        maxExposurePercent: number = 0.8
    ): Promise<PositionValidationResult> {
        try {
            // Check if user has credentials first (without decrypting)
            const hasCredentials = await this.hasUserKodiakCredentials(userId);
            if (!hasCredentials) {
                return {
                    isValid: false,
                    reason: "Kodiak credentials not configured or verified",
                };
            }

            // Get account limits using centralized service
            const accountLimits = await this.getAccountLimits(userId);

            // Validate position size against calculated limits
            return await this.validatePositionSize(
                notionalAmount,
                symbol,
                accountLimits,
                maxExposurePercent
            );

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.deps.logger.error("Position validation failed", {
                error: err.message,
                userId,
                notionalAmount,
                symbol,
            });
            return {
                isValid: false,
                reason: `Validation error: ${err.message}`,
            };
        }
    }

    /**
     * Calculate account limits from position data
     * Uses provided position data to determine account limits
     */
    async calculateAccountLimitsFromPositions(
        userId: string,
        positions: any[]
    ): Promise<AccountLimits> {
        try {
            // Get account information (balance, leverage, etc.)
            const accountInfo = await this.getAccountInfoFromCache(userId);

            // Calculate total exposure from position data
            let totalExposure = 0;
            for (const position of positions) {
                const notionalValue = Math.abs(
                    position.positionQty * position.markPrice
                );
                totalExposure += notionalValue;
            }

            this.deps.logger.debug("Account limits calculated from positions", {
                userId,
                positionsCount: positions.length,
                totalExposure,
                balance: accountInfo.balance,
            });

            return {
                balance: accountInfo.balance,
                maxLeverage: accountInfo.maxLeverage,
                totalExposure,
                maxNotional: accountInfo.maxNotional || {},
                takerFeeRate: accountInfo.takerFeeRate,
                makerFeeRate: accountInfo.makerFeeRate,
            };

        } catch (error) {
            this.deps.logger.error("Failed to calculate account limits from positions", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get account information from cache or fetch from external service
     */
    private async getAccountInfoFromCache(userId: string): Promise<{
        balance: number;
        maxLeverage: number;
        maxNotional: Record<string, number>;
        takerFeeRate: number;
        makerFeeRate: number;
    }> {
        try {
            const cacheKey = `account:info:${userId}`;
            const cacheResult = await this.deps.cache.get<string>(cacheKey);

            if (cacheResult.success && cacheResult.data) {
                const cachedInfo = JSON.parse(cacheResult.data);
                this.deps.logger.debug("Account info cache hit", { userId });
                return cachedInfo;
            }

            // Fallback to default values if no account info available
            this.deps.logger.warn("No account info found, using defaults", { userId });
            const defaultAccountInfo = {
                balance: 0,
                maxLeverage: 1,
                maxNotional: {},
                takerFeeRate: 0.001,
                makerFeeRate: 0.001,
            };

            // Cache default values
            await this.deps.cache.setex(cacheKey, this.CACHE_TTL, JSON.stringify(defaultAccountInfo));

            return defaultAccountInfo;

        } catch (error) {
            this.deps.logger.error("Failed to get account info from cache", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                balance: 0,
                maxLeverage: 1,
                maxNotional: {},
                takerFeeRate: 0.001,
                makerFeeRate: 0.001,
            };
        }
    }
}

// Export factory function for creating service instances
export function createPositionValidatorService(deps: PositionValidatorServiceDependencies): PositionValidatorService {
    return new PositionValidatorService(deps);
}