/**
 * Service Factory - Clean Architecture Implementation
 *
 * Central factory for creating and managing service instances with proper
 * dependency injection. This factory ensures that controllers use dependency
 * injection instead of direct service imports, maintaining clean architecture
 * boundaries.
 *
 * RESPONSIBILITIES:
 * - Centralized service instantiation
 * - Proper dependency injection for all services
 * - Service lifecycle management
 * - Factory pattern implementation for testability
 *
 * @format
 */

import { diContainer } from '../infrastructure/dependency-injection.container';
import { AuthService } from './auth/auth.service.pure';
import { BalanceService } from './wallet/balance.service.pure';
import { PositionService } from './strategies/position.service.pure';
import { RoleManagementService } from './auth/role-management.service.pure';
import { RoleQualificationService } from './auth/role-qualification.service';
import { WalletQualificationService } from './wallet/wallet-qualification.service.pure';
import { UserProfileService } from './user/user-profile.service';
import { UserKodiakService } from './user/user-kodiak.service';
import { BotManagementService } from './bots/bot-management.service';
import { StrategyService } from './strategies/strategy.service';
import { MarketService } from './market/market.service';
import { HealthService } from './system/health.service.pure';
import { PositionValidatorService } from './strategies/position-validator.service.pure';
import { PositionSyncService } from './strategies/position-sync.service.pure';
import { EngineManager } from './strategies/engine-manager.service.pure';
import { IPasswordService, IUserRepository } from '@trade-bot/shared';
import { kodiakConnectionService } from '../infrastructure/external/kodiak-connection.service';
import { connectionCache } from '../infrastructure/cache/connection-cache.service';
import { contextLogger } from './logging';

/**
 * Service Factory Interface
 *
 * Defines the contract for service instantiation and management.
 * This interface enables dependency injection and testing of the factory itself.
 * 
 * All service methods return optional types to support graceful error handling.
 * Services may be undefined if instantiation fails, allowing partial system operation.
 */
export interface IServiceFactory {
    /**
     * Get Auth Service instance
     */
    getAuthService(): AuthService | undefined;

    /**
     * Get Balance Service instance
     */
    getBalanceService(): BalanceService | undefined;

    /**
     * Get Position Service instance
     */
    getPositionService(): PositionService | undefined;

    /**
     * Get Role Management Service instance
     */
    getRoleManagementService(): RoleManagementService | undefined;

    /**
     * Get Role Qualification Service instance
     */
    getRoleQualificationService(): RoleQualificationService | undefined;

    /**
     * Get Wallet Qualification Service instance
     */
    getWalletQualificationService(): WalletQualificationService | undefined;

    /**
     * Get User Profile Service instance
     */
    getUserProfileService(): UserProfileService | undefined;

    /**
     * Get User Kodiak Service instance
     */
    getUserKodiakService(): UserKodiakService | undefined;

    /**
     * Get Bot Management Service instance
     */
    getBotManagementService(): BotManagementService | undefined;

    /**
     * Get Strategy Service instance
     */
    getStrategyService(): StrategyService | undefined;

    /**
     * Get Market Service instance
     */
    getMarketService(): MarketService | undefined;

    /**
     * Get Position Validator Service instance
     */
    getPositionValidatorService(): PositionValidatorService | undefined;

    /**
     * Get Position Sync Service instance
     */
    getPositionSyncService(): PositionSyncService | undefined;

    /**
     * Get Health Service instance
     */
    getHealthService(): HealthService | undefined;

    /**
     * Get Engine Manager instance
     */
    getEngineManager(): EngineManager | undefined;

    /**
     * Get all service instances for health checks
     */
    getAllServices(): {
        authService: AuthService | undefined;
        balanceService: BalanceService | undefined;
        positionService: PositionService | undefined;
        positionValidatorService: PositionValidatorService | undefined;
        positionSyncService: PositionSyncService | undefined;
        roleManagementService: RoleManagementService | undefined;
        userProfileService: UserProfileService | undefined;
        userKodiakService: UserKodiakService | undefined;
        botManagementService: BotManagementService | undefined;
        strategyService: StrategyService | undefined;
        marketService: MarketService | undefined;
        healthService: HealthService | undefined;
        engineManager: EngineManager | undefined;
    };

