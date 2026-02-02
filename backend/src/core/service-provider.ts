/**
 * Service Provider - Request-Scoped Service Access
 *
 * Provides request-scoped access to services through a singleton provider.
 * This class enables controllers to access services without direct imports,
 * maintaining clean architecture boundaries and enabling proper dependency injection.
 *
 * RESPONSIBILITIES:
 * - Singleton service provider for request-scoped access
 * - Centralized service access point for controllers
 * - Service lifecycle management per request
 * - Factory pattern implementation for clean architecture
 *
 * @format
 */

import { IServiceFactory, getServiceFactory } from './service-factory';
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
import { contextLogger } from './logging';

/**
 * Service Provider
 *
 * Singleton provider that gives controllers access to services through
 * a centralized factory. This eliminates the need for direct service imports
 * in controllers, maintaining clean architecture boundaries.
 * 
 * Provides both strict and safe methods for service access:
 * - Strict methods: throw errors if services are unavailable (for critical operations)
 * - Safe methods: return undefined if services are unavailable (for graceful degradation)
 */
export class ServiceProvider {
    private static instance: ServiceProvider;
    private factory: IServiceFactory;

    private constructor() {
        this.factory = getServiceFactory();
        contextLogger.info('Service Provider initialized', {
            pattern: 'singleton',
            factory: 'ServiceFactory'
        });
    }

    /**
     * Get singleton instance of ServiceProvider
     */
    static getInstance(): ServiceProvider {
        if (!ServiceProvider.instance) {
            ServiceProvider.instance = new ServiceProvider();
        }
        return ServiceProvider.instance;
    }

    /**
     * Get Auth Service instance (strict - throws if unavailable)
     */
    getAuthService(): AuthService {
        const service = this.factory.getAuthService();
        if (!service) {
            throw new Error('Auth Service is unavailable');
        }
        return service;
    }

    /**
     * Get Auth Service instance (safe - returns undefined if unavailable)
     */
    getAuthServiceSafe(): AuthService | undefined {
        return this.factory.getAuthService();
    }

    /**
     * Get Balance Service instance (strict - throws if unavailable)
     */
    getBalanceService(): BalanceService {
        const service = this.factory.getBalanceService();
        if (!service) {
            throw new Error('Balance Service is unavailable');
        }
        return service;
    }

    /**
     * Get Balance Service instance (safe - returns undefined if unavailable)
     */
    getBalanceServiceSafe(): BalanceService | undefined {
        return this.factory.getBalanceService();
    }

    /**
     * Get Position Service instance (strict - throws if unavailable)
     */
    getPositionService(): PositionService {
        const service = this.factory.getPositionService();
        if (!service) {
            throw new Error('Position Service is unavailable');
        }
        return service;
    }

    /**
     * Get Position Service instance (safe - returns undefined if unavailable)
     */
    getPositionServiceSafe(): PositionService | undefined {
        return this.factory.getPositionService();
    }

    /**
     * Get Role Management Service instance (strict - throws if unavailable)
     */
    getRoleManagementService(): RoleManagementService {
        const service = this.factory.getRoleManagementService();
        if (!service) {
            throw new Error('Role Management Service is unavailable');
        }
        return service;
    }

    /**
     * Get Role Management Service instance (safe - returns undefined if unavailable)
     */
    getRoleManagementServiceSafe(): RoleManagementService | undefined {
        return this.factory.getRoleManagementService();
    }

    /**
     * Get Role Qualification Service instance (strict - throws if unavailable)
     */
    getRoleQualificationService(): RoleQualificationService {
        const service = this.factory.getRoleQualificationService();
        if (!service) {
            throw new Error('Role Qualification Service is unavailable');
        }
        return service;
    }

    /**
     * Get Role Qualification Service instance (safe - returns undefined if unavailable)
     */
    getRoleQualificationServiceSafe(): RoleQualificationService | undefined {
        return this.factory.getRoleQualificationService();
    }

    /**
     * Get Wallet Qualification Service instance (strict - throws if unavailable)
     */
    getWalletQualificationService(): WalletQualificationService {
        const service = this.factory.getWalletQualificationService();
        if (!service) {
            throw new Error('Wallet Qualification Service is unavailable');
        }
        return service;
    }

