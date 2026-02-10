/** @format */

import {
    IRoleQualificationService,
    RoleQualificationResult,
    UserRole,
    UserLevel
} from '@trade-bot/shared';
import { IUserRepository, ICacheService, ILogger, User } from '@trade-bot/shared';

/**
 * Role Qualification Service - Clean Architecture Implementation
 *
 * Business logic for role qualification with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IUserRepository: User data access abstraction
 * - ICacheService: Caching abstraction for performance
 * - ILogger: Logging abstraction
 *
 * @format
 */

export interface RoleQualificationServiceDependencies {
    userRepository: IUserRepository;
    cache: ICacheService;
    logger: ILogger;
}

/**
 * Role Qualification Service
 *
 * Implements role qualification business logic using dependency injection.
 * No direct dependencies on databases, external APIs, or infrastructure services.
 */
export class RoleQualificationService implements IRoleQualificationService {

    constructor(private deps: RoleQualificationServiceDependencies) { }

    /**
     * Check if user qualifies for a role
     *
     * Business Logic:
     * - Get user data from repository
     * - Apply role-specific qualification rules
     * - Return qualification result with criteria
     */
    async checkQualification(userId: string, role: UserRole): Promise<RoleQualificationResult> {
        try {
            this.deps.logger.debug("Role qualification check", { userId, role });

            // Get user data
            const user = await this.deps.userRepository.findById(userId);
            if (!user) {
                return {
                    qualified: false,
                    reason: 'User not found'
                };
            }

            // Apply role-specific qualification rules
            switch (role) {
                case UserRole.QUALIFIED_ALPHA:
                    return this.checkAlphaQualification(user);
                default:
                    return {
                        qualified: false,
                        reason: `Unknown role: ${role}`
                    };
            }

        } catch (error) {
            this.deps.logger.error("Role qualification check failed", {
                userId,
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                qualified: false,
                reason: 'Qualification check failed'
            };
        }
    }

    /**
     * Get qualification criteria for a role
     */
    async getQualificationCriteria(role: UserRole): Promise<unknown> {
        try {
            switch (role) {
                case UserRole.QUALIFIED_ALPHA:
                    return {
                        userLevel: UserLevel.VERIFIED,
                        hasKodiakCredentials: true,
                        minimumAccountAge: 30, // days
                        hasCompletedTrades: true
                    };
                default:
                    return null;
            }
        } catch (error) {
            this.deps.logger.error("Failed to get qualification criteria", {
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Validate qualification criteria
     */
    validateCriteria(criteria: unknown, role: UserRole): boolean {
        try {
            if (!criteria || typeof criteria !== 'object') {
                return false;
            }

            const criteriaObj = criteria as Record<string, unknown>;

            switch (role) {
                case UserRole.QUALIFIED_ALPHA:
                    return this.validateAlphaCriteria(criteriaObj);
                default:
                    return false;
            }
        } catch (error) {
            this.deps.logger.error("Failed to validate qualification criteria", {
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Check if user qualifies for QUALIFIED_ALPHA role
     */
    private async checkAlphaQualification(user: User): Promise<RoleQualificationResult> {
        // Check basic user level
        if (user.userLevel !== UserLevel.VERIFIED) {
            return {
                qualified: false,
                reason: 'User must be verified',
                criteria: {
                    currentLevel: user.userLevel,
                    requiredLevel: UserLevel.VERIFIED
                }
            };
        }

        // Check if user has Kodiak credentials (simplified check)
        // In a real implementation, this would check the kodiak_credentials table
        const hasKodiakCredentials = await this.checkUserHasKodiakCredentials(user.id);
        if (!hasKodiakCredentials) {
            return {
                qualified: false,
                reason: 'User must have Kodiak credentials',
                criteria: {
                    hasKodiakCredentials: false
                }
            };
        }

        // Check account age (simplified - at least 30 days old)
        const accountAgeDays = this.getAccountAgeDays(user.createdAt);
        if (accountAgeDays < 30) {
            return {
                qualified: false,
                reason: 'Account must be at least 30 days old',
                criteria: {
                    accountAgeDays,
                    minimumRequiredDays: 30
                }
            };
        }

        // Check if user has completed trades (simplified check)
        const hasCompletedTrades = await this.checkUserHasCompletedTrades(user.id);
        if (!hasCompletedTrades) {
            return {
                qualified: false,
                reason: 'User must have completed trades',
                criteria: {
                    hasCompletedTrades: false
                }
            };
        }

        // All criteria met
        return {
            qualified: true,
            criteria: {
                userLevel: user.userLevel,
                hasKodiakCredentials: true,
                accountAgeDays,
                hasCompletedTrades: true
            }
        };
    }

    /**
     * Validate QUALIFIED_ALPHA criteria
     */
    private validateAlphaCriteria(criteria: Record<string, unknown>): boolean {
        return (
            criteria.userLevel === UserLevel.VERIFIED &&
            typeof criteria.hasKodiakCredentials === 'boolean' &&
            typeof criteria.minimumAccountAge === 'number' &&
            typeof criteria.hasCompletedTrades === 'boolean'
        );
    }

    /**
     * Check if user has Kodiak credentials
     * This would normally query the kodiak_credentials table
     */
    private async checkUserHasKodiakCredentials(userId: string): Promise<boolean> {
        try {
            // This is a placeholder implementation
            // In reality, this would use a KodiakCredentialsRepository
            // For now, we'll assume all verified users have credentials
            return true;
        } catch (error) {
            this.deps.logger.error("Failed to check Kodiak credentials", {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Check if user has completed trades
     * This would normally query the trades table
     */
    private async checkUserHasCompletedTrades(userId: string): Promise<boolean> {
        try {
            // This is a placeholder implementation
            // In reality, this would use a TradeRepository
            // For now, we'll assume all users have completed trades
            return true;
        } catch (error) {
            this.deps.logger.error("Failed to check completed trades", {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Calculate account age in days
     */
    private getAccountAgeDays(createdAt: Date): number {
        const now = new Date();
        const diff = now.getTime() - createdAt.getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    }
}

// Export factory function for creating service instances
export function createRoleQualificationService(deps: RoleQualificationServiceDependencies): RoleQualificationService {
    return new RoleQualificationService(deps);
}