    /**
     * Health check for all services
     */
    healthCheck(): Promise<{
        healthy: boolean;
        services: Record<string, boolean>;
        details: Record<string, unknown>;
    }>;
}

/**
 * Service Factory Implementation
 *
 * Implements the service factory pattern with proper dependency injection.
 * All services are created with their required dependencies from the DI container.
 */
export class ServiceFactory implements IServiceFactory {
    private readonly logger = contextLogger;

    constructor() {
        this.logger.info('Service Factory initialized', {
            implementation: 'clean-architecture',
            pattern: 'factory'
        });
    }

    /**
     * Get Auth Service instance with proper dependencies
     */
    getAuthService(): AuthService | undefined {
        try {
            const authService = diContainer.authService;
            this.logger.debug('Auth Service retrieved from container', {
                service: 'AuthService',
                implementation: 'pure'
            });
            return authService;
        } catch (error) {
            this.logger.error('Failed to get Auth Service', error instanceof Error ? error : undefined, {
                service: 'AuthService'
            });
            return undefined;
        }
    }

    /**
     * Get Balance Service instance with proper dependencies
     */
    getBalanceService(): BalanceService | undefined {
        try {
            const balanceService = diContainer.balanceService;
            this.logger.debug('Balance Service retrieved from container', {
                service: 'BalanceService',
                implementation: 'pure'
            });
            return balanceService;
        } catch (error) {
            this.logger.error('Failed to get Balance Service', error instanceof Error ? error : undefined, {
                service: 'BalanceService'
            });
            return undefined;
        }
    }

    /**
     * Get Position Service instance with proper dependencies
     */
    getPositionService(): PositionService | undefined {
        try {
            const positionService = diContainer.positionService;
            this.logger.debug('Position Service retrieved from container', {
                service: 'PositionService',
                implementation: 'pure'
            });
            return positionService;
        } catch (error) {
            this.logger.error('Failed to get Position Service', error instanceof Error ? error : undefined, {
                service: 'PositionService'
            });
            return undefined;
        }
    }

    /**
     * Get Role Management Service instance with proper dependencies
     */
    getRoleManagementService(): RoleManagementService | undefined {
        try {
            const roleManagementService = diContainer.roleManagementService;
            this.logger.debug('Role Management Service retrieved from container', {
                service: 'RoleManagementService',
                implementation: 'pure'
            });
            return roleManagementService;
        } catch (error) {
            this.logger.error('Failed to get Role Management Service', error instanceof Error ? error : undefined, {
                service: 'RoleManagementService'
            });
            return undefined;
        }
    }

    /**
     * Get Role Qualification Service instance with proper dependencies
     */
    getRoleQualificationService(): RoleQualificationService | undefined {
        try {
            const roleQualificationService = diContainer.roleQualificationService;
            this.logger.debug('Role Qualification Service retrieved from container', {
                service: 'RoleQualificationService',
                implementation: 'pure'
            });
            return roleQualificationService;
        } catch (error) {
            this.logger.error('Failed to get Role Qualification Service', error instanceof Error ? error : undefined, {
                service: 'RoleQualificationService'
            });
            return undefined;
        }
    }

    /**
     * Get Wallet Qualification Service instance with proper dependencies
     */
    getWalletQualificationService(): WalletQualificationService | undefined {
        try {
            const walletQualificationService = diContainer.walletQualificationService;
            this.logger.debug('Wallet Qualification Service retrieved from container', {
                service: 'WalletQualificationService',
                implementation: 'pure'
            });
            return walletQualificationService;
        } catch (error) {
            this.logger.error('Failed to get Wallet Qualification Service', error instanceof Error ? error : undefined, {
                service: 'WalletQualificationService'
            });
            return undefined;
        }
    }

    /**
     * Get User Profile Service instance with proper dependencies
     */
    getUserProfileService(): UserProfileService | undefined {
        try {
            const userProfileService = new UserProfileService({
                userRepository: diContainer.userRepository,
                cache: diContainer.cacheService,
                passwordService: diContainer.passwordService,
                auditLogRepository: diContainer.auditLogRepository
            });
            this.logger.debug('User Profile Service created with dependencies', {
                service: 'UserProfileService',
                dependencies: ['userRepository', 'cache', 'passwordService', 'auditLogRepository']
            });
            return userProfileService;
        } catch (error) {
            this.logger.error('Failed to create User Profile Service', error instanceof Error ? error : undefined, {
                service: 'UserProfileService'
            });
            return undefined;
        }
    }