    /**
     * Get Wallet Qualification Service instance (safe - returns undefined if unavailable)
     */
    getWalletQualificationServiceSafe(): WalletQualificationService | undefined {
        return this.factory.getWalletQualificationService();
    }

    /**
     * Get User Profile Service instance (strict - throws if unavailable)
     */
    getUserProfileService(): UserProfileService {
        const service = this.factory.getUserProfileService();
        if (!service) {
            throw new Error('User Profile Service is unavailable');
        }
        return service;
    }

    /**
     * Get User Profile Service instance (safe - returns undefined if unavailable)
     */
    getUserProfileServiceSafe(): UserProfileService | undefined {
        return this.factory.getUserProfileService();
    }

    /**
     * Get User Kodiak Service instance (strict - throws if unavailable)
     */
    getUserKodiakService(): UserKodiakService {
        const service = this.factory.getUserKodiakService();
        if (!service) {
            throw new Error('User Kodiak Service is unavailable');
        }
        return service;
    }

    /**
     * Get User Kodiak Service instance (safe - returns undefined if unavailable)
     */
    getUserKodiakServiceSafe(): UserKodiakService | undefined {
        return this.factory.getUserKodiakService();
    }

    /**
     * Get Bot Management Service instance (strict - throws if unavailable)
     */
    getBotManagementService(): BotManagementService {
        const service = this.factory.getBotManagementService();
        if (!service) {
            throw new Error('Bot Management Service is unavailable');
        }
        return service;
    }

    /**
     * Get Bot Management Service instance (safe - returns undefined if unavailable)
     */
    getBotManagementServiceSafe(): BotManagementService | undefined {
        return this.factory.getBotManagementService();
    }

    /**
     * Get Strategy Service instance (strict - throws if unavailable)
     */
    getStrategyService(): StrategyService {
        const service = this.factory.getStrategyService();
        if (!service) {
            throw new Error('Strategy Service is unavailable');
        }
        return service;
    }

    /**
     * Get Strategy Service instance (safe - returns undefined if unavailable)
     */
    getStrategyServiceSafe(): StrategyService | undefined {
        return this.factory.getStrategyService();
    }

    /**
     * Get Market Service instance (strict - throws if unavailable)
     */
    getMarketService(): MarketService {
        const service = this.factory.getMarketService();
        if (!service) {
            throw new Error('Market Service is unavailable');
        }
        return service;
    }

    /**
     * Get Market Service instance (safe - returns undefined if unavailable)
     */
    getMarketServiceSafe(): MarketService | undefined {
        return this.factory.getMarketService();
    }

    /**
     * Get Position Validator Service instance (strict - throws if unavailable)
     */
    getPositionValidatorService(): PositionValidatorService {
        const service = this.factory.getPositionValidatorService();
        if (!service) {
            throw new Error('Position Validator Service is unavailable');
        }
        return service;
    }

    /**
     * Get Position Validator Service instance (safe - returns undefined if unavailable)
     */
    getPositionValidatorServiceSafe(): PositionValidatorService | undefined {
        return this.factory.getPositionValidatorService();
    }

    /**
     * Get Position Sync Service instance (strict - throws if unavailable)
     */
    getPositionSyncService(): PositionSyncService {
        const service = this.factory.getPositionSyncService();
        if (!service) {
            throw new Error('Position Sync Service is unavailable');
        }
        return service;
    }

    /**
     * Get Position Sync Service instance (safe - returns undefined if unavailable)
     */
    getPositionSyncServiceSafe(): PositionSyncService | undefined {
        return this.factory.getPositionSyncService();
    }

    /**
     * Get Health Service instance (strict - throws if unavailable)
     */
    getHealthService(): HealthService {
        const service = this.factory.getHealthService();
        if (!service) {
            throw new Error('Health Service is unavailable');
        }
        return service;
    }

    /**
     * Get Health Service instance (safe - returns undefined if unavailable)
     */
    getHealthServiceSafe(): HealthService | undefined {
        return this.factory.getHealthService();
    }

    /**
     * Get Engine Manager instance (strict - throws if unavailable)
     */
    getEngineManager(): EngineManager {
        const service = this.factory.getEngineManager();
        if (!service) {
            throw new Error('Engine Manager is unavailable');
        }
        return service;
    }

