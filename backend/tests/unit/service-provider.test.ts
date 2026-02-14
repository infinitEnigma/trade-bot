/**
 * Service Provider Unit Tests
 *
 * Comprehensive testing of the ServiceProvider singleton pattern.
 * Tests cover singleton behavior, thread safety, and service access.
 */

import { ServiceProvider } from '../../src/core/service-provider';
import { contextLogger } from '../../src/core/logging';
import { AuthService } from '../../src/core/auth/auth.service.pure';
import { BalanceService } from '../../src/core/wallet/balance.service.pure';
import { PositionService } from '../../src/core/strategies/position.service.pure';
import { RoleManagementService } from '../../src/core/auth/role-management.service.pure';
import { RoleQualificationService } from '../../src/core/auth/role-qualification.service';
import { WalletQualificationService } from '../../src/core/wallet/wallet-qualification.service.pure';
import { UserProfileService } from '../../src/core/user/user-profile.service';
import { UserKodiakService } from '../../src/core/user/user-kodiak.service';
import { BotManagementService } from '../../src/core/bots/bot-management.service';
import { StrategyService } from '../../src/core/strategies/strategy.service';
import { MarketService } from '../../src/core/market/market.service';
import { HealthService } from '../../src/core/system/health.service.pure';
import { PositionValidatorService } from '../../src/core/strategies/position-validator.service.pure';
import { PositionSyncService } from '../../src/core/strategies/position-sync.service.pure';
import { EngineManager } from '../../src/core/strategies/engine-manager.service.pure';
import { serviceProvider, getAuthService, getAuthServiceSafe, getBalanceService, getBalanceServiceSafe, getPositionService, getPositionServiceSafe, getRoleManagementService, getRoleManagementServiceSafe, getRoleQualificationService, getRoleQualificationServiceSafe, getWalletQualificationService, getWalletQualificationServiceSafe, getUserProfileService, getUserProfileServiceSafe, getUserKodiakService, getUserKodiakServiceSafe, getBotManagementService, getBotManagementServiceSafe, getStrategyService, getStrategyServiceSafe, getMarketService, getMarketServiceSafe, getPositionValidatorService, getPositionValidatorServiceSafe, getPositionSyncService, getPositionSyncServiceSafe, getHealthService, getHealthServiceSafe, getEngineManager, getEngineManagerSafe, isServiceAvailable, getAvailableServices, getUnavailableServices } from '../../src/core/service-provider';

// Mock dependencies
jest.mock('../../src/core/logging');

// Mock @noble/ed25519 module to avoid Jest parse errors
jest.mock('@noble/ed25519', () => ({
    sign: jest.fn(),
    verify: jest.fn(),
    getPublicKey: jest.fn(),
    keygen: jest.fn(),
    etc: jest.fn(),
    getPublicKeyAsync: jest.fn(),
    hash: jest.fn(),
    hashes: jest.fn(),
    keygenAsync: jest.fn(),
    Point: jest.fn(),
    signAsync: jest.fn(),
    utils: jest.fn(),
    verifyAsync: jest.fn(),
}));