    /**
     * Get User Kodiak Service instance with proper dependencies
     */
    getUserKodiakService(): UserKodiakService | undefined {
        try {
            const userKodiakService = new UserKodiakService({
                kodiakConnectionService,
                cache: connectionCache
            });
            this.logger.debug('User Kodiak Service created with dependencies', {
                service: 'UserKodiakService',
                dependencies: ['kodiakConnectionService', 'connectionCache']
            });
            return userKodiakService;
        } catch (error) {
            this.logger.error('Failed to create User Kodiak Service', error instanceof Error ? error : undefined, {
                service: 'UserKodiakService'
            });
            return undefined;
        }
    }

    /**
     * Get Bot Management Service instance with proper dependencies
     */
    getBotManagementService(): BotManagementService | undefined {
        try {
            const botManagementService = diContainer.botManagementService;
            this.logger.debug('Bot Management Service retrieved from container', {
                service: 'BotManagementService',
                implementation: 'pure'
            });
            return botManagementService;
        } catch (error) {
            this.logger.error('Failed to get Bot Management Service', error instanceof Error ? error : undefined, {
                service: 'BotManagementService'
            });
            return undefined;
        }
    }

    /**
     * Get Strategy Service instance with proper dependencies
     */
    getStrategyService(): StrategyService | undefined {
        try {
            const strategyService = diContainer.strategyService;
            this.logger.debug('Strategy Service retrieved from container', {
                service: 'StrategyService',
                implementation: 'pure'
            });
            return strategyService;
        } catch (error) {
            this.logger.error('Failed to get Strategy Service', error instanceof Error ? error : undefined, {
                service: 'StrategyService'
            });
            return undefined;
        }
    }

    /**
     * Get Market Service instance with proper dependencies
     */
    getMarketService(): MarketService | undefined {
        try {
            const marketService = diContainer.marketService;
            this.logger.debug('Market Service retrieved from container', {
                service: 'MarketService',
                implementation: 'pure'
            });
            return marketService;
        } catch (error) {
            this.logger.error('Failed to get Market Service', error instanceof Error ? error : undefined, {
                service: 'MarketService'
            });
            return undefined;
        }
    }

    /**
     * Get Position Validator Service instance with proper dependencies
     */
    getPositionValidatorService(): PositionValidatorService | undefined {
        try {
            const positionValidatorService = diContainer.positionValidatorService;
            this.logger.debug('Position Validator Service retrieved from container', {
                service: 'PositionValidatorService',
                implementation: 'pure'
            });
            return positionValidatorService;
        } catch (error) {
            this.logger.error('Failed to get Position Validator Service', error instanceof Error ? error : undefined, {
                service: 'PositionValidatorService'
            });
            return undefined;
        }
    }

    /**
     * Get Position Sync Service instance with proper dependencies
     */
    getPositionSyncService(): PositionSyncService | undefined {
        try {
            const positionSyncService = diContainer.positionSyncService;
            this.logger.debug('Position Sync Service retrieved from container', {
                service: 'PositionSyncService',
                implementation: 'pure'
            });
            return positionSyncService;
        } catch (error) {
            this.logger.error('Failed to get Position Sync Service', error instanceof Error ? error : undefined, {
                service: 'PositionSyncService'
            });
            return undefined;
        }
    }

    /**
     * Get Health Service instance with proper dependencies
     */
    getHealthService(): HealthService | undefined {
        try {
            const healthService = diContainer.healthService;
            this.logger.debug('Health Service retrieved from container', {
                service: 'HealthService',
                implementation: 'pure'
            });
            return healthService;
        } catch (error) {
            this.logger.error('Failed to get Health Service', error instanceof Error ? error : undefined, {
                service: 'HealthService'
            });
            return undefined;
        }
    }