    /**
     * Get Engine Manager instance (safe - returns undefined if unavailable)
     */
    getEngineManagerSafe(): EngineManager | undefined {
        return this.factory.getEngineManager();
    }

    /**
     * Get all services for health checks
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
        return this.factory.getAllServices();
    }

    /**
     * Check if a specific service is available
     */
    isServiceAvailable(serviceName: string): boolean {
        const services = this.getAllServices();
        const service = services[serviceName as keyof typeof services];
        return service !== undefined;
    }

    /**
     * Get list of available services
     */
    getAvailableServices(): string[] {
        return Object.entries(this.getAllServices())
            .filter(([_, service]) => service !== undefined)
            .map(([name]) => name);
    }

    /**
     * Get list of unavailable services
     */
    getUnavailableServices(): string[] {
        return Object.entries(this.getAllServices())
            .filter(([_, service]) => service === undefined)
            .map(([name]) => name);
    }

    /**
     * Health check for all services
     */
    async healthCheck(): Promise<{
        healthy: boolean;
        services: Record<string, boolean>;
        details: Record<string, unknown>;
    }> {
        return await this.factory.healthCheck();
    }

    /**
     * Get service factory for advanced usage
     */
    getFactory(): IServiceFactory {
        return this.factory;
    }
}

/**
 * Export singleton instance for immediate use in controllers
 */
export const serviceProvider = ServiceProvider.getInstance();

/**
 * Convenience functions for accessing services directly
 * These provide easy access to services without needing to import the provider
 * 
 * Strict versions (default): throw errors if services are unavailable
 * Safe versions: return undefined if services are unavailable
 */
export const getAuthService = () => serviceProvider.getAuthService();
export const getAuthServiceSafe = () => serviceProvider.getAuthServiceSafe();

export const getBalanceService = () => serviceProvider.getBalanceService();
export const getBalanceServiceSafe = () => serviceProvider.getBalanceServiceSafe();

export const getPositionService = () => serviceProvider.getPositionService();
export const getPositionServiceSafe = () => serviceProvider.getPositionServiceSafe();

export const getRoleManagementService = () => serviceProvider.getRoleManagementService();
export const getRoleManagementServiceSafe = () => serviceProvider.getRoleManagementServiceSafe();

export const getRoleQualificationService = () => serviceProvider.getRoleQualificationService();
export const getRoleQualificationServiceSafe = () => serviceProvider.getRoleQualificationServiceSafe();

export const getWalletQualificationService = () => serviceProvider.getWalletQualificationService();
export const getWalletQualificationServiceSafe = () => serviceProvider.getWalletQualificationServiceSafe();

export const getUserProfileService = () => serviceProvider.getUserProfileService();
export const getUserProfileServiceSafe = () => serviceProvider.getUserProfileServiceSafe();

export const getUserKodiakService = () => serviceProvider.getUserKodiakService();
export const getUserKodiakServiceSafe = () => serviceProvider.getUserKodiakServiceSafe();

export const getBotManagementService = () => serviceProvider.getBotManagementService();
export const getBotManagementServiceSafe = () => serviceProvider.getBotManagementServiceSafe();

export const getStrategyService = () => serviceProvider.getStrategyService();
export const getStrategyServiceSafe = () => serviceProvider.getStrategyServiceSafe();

export const getMarketService = () => serviceProvider.getMarketService();
export const getMarketServiceSafe = () => serviceProvider.getMarketServiceSafe();

export const getPositionValidatorService = () => serviceProvider.getPositionValidatorService();
export const getPositionValidatorServiceSafe = () => serviceProvider.getPositionValidatorServiceSafe();

export const getPositionSyncService = () => serviceProvider.getPositionSyncService();
export const getPositionSyncServiceSafe = () => serviceProvider.getPositionSyncServiceSafe();

export const getHealthService = () => serviceProvider.getHealthService();
export const getHealthServiceSafe = () => serviceProvider.getHealthServiceSafe();

export const getEngineManager = () => serviceProvider.getEngineManager();
export const getEngineManagerSafe = () => serviceProvider.getEngineManagerSafe();

/**
 * Service availability checking convenience functions
 */
export const isServiceAvailable = (serviceName: string) => serviceProvider.isServiceAvailable(serviceName);
export const getAvailableServices = () => serviceProvider.getAvailableServices();
export const getUnavailableServices = () => serviceProvider.getUnavailableServices();