describe('Service Provider Singleton', () => {
    let mockLogger: jest.Mocked<typeof contextLogger>;

    beforeEach(() => {
        mockLogger = contextLogger as jest.Mocked<typeof contextLogger>;
    });

    describe('Singleton Pattern', () => {
        test('should return same instance across multiple calls', () => {
            const instance1 = ServiceProvider.getInstance();
            const instance2 = ServiceProvider.getInstance();
            expect(instance1).toBe(instance2);
            expect(instance1).toBeInstanceOf(ServiceProvider);
        });

        test('should create only one instance', () => {
            const instance1 = ServiceProvider.getInstance();
            const instance2 = ServiceProvider.getInstance();
            const instance3 = ServiceProvider.getInstance();
            expect(instance1).toBe(instance2);
            expect(instance2).toBe(instance3);
            expect(instance1).toBe(instance3);
        });

        test('should maintain singleton across different access patterns', () => {
            const instances: ServiceProvider[] = [];
            instances.push(ServiceProvider.getInstance());
            instances.push(ServiceProvider.getInstance());
            const serviceProviderRef = ServiceProvider;
            instances.push(serviceProviderRef.getInstance());
            instances.forEach((instance, index) => {
                if (index > 0) {
                    expect(instance).toBe(instances[0]);
                }
            });
        });
    });

    describe('Service Access Methods', () => {
        let serviceProvider: ServiceProvider;

        beforeEach(() => {
            serviceProvider = ServiceProvider.getInstance();
        });

        test('should provide all service types', () => {
            // Mock the factory
            const mockFactory = {
                getAuthService: jest.fn().mockReturnValue({}),
                getBalanceService: jest.fn().mockReturnValue({}),
                getPositionService: jest.fn().mockReturnValue({}),
                getRoleManagementService: jest.fn().mockReturnValue({}),
                getRoleQualificationService: jest.fn().mockReturnValue({}),
                getWalletQualificationService: jest.fn().mockReturnValue({}),
                getUserProfileService: jest.fn().mockReturnValue({}),
                getUserKodiakService: jest.fn().mockReturnValue({}),
                getBotManagementService: jest.fn().mockReturnValue({}),
                getStrategyService: jest.fn().mockReturnValue({}),
                getMarketService: jest.fn().mockReturnValue({}),
                getPositionValidatorService: jest.fn().mockReturnValue({}),
                getPositionSyncService: jest.fn().mockReturnValue({}),
                getHealthService: jest.fn().mockReturnValue({}),
                getEngineManager: jest.fn().mockReturnValue({}),
                getAllServices: jest.fn().mockReturnValue({}),
                healthCheck: jest.fn()
            };

            (serviceProvider as any).factory = mockFactory;

            // Test strict methods
            expect(serviceProvider.getAuthService()).toBeDefined();
            expect(serviceProvider.getBalanceService()).toBeDefined();
            expect(serviceProvider.getPositionService()).toBeDefined();
            expect(serviceProvider.getRoleManagementService()).toBeDefined();
            expect(serviceProvider.getRoleQualificationService()).toBeDefined();
            expect(serviceProvider.getWalletQualificationService()).toBeDefined();
            expect(serviceProvider.getUserProfileService()).toBeDefined();
            expect(serviceProvider.getUserKodiakService()).toBeDefined();
            expect(serviceProvider.getBotManagementService()).toBeDefined();
            expect(serviceProvider.getStrategyService()).toBeDefined();
            expect(serviceProvider.getMarketService()).toBeDefined();
            expect(serviceProvider.getPositionValidatorService()).toBeDefined();
            expect(serviceProvider.getPositionSyncService()).toBeDefined();
            expect(serviceProvider.getHealthService()).toBeDefined();
            expect(serviceProvider.getEngineManager()).toBeDefined();

            // Test safe methods
            expect(serviceProvider.getAuthServiceSafe()).toBeDefined();
            expect(serviceProvider.getBalanceServiceSafe()).toBeDefined();
            expect(serviceProvider.getPositionServiceSafe()).toBeDefined();
            expect(serviceProvider.getRoleManagementServiceSafe()).toBeDefined();
            expect(serviceProvider.getRoleQualificationServiceSafe()).toBeDefined();
            expect(serviceProvider.getWalletQualificationServiceSafe()).toBeDefined();
            expect(serviceProvider.getUserProfileServiceSafe()).toBeDefined();
            expect(serviceProvider.getUserKodiakServiceSafe()).toBeDefined();
            expect(serviceProvider.getBotManagementServiceSafe()).toBeDefined();
            expect(serviceProvider.getStrategyServiceSafe()).toBeDefined();
            expect(serviceProvider.getMarketServiceSafe()).toBeDefined();
            expect(serviceProvider.getPositionValidatorServiceSafe()).toBeDefined();
            expect(serviceProvider.getPositionSyncServiceSafe()).toBeDefined();
            expect(serviceProvider.getHealthServiceSafe()).toBeDefined();
            expect(serviceProvider.getEngineManagerSafe()).toBeDefined();
        });
    });

    describe('Service Availability Methods', () => {
        let serviceProvider: ServiceProvider;

        beforeEach(() => {
            serviceProvider = ServiceProvider.getInstance();
        });

        test('should check service availability', () => {
            const mockServices = {
                authService: {},
                balanceService: undefined,
                positionService: {},
                positionValidatorService: undefined,
                positionSyncService: {},
                roleManagementService: undefined,
                userProfileService: {},
                userKodiakService: {},
                botManagementService: undefined,
                strategyService: {},
                marketService: {},
                healthService: undefined,
                engineManager: {}
            };

            const mockFactory = {
                getAllServices: jest.fn().mockReturnValue(mockServices),
                healthCheck: jest.fn()
            };

            (serviceProvider as any).factory = mockFactory;

            expect(serviceProvider.isServiceAvailable('authService')).toBe(true);
            expect(serviceProvider.isServiceAvailable('balanceService')).toBe(false);
            expect(serviceProvider.getAvailableServices()).toEqual([
                'authService',
                'positionService',
                'positionSyncService',
                'userProfileService',
                'userKodiakService',
                'strategyService',
                'marketService',
                'engineManager'
            ]);
            expect(serviceProvider.getUnavailableServices()).toEqual([
                'balanceService',
                'positionValidatorService',
                'roleManagementService',
                'botManagementService',
                'healthService'
            ]);
        });
    });

    describe('Health Check Methods', () => {
        let serviceProvider: ServiceProvider;

        beforeEach(() => {
            serviceProvider = ServiceProvider.getInstance();
        });

        test('should perform health check', async () => {
            const mockHealthCheck = {
                healthy: true,
                services: {
                    authService: true,
                    balanceService: false
                },
                details: {
                    timestamp: Date.now()
                }
            };

            const mockFactory = {
                getAllServices: jest.fn(),
                healthCheck: jest.fn().mockResolvedValue(mockHealthCheck)
            };

            (serviceProvider as any).factory = mockFactory;

            const healthCheck = await serviceProvider.healthCheck();
            expect(mockFactory.healthCheck).toHaveBeenCalled();
            expect(healthCheck).toEqual(mockHealthCheck);
            expect(healthCheck.healthy).toBe(true);
        });
    });

    describe('Convenience Functions', () => {
        test('should provide convenience functions for all service access', () => {
            const mockService = {};
            const mockServiceProvider = ServiceProvider.getInstance();
            (mockServiceProvider as any).factory = {
                getAuthService: jest.fn().mockReturnValue(mockService),
                getBalanceService: jest.fn().mockReturnValue(mockService),
                getPositionService: jest.fn().mockReturnValue(mockService),
                getRoleManagementService: jest.fn().mockReturnValue(mockService),
                getRoleQualificationService: jest.fn().mockReturnValue(mockService),
                getWalletQualificationService: jest.fn().mockReturnValue(mockService),
                getUserProfileService: jest.fn().mockReturnValue(mockService),
                getUserKodiakService: jest.fn().mockReturnValue(mockService),
                getBotManagementService: jest.fn().mockReturnValue(mockService),
                getStrategyService: jest.fn().mockReturnValue(mockService),
                getMarketService: jest.fn().mockReturnValue(mockService),
                getPositionValidatorService: jest.fn().mockReturnValue(mockService),
                getPositionSyncService: jest.fn().mockReturnValue(mockService),
                getHealthService: jest.fn().mockReturnValue(mockService),
                getEngineManager: jest.fn().mockReturnValue(mockService),
                getAllServices: jest.fn().mockReturnValue({}),
                healthCheck: jest.fn()
            };

            // Test all strict convenience functions
            expect(getAuthService()).toEqual(mockService);
            expect(getBalanceService()).toEqual(mockService);
            expect(getPositionService()).toEqual(mockService);
            expect(getRoleManagementService()).toEqual(mockService);
            expect(getRoleQualificationService()).toEqual(mockService);
            expect(getWalletQualificationService()).toEqual(mockService);
            expect(getUserProfileService()).toEqual(mockService);
            expect(getUserKodiakService()).toEqual(mockService);
            expect(getBotManagementService()).toEqual(mockService);
            expect(getStrategyService()).toEqual(mockService);
            expect(getMarketService()).toEqual(mockService);
            expect(getPositionValidatorService()).toEqual(mockService);
            expect(getPositionSyncService()).toEqual(mockService);
            expect(getHealthService()).toEqual(mockService);
            expect(getEngineManager()).toEqual(mockService);

            // Test all safe convenience functions
            expect(getAuthServiceSafe()).toEqual(mockService);
            expect(getBalanceServiceSafe()).toEqual(mockService);
            expect(getPositionServiceSafe()).toEqual(mockService);
            expect(getRoleManagementServiceSafe()).toEqual(mockService);
            expect(getRoleQualificationServiceSafe()).toEqual(mockService);
            expect(getWalletQualificationServiceSafe()).toEqual(mockService);
            expect(getUserProfileServiceSafe()).toEqual(mockService);
            expect(getUserKodiakServiceSafe()).toEqual(mockService);
            expect(getBotManagementServiceSafe()).toEqual(mockService);
            expect(getStrategyServiceSafe()).toEqual(mockService);
            expect(getMarketServiceSafe()).toEqual(mockService);
            expect(getPositionValidatorServiceSafe()).toEqual(mockService);
            expect(getPositionSyncServiceSafe()).toEqual(mockService);
            expect(getHealthServiceSafe()).toEqual(mockService);
            expect(getEngineManagerSafe()).toEqual(mockService);

            // Test service availability convenience functions
            expect(isServiceAvailable).toBeDefined();
            expect(getAvailableServices).toBeDefined();
            expect(getUnavailableServices).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        let serviceProvider: ServiceProvider;

        beforeEach(() => {
            serviceProvider = ServiceProvider.getInstance();
        });

        test('should throw error when Auth Service is unavailable', () => {
            const mockFactory = {
                getAuthService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getAuthService()).toThrow('Auth Service is unavailable');
        });

        test('should return undefined when Auth Service is unavailable with safe method', () => {
            const mockFactory = {
                getAuthService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getAuthServiceSafe()).toBeUndefined();
        });

        test('should throw error when Balance Service is unavailable', () => {
            const mockFactory = {
                getBalanceService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getBalanceService()).toThrow('Balance Service is unavailable');
        });

        test('should return undefined when Balance Service is unavailable with safe method', () => {
            const mockFactory = {
                getBalanceService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getBalanceServiceSafe()).toBeUndefined();
        });

        test('should throw error when Position Service is unavailable', () => {
            const mockFactory = {
                getPositionService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getPositionService()).toThrow('Position Service is unavailable');
        });

        test('should return undefined when Position Service is unavailable with safe method', () => {
            const mockFactory = {
                getPositionService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getPositionServiceSafe()).toBeUndefined();
        });

        test('should throw error when Role Management Service is unavailable', () => {
            const mockFactory = {
                getRoleManagementService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getRoleManagementService()).toThrow('Role Management Service is unavailable');
        });

        test('should return undefined when Role Management Service is unavailable with safe method', () => {
            const mockFactory = {
                getRoleManagementService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getRoleManagementServiceSafe()).toBeUndefined();
        });

        test('should throw error when Role Qualification Service is unavailable', () => {
            const mockFactory = {
                getRoleQualificationService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getRoleQualificationService()).toThrow('Role Qualification Service is unavailable');
        });

        test('should return undefined when Role Qualification Service is unavailable with safe method', () => {
            const mockFactory = {
                getRoleQualificationService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getRoleQualificationServiceSafe()).toBeUndefined();
        });

        test('should throw error when Wallet Qualification Service is unavailable', () => {
            const mockFactory = {
                getWalletQualificationService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getWalletQualificationService()).toThrow('Wallet Qualification Service is unavailable');
        });

        test('should return undefined when Wallet Qualification Service is unavailable with safe method', () => {
            const mockFactory = {
                getWalletQualificationService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getWalletQualificationServiceSafe()).toBeUndefined();
        });

        test('should throw error when User Profile Service is unavailable', () => {
            const mockFactory = {
                getUserProfileService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getUserProfileService()).toThrow('User Profile Service is unavailable');
        });

        test('should return undefined when User Profile Service is unavailable with safe method', () => {
            const mockFactory = {
                getUserProfileService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getUserProfileServiceSafe()).toBeUndefined();
        });

        test('should throw error when User Kodiak Service is unavailable', () => {
            const mockFactory = {
                getUserKodiakService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getUserKodiakService()).toThrow('User Kodiak Service is unavailable');
        });

        test('should return undefined when User Kodiak Service is unavailable with safe method', () => {
            const mockFactory = {
                getUserKodiakService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getUserKodiakServiceSafe()).toBeUndefined();
        });

        test('should throw error when Bot Management Service is unavailable', () => {
            const mockFactory = {
                getBotManagementService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getBotManagementService()).toThrow('Bot Management Service is unavailable');
        });

        test('should return undefined when Bot Management Service is unavailable with safe method', () => {
            const mockFactory = {
                getBotManagementService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getBotManagementServiceSafe()).toBeUndefined();
        });

        test('should throw error when Strategy Service is unavailable', () => {
            const mockFactory = {
                getStrategyService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getStrategyService()).toThrow('Strategy Service is unavailable');
        });

        test('should return undefined when Strategy Service is unavailable with safe method', () => {
            const mockFactory = {
                getStrategyService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getStrategyServiceSafe()).toBeUndefined();
        });

        test('should throw error when Market Service is unavailable', () => {
            const mockFactory = {
                getMarketService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getMarketService()).toThrow('Market Service is unavailable');
        });

        test('should return undefined when Market Service is unavailable with safe method', () => {
            const mockFactory = {
                getMarketService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getMarketServiceSafe()).toBeUndefined();
        });

        test('should throw error when Position Validator Service is unavailable', () => {
            const mockFactory = {
                getPositionValidatorService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getPositionValidatorService()).toThrow('Position Validator Service is unavailable');
        });

        test('should return undefined when Position Validator Service is unavailable with safe method', () => {
            const mockFactory = {
                getPositionValidatorService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getPositionValidatorServiceSafe()).toBeUndefined();
        });

        test('should throw error when Position Sync Service is unavailable', () => {
            const mockFactory = {
                getPositionSyncService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getPositionSyncService()).toThrow('Position Sync Service is unavailable');
        });

        test('should return undefined when Position Sync Service is unavailable with safe method', () => {
            const mockFactory = {
                getPositionSyncService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getPositionSyncServiceSafe()).toBeUndefined();
        });

        test('should throw error when Health Service is unavailable', () => {
            const mockFactory = {
                getHealthService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getHealthService()).toThrow('Health Service is unavailable');
        });

        test('should return undefined when Health Service is unavailable with safe method', () => {
            const mockFactory = {
                getHealthService: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getHealthServiceSafe()).toBeUndefined();
        });

        test('should throw error when Engine Manager is unavailable', () => {
            const mockFactory = {
                getEngineManager: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(() => serviceProvider.getEngineManager()).toThrow('Engine Manager is unavailable');
        });

        test('should return undefined when Engine Manager is unavailable with safe method', () => {
            const mockFactory = {
                getEngineManager: jest.fn().mockReturnValue(undefined)
            };

            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getEngineManagerSafe()).toBeUndefined();
        });
    });

    describe('Factory Access', () => {
        let serviceProvider: ServiceProvider;

        beforeEach(() => {
            serviceProvider = ServiceProvider.getInstance();
        });

        test('should provide factory access', () => {
            const mockFactory = {};
            (serviceProvider as any).factory = mockFactory;
            expect(serviceProvider.getFactory()).toEqual(mockFactory);
        });
    });

    describe('Thread Safety', () => {
        test('should handle concurrent access to singleton', async () => {
            const promises: Promise<ServiceProvider>[] = [];
            for (let i = 0; i < 10; i++) {
                promises.push(Promise.resolve(ServiceProvider.getInstance()));
            }

            const instances = await Promise.all(promises);
            const firstInstance = instances[0];
            instances.forEach((instance) => {
                expect(instance).toBe(firstInstance);
            });
        });

        test('should handle rapid singleton access', () => {
            const instances: ServiceProvider[] = [];
            for (let i = 0; i < 100; i++) {
                instances.push(ServiceProvider.getInstance());
            }

            const firstInstance = instances[0];
            instances.forEach((instance) => {
                expect(instance).toBe(firstInstance);
            });
        });
    });
});