    /**
     * Get Engine Manager instance with proper dependencies
     */
    getEngineManager(): EngineManager | undefined {
        try {
            const engineManager = diContainer.engineManager;
            this.logger.debug('Engine Manager retrieved from container', {
                service: 'EngineManager',
                implementation: 'pure'
            });
            return engineManager;
        } catch (error) {
            this.logger.error('Failed to get Engine Manager', error instanceof Error ? error : undefined, {
                service: 'EngineManager'
            });
            return undefined;
        }
    }

    /**
     * Get all service instances for health checks and monitoring
     */
    getAllServices(): {
        authService: AuthService | undefined;
        balanceService: BalanceService | undefined;
        positionService: PositionService | undefined;
        positionValidatorService: PositionValidatorService | undefined;
        positionSyncService: PositionSyncService | undefined;
        roleManagementService: RoleManagementService | undefined;
        userProfileService: UserProfileService | undefined;
        userKodiakService: UserKodiakService | undefined;
        botManagementService: BotManagementService | undefined;
        strategyService: StrategyService | undefined;
        marketService: MarketService | undefined;
        healthService: HealthService | undefined;
        engineManager: EngineManager | undefined;
    } {
        try {
            return {
                authService: this.getAuthService(),
                balanceService: this.getBalanceService(),
                positionService: this.getPositionService(),
                positionValidatorService: this.getPositionValidatorService(),
                positionSyncService: this.getPositionSyncService(),
                roleManagementService: this.getRoleManagementService(),
                userProfileService: this.getUserProfileService(),
                userKodiakService: this.getUserKodiakService(),
                botManagementService: this.getBotManagementService(),
                strategyService: this.getStrategyService(),
                marketService: this.getMarketService(),
                healthService: this.getHealthService(),
                engineManager: this.getEngineManager()
            };
        } catch (error) {
            this.logger.error('Failed to get all services', error instanceof Error ? error : undefined);
            // Return object with all services as undefined instead of throwing
            return {
                authService: undefined,
                balanceService: undefined,
                positionService: undefined,
                positionValidatorService: undefined,
                positionSyncService: undefined,
                roleManagementService: undefined,
                userProfileService: undefined,
                userKodiakService: undefined,
                botManagementService: undefined,
                strategyService: undefined,
                marketService: undefined,
                healthService: undefined,
                engineManager: undefined
            };
        }
    }

    /**
     * Health check for all services
     */
    async healthCheck(): Promise<{
        healthy: boolean;
        services: Record<string, boolean>;
        details: Record<string, unknown>;
    }> {
        const services: Record<string, boolean> = {};
        const details: Record<string, unknown> = {};

        try {
            const allServices = this.getAllServices();

            // Check each service
            for (const [serviceName, service] of Object.entries(allServices)) {
                try {
                    // Handle undefined services (graceful failure)
                    if (service === undefined) {
                        services[serviceName] = false;
                        details[serviceName] = {
                            healthy: false,
                            error: 'Service unavailable'
                        };
                        continue;
                    }

                    // Basic service health check for available services
                    services[serviceName] = service !== null;
                    details[serviceName] = {
                        healthy: services[serviceName],
                        type: service?.constructor?.name || 'unknown'
                    };
                } catch (serviceError) {
                    // Handle runtime errors for services that were instantiated but failed during health check
                    services[serviceName] = false;
                    details[serviceName] = {
                        healthy: false,
                        error: serviceError instanceof Error ? serviceError.message : String(serviceError)
                    };
                }
            }

            const healthy = Object.values(services).every(s => s);

            return {
                healthy,
                services,
                details
            };
        } catch (error) {
            this.logger.error('Service factory health check failed', error instanceof Error ? error : undefined);
            return {
                healthy: false,
                services: {},
                details: {
                    error: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }
}

/**
 * Export singleton instance for immediate use
 * 
 * Note: This is instantiated lazily to avoid dependency injection issues during testing.
 * The factory will be created on first access rather than at module import time.
 */
let _serviceFactory: ServiceFactory | null = null;

export function getServiceFactory(): ServiceFactory {
    if (!_serviceFactory) {
        _serviceFactory = new ServiceFactory();
    }
    return _serviceFactory;
}

// For backward compatibility, export the factory instance
export const serviceFactory = getServiceFactory();
