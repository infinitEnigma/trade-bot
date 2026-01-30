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

import { IServiceFactory, ServiceFactory } from './service-factory';
import { AuthService } from './auth/auth.service.pure';
import { BalanceService } from './wallet/balance.service.pure';
import { PositionService } from './strategies/position.service.pure';
import { RoleManagementService } from './auth/role-management.service.pure';
import { RoleQualificationService } from './auth/role-qualification.service';
import { WalletQualificationService } from './wallet/wallet-qualification.service';
import { UserProfileService } from './user/user-profile.service';
import { UserKodiakService } from './user/user-kodiak.service';
import { logger } from './logging';

/**
 * Service Provider
 *
 * Singleton provider that gives controllers access to services through
 * a centralized factory. This eliminates the need for direct service imports
 * in controllers, maintaining clean architecture boundaries.
 */
export class ServiceProvider {
    private static instance: ServiceProvider;
    private factory: IServiceFactory;

    private constructor() {
        this.factory = new ServiceFactory();
        logger.info('Service Provider initialized', {
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
     * Get Auth Service instance
     */
    getAuthService(): AuthService {
        return this.factory.getAuthService();
    }

    /**
     * Get Balance Service instance
     */
    getBalanceService(): BalanceService {
        return this.factory.getBalanceService();
    }

    /**
     * Get Position Service instance
     */
    getPositionService(): PositionService {
        return this.factory.getPositionService();
    }

    /**
     * Get Role Management Service instance
     */
    getRoleManagementService(): RoleManagementService {
        return this.factory.getRoleManagementService();
    }

    /**
     * Get Role Qualification Service instance
     */
    getRoleQualificationService(): RoleQualificationService {
        return this.factory.getRoleQualificationService();
    }

    /**
     * Get Wallet Qualification Service instance
     */
    getWalletQualificationService(): WalletQualificationService {
        return this.factory.getWalletQualificationService();
    }

    /**
     * Get User Profile Service instance
     */
    getUserProfileService(): UserProfileService {
        return this.factory.getUserProfileService();
    }

    /**
     * Get User Kodiak Service instance
     */
    getUserKodiakService(): UserKodiakService {
        return this.factory.getUserKodiakService();
    }

    /**
     * Get all services for health checks
     */
    getAllServices(): {
        authService: AuthService;
        balanceService: BalanceService;
        positionService: PositionService;
        roleManagementService: RoleManagementService;
        userProfileService: UserProfileService;
        userKodiakService: UserKodiakService;
    } {
        return this.factory.getAllServices();
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
 */
export const getAuthService = () => serviceProvider.getAuthService();
export const getBalanceService = () => serviceProvider.getBalanceService();
export const getPositionService = () => serviceProvider.getPositionService();
export const getRoleManagementService = () => serviceProvider.getRoleManagementService();
export const getUserProfileService = () => serviceProvider.getUserProfileService();
export const getUserKodiakService = () => serviceProvider.getUserKodiakService();