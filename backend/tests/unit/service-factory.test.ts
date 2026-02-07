/**
 * Service Factory Unit Tests
 *
 * Comprehensive testing of the ServiceFactory class and its interface.
 * Tests cover service instantiation, caching, error handling, and health checks.
 */

import { ServiceFactory, IServiceFactory } from '../../src/core/service-factory';
import { diContainer } from '../../src/infrastructure/dependency-injection.container';
import { contextLogger } from '../../src/core/logging';

// Mock dependencies
jest.mock('../../src/infrastructure/dependency-injection.container');
jest.mock('../../src/core/logging');

// Mock the user services
jest.mock('../../src/core/user/user-profile.service');
jest.mock('../../src/core/user/user-kodiak.service');

// Import the mocked services
import { UserProfileService } from '../../src/core/user/user-profile.service';
import { UserKodiakService } from '../../src/core/user/user-kodiak.service';

describe('Service Factory Interface', () => {
    let factory: IServiceFactory;
    let mockDiContainer: any;
    let mockLogger: jest.Mocked<typeof contextLogger>;

    beforeEach(() => {
        factory = new ServiceFactory();

        // Create a proper mock for the dependency injection container
        mockDiContainer = {
            authService: {} as any,
            balanceService: {} as any,
            positionService: {} as any,
            roleManagementService: {} as any,
            roleQualificationService: {} as any,
            walletQualificationService: {} as any,
            userRepository: {} as any,
            cacheService: {} as any,
            passwordService: {} as any,
        };

        // Mock the diContainer import
        (diContainer as any) = mockDiContainer;

        mockLogger = contextLogger as jest.Mocked<typeof contextLogger>;

        // Reset all mocks
        jest.clearAllMocks();
    });

    describe('Service Access Methods', () => {
        test('should provide all required service methods', () => {
            expect(factory.getAuthService).toBeDefined();
            expect(factory.getBalanceService).toBeDefined();
            expect(factory.getPositionService).toBeDefined();
            expect(factory.getPositionValidatorService).toBeDefined();
            expect(factory.getRoleManagementService).toBeDefined();
            expect(factory.getRoleQualificationService).toBeDefined();
            expect(factory.getWalletQualificationService).toBeDefined();
            expect(factory.getUserProfileService).toBeDefined();
            expect(factory.getUserKodiakService).toBeDefined();
            expect(factory.getBotManagementService).toBeDefined();
            expect(factory.getStrategyService).toBeDefined();
            expect(factory.getMarketService).toBeDefined();
            expect(factory.getHealthService).toBeDefined();
            expect(factory.getAllServices).toBeDefined();
            expect(factory.healthCheck).toBeDefined();
        });

        test('should return consistent service instances', () => {
            const service1 = factory.getAuthService();
            const service2 = factory.getAuthService();

            expect(service1).toBe(service2);
            expect(mockDiContainer.authService).toBeDefined();
        });

        test('should return different service types', () => {
            const authService = factory.getAuthService();
            const balanceService = factory.getBalanceService();

            expect(authService).toBeDefined();
            expect(balanceService).toBeDefined();
            expect(authService).not.toBe(balanceService);
        });
    });

    describe('Service Instantiation', () => {
        test('should instantiate Auth Service with proper dependencies', () => {
            const mockAuthService = { authenticate: jest.fn() };
            mockDiContainer.authService = mockAuthService;

            const service = factory.getAuthService();

            expect(service).toBe(mockAuthService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Auth Service retrieved from container',
                expect.objectContaining({
                    service: 'AuthService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Balance Service with proper dependencies', () => {
            const mockBalanceService = { getBalance: jest.fn() };
            mockDiContainer.balanceService = mockBalanceService;

            const service = factory.getBalanceService();

            expect(service).toBe(mockBalanceService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Balance Service retrieved from container',
                expect.objectContaining({
                    service: 'BalanceService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Position Service with proper dependencies', () => {
            const mockPositionService = { validatePosition: jest.fn() };
            mockDiContainer.positionService = mockPositionService;

            const service = factory.getPositionService();

            expect(service).toBe(mockPositionService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Position Service retrieved from container',
                expect.objectContaining({
                    service: 'PositionService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Role Management Service with proper dependencies', () => {
            const mockRoleManagementService = { assignRole: jest.fn() };
            mockDiContainer.roleManagementService = mockRoleManagementService;

            const service = factory.getRoleManagementService();

            expect(service).toBe(mockRoleManagementService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Role Management Service retrieved from container',
                expect.objectContaining({
                    service: 'RoleManagementService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Role Qualification Service with proper dependencies', () => {
            const mockRoleQualificationService = { checkQualification: jest.fn() };
            mockDiContainer.roleQualificationService = mockRoleQualificationService;

            const service = factory.getRoleQualificationService();

            expect(service).toBe(mockRoleQualificationService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Role Qualification Service retrieved from container',
                expect.objectContaining({
                    service: 'RoleQualificationService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Wallet Qualification Service with proper dependencies', () => {
            const mockWalletQualificationService = { checkAlphaQualification: jest.fn() };
            mockDiContainer.walletQualificationService = mockWalletQualificationService;

            const service = factory.getWalletQualificationService();

            expect(service).toBe(mockWalletQualificationService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Wallet Qualification Service retrieved from container',
                expect.objectContaining({
                    service: 'WalletQualificationService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate User Profile Service with proper dependencies', () => {
            const mockUserProfileService = { getUserProfile: jest.fn() };

            // Add auditLogRepository to the mock DI container
            mockDiContainer.auditLogRepository = {} as any;

            // Mock the UserProfileService constructor
            (UserProfileService as jest.MockedClass<typeof UserProfileService>).mockImplementation(
                (deps) => {
                    expect(deps).toEqual({
                        userRepository: mockDiContainer.userRepository,
                        cache: mockDiContainer.cacheService,
                        passwordService: mockDiContainer.passwordService,
                        auditLogRepository: mockDiContainer.auditLogRepository
                    });
                    return mockUserProfileService as any;
                }
            );

            const service = factory.getUserProfileService();

            expect(service).toBe(mockUserProfileService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'User Profile Service created with dependencies',
                expect.objectContaining({
                    service: 'UserProfileService',
                    dependencies: ['userRepository', 'cache', 'passwordService', 'auditLogRepository']
                })
            );
        });

        test('should instantiate User Kodiak Service with proper dependencies', () => {
            const mockUserKodiakService = { linkKodiakAccount: jest.fn() };

            // Mock the UserKodiakService constructor
            (UserKodiakService as jest.MockedClass<typeof UserKodiakService>).mockImplementation(
                (deps) => {
                    expect(deps).toEqual({
                        kodiakConnectionService: expect.any(Object),
                        cache: expect.any(Object)
                    });
                    return mockUserKodiakService as any;
                }
            );

            const service = factory.getUserKodiakService();

            expect(service).toBe(mockUserKodiakService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'User Kodiak Service created with dependencies',
                expect.objectContaining({
                    service: 'UserKodiakService',
                    dependencies: ['kodiakConnectionService', 'connectionCache']
                })
            );
        });

        test('should instantiate Bot Management Service with proper dependencies', () => {
            const mockBotManagementService = { manageBots: jest.fn() };
            mockDiContainer.botManagementService = mockBotManagementService;

            const service = factory.getBotManagementService();

            expect(service).toBe(mockBotManagementService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Bot Management Service retrieved from container',
                expect.objectContaining({
                    service: 'BotManagementService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Strategy Service with proper dependencies', () => {
            const mockStrategyService = { manageStrategies: jest.fn() };
            mockDiContainer.strategyService = mockStrategyService;

            const service = factory.getStrategyService();

            expect(service).toBe(mockStrategyService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Strategy Service retrieved from container',
                expect.objectContaining({
                    service: 'StrategyService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Market Service with proper dependencies', () => {
            const mockMarketService = { getMarketPrices: jest.fn() };
            mockDiContainer.marketService = mockMarketService;

            const service = factory.getMarketService();

            expect(service).toBe(mockMarketService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Market Service retrieved from container',
                expect.objectContaining({
                    service: 'MarketService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Position Validator Service with proper dependencies', () => {
            const mockPositionValidatorService = { validateUserPosition: jest.fn() };
            mockDiContainer.positionValidatorService = mockPositionValidatorService;

            const service = factory.getPositionValidatorService();

            expect(service).toBe(mockPositionValidatorService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Position Validator Service retrieved from container',
                expect.objectContaining({
                    service: 'PositionValidatorService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Position Sync Service with proper dependencies', () => {
            const mockPositionSyncService = { syncPositionsFromExternalAPI: jest.fn() };
            mockDiContainer.positionSyncService = mockPositionSyncService;

            const service = factory.getPositionSyncService();

            expect(service).toBe(mockPositionSyncService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Position Sync Service retrieved from container',
                expect.objectContaining({
                    service: 'PositionSyncService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Health Service with proper dependencies', () => {
            const mockHealthService = { getSystemHealth: jest.fn() };
            mockDiContainer.healthService = mockHealthService;

            const service = factory.getHealthService();

            expect(service).toBe(mockHealthService);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Health Service retrieved from container',
                expect.objectContaining({
                    service: 'HealthService',
                    implementation: 'pure'
                })
            );
        });

        test('should instantiate Engine Manager with proper dependencies', () => {
            const mockEngineManager = { ensureEngineRunning: jest.fn() };
            mockDiContainer.engineManager = mockEngineManager;

            const service = factory.getEngineManager();

            expect(service).toBe(mockEngineManager);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Engine Manager retrieved from container',
                expect.objectContaining({
                    service: 'EngineManager',
                    implementation: 'pure'
                })
            );
        });
    });

    describe('Error Handling', () => {
        test('should handle Auth Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'authService', {
                get() {
                    throw new Error('Auth Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getAuthService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Auth Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'AuthService'
                })
            );
        });

        test('should handle Balance Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'balanceService', {
                get() {
                    throw new Error('Balance Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getBalanceService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Balance Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'BalanceService'
                })
            );
        });

        test('should handle Position Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'positionService', {
                get() {
                    throw new Error('Position Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getPositionService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Position Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'PositionService'
                })
            );
        });

        test('should handle Role Management Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'roleManagementService', {
                get() {
                    throw new Error('Role Management Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getRoleManagementService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Role Management Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'RoleManagementService'
                })
            );
        });

        test('should handle User Profile Service instantiation errors', () => {
            const error = new Error('User Profile Service creation failed');

            // Mock the UserProfileService constructor to throw an error
            (UserProfileService as jest.MockedClass<typeof UserProfileService>).mockImplementation(
                () => {
                    throw error;
                }
            );

            // Service factory should return undefined instead of throwing
            const service = factory.getUserProfileService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to create User Profile Service',
                error,
                expect.objectContaining({
                    service: 'UserProfileService'
                })
            );
        });

        test('should handle User Kodiak Service instantiation errors', () => {
            const error = new Error('User Kodiak Service creation failed');

            // Mock the UserKodiakService constructor to throw an error
            (UserKodiakService as jest.MockedClass<typeof UserKodiakService>).mockImplementation(
                () => {
                    throw error;
                }
            );

            // Service factory should return undefined instead of throwing
            const service = factory.getUserKodiakService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to create User Kodiak Service',
                error,
                expect.objectContaining({
                    service: 'UserKodiakService'
                })
            );
        });

        test('should handle Bot Management Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'botManagementService', {
                get() {
                    throw new Error('Bot Management Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getBotManagementService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Bot Management Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'BotManagementService'
                })
            );
        });

        test('should handle Strategy Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'strategyService', {
                get() {
                    throw new Error('Strategy Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getStrategyService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Strategy Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'StrategyService'
                })
            );
        });

        test('should handle Market Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'marketService', {
                get() {
                    throw new Error('Market Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getMarketService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Market Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'MarketService'
                })
            );
        });

        test('should handle Position Validator Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'positionValidatorService', {
                get() {
                    throw new Error('Position Validator Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getPositionValidatorService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Position Validator Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'PositionValidatorService'
                })
            );
        });

        test('should handle Position Sync Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'positionSyncService', {
                get() {
                    throw new Error('Position Sync Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getPositionSyncService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Position Sync Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'PositionSyncService'
                })
            );
        });

        test('should handle Health Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'healthService', {
                get() {
                    throw new Error('Health Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getHealthService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Health Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'HealthService'
                })
            );
        });

        test('should handle Role Qualification Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'roleQualificationService', {
                get() {
                    throw new Error('Role Qualification Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getRoleQualificationService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Role Qualification Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'RoleQualificationService'
                })
            );
        });

        test('should handle Wallet Qualification Service instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'walletQualificationService', {
                get() {
                    throw new Error('Wallet Qualification Service instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getWalletQualificationService();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Wallet Qualification Service',
                expect.any(Error),
                expect.objectContaining({
                    service: 'WalletQualificationService'
                })
            );
        });

        test('should handle Engine Manager instantiation errors', () => {
            Object.defineProperty(mockDiContainer, 'engineManager', {
                get() {
                    throw new Error('Engine Manager instantiation failed');
                },
                configurable: true
            });

            mockLogger.error = jest.fn();

            const service = factory.getEngineManager();

            expect(service).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get Engine Manager',
                expect.any(Error),
                expect.objectContaining({
                    service: 'EngineManager'
                })
            );
        });

        test('should handle getAllServices method failure', () => {
            mockLogger.error = jest.fn();

            // Mock one specific service method to throw an error
            const originalGetAuthService = factory.getAuthService;
            factory.getAuthService = jest.fn().mockImplementation(() => {
                throw new Error('Auth service failed');
            });

            const allServices = factory.getAllServices();

            expect(allServices).toEqual({
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
            });
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get all services',
                expect.any(Error)
            );

            // Restore original method
            factory.getAuthService = originalGetAuthService;
        });
    });

    describe('Health Check', () => {
        test('should provide health check for all services', async () => {
            const mockAuthService = { authenticate: jest.fn() };
            const mockBalanceService = { getBalance: jest.fn() };
            const mockPositionService = { validatePosition: jest.fn() };
            const mockPositionValidatorService = { validateUserPosition: jest.fn() };
            const mockPositionSyncService = { syncPositionsFromExternalAPI: jest.fn() };
            const mockRoleManagementService = { assignRole: jest.fn() };
            const mockUserProfileService = { getUserProfile: jest.fn() };
            const mockUserKodiakService = { linkKodiakAccount: jest.fn() };
            const mockBotManagementService = { manageBots: jest.fn() };
            const mockStrategyService = { manageStrategies: jest.fn() };
            const mockMarketService = { getMarketPrices: jest.fn() };
            const mockHealthService = { getSystemHealth: jest.fn() };
            const mockEngineManager = { ensureEngineRunning: jest.fn() };

            mockDiContainer.authService = mockAuthService;
            mockDiContainer.balanceService = mockBalanceService;
            mockDiContainer.positionService = mockPositionService;
            mockDiContainer.positionValidatorService = mockPositionValidatorService;
            mockDiContainer.positionSyncService = mockPositionSyncService;
            mockDiContainer.roleManagementService = mockRoleManagementService;
            mockDiContainer.userRepository = {} as any;
            mockDiContainer.cacheService = {} as any;
            mockDiContainer.passwordService = {} as any;
            mockDiContainer.auditLogRepository = {} as any;
            mockDiContainer.botManagementService = mockBotManagementService;
            mockDiContainer.strategyService = mockStrategyService;
            mockDiContainer.marketService = mockMarketService;
            mockDiContainer.healthService = mockHealthService;
            mockDiContainer.engineManager = mockEngineManager;

            // Set up the mock constructors to return our mock services
            (UserProfileService as jest.MockedClass<typeof UserProfileService>).mockImplementation(
                () => mockUserProfileService as any
            );
            (UserKodiakService as jest.MockedClass<typeof UserKodiakService>).mockImplementation(
                () => mockUserKodiakService as any
            );

            const health = await factory.healthCheck();

            expect(health.healthy).toBe(true);
            expect(health.services).toEqual({
                authService: true,
                balanceService: true,
                positionService: true,
                positionValidatorService: true,
                positionSyncService: true,
                roleManagementService: true,
                userProfileService: true,
                userKodiakService: true,
                botManagementService: true,
                strategyService: true,
                marketService: true,
                healthService: true,
                engineManager: true
            });
            expect(health.details).toEqual({
                authService: {
                    healthy: true,
                    type: 'Object'
                },
                balanceService: {
                    healthy: true,
                    type: 'Object'
                },
                positionService: {
                    healthy: true,
                    type: 'Object'
                },
                positionValidatorService: {
                    healthy: true,
                    type: 'Object'
                },
                positionSyncService: {
                    healthy: true,
                    type: 'Object'
                },
                roleManagementService: {
                    healthy: true,
                    type: 'Object'
                },
                userProfileService: {
                    healthy: true,
                    type: 'Object'
                },
                userKodiakService: {
                    healthy: true,
                    type: 'Object'
                },
                botManagementService: {
                    healthy: true,
                    type: 'Object'
                },
                strategyService: {
                    healthy: true,
                    type: 'Object'
                },
                marketService: {
                    healthy: true,
                    type: 'Object'
                },
                healthService: {
                    healthy: true,
                    type: 'Object'
                },
                engineManager: {
                    healthy: true,
                    type: 'Object'
                }
            });
        });

        test('should handle health check with service failures', async () => {
            const mockAuthService = { authenticate: jest.fn() };
            const mockBalanceService = { getBalance: jest.fn() };

            mockDiContainer.authService = mockAuthService;
            mockDiContainer.balanceService = mockBalanceService;
            mockDiContainer.positionService = undefined as any; // Simulate failure
            mockDiContainer.roleManagementService = {} as any;
            mockDiContainer.userRepository = {} as any;
            mockDiContainer.cacheService = {} as any;
            mockDiContainer.passwordService = {} as any;
            mockDiContainer.auditLogRepository = {} as any;
            mockDiContainer.botManagementService = undefined as any; // Simulate failure

            // Set up the mock constructor to throw an error
            (UserProfileService as jest.MockedClass<typeof UserProfileService>).mockImplementation(
                () => {
                    throw new Error('Service creation failed');
                }
            );

            const health = await factory.healthCheck();

            expect(health.healthy).toBe(false);
            expect(health.services).toEqual({
                authService: true,
                balanceService: true,
                positionService: false,
                positionValidatorService: false,
                positionSyncService: false,
                roleManagementService: true,
                userProfileService: false,
                userKodiakService: true,
                botManagementService: false,
                strategyService: false,
                marketService: false,
                healthService: false,
                engineManager: false
            });
            expect(health.details.positionService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
            expect(health.details.userProfileService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
            expect(health.details.botManagementService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
            expect(health.details.strategyService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
            expect(health.details.marketService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
            expect(health.details.positionValidatorService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
            expect(health.details.positionSyncService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
            expect(health.details.healthService).toEqual({
                healthy: false,
                error: 'Service unavailable'
            });
        });

        test('should handle health check when getAllServices fails', async () => {
            // Mock getAllServices to throw an error
            const originalGetAllServices = factory.getAllServices;
            factory.getAllServices = jest.fn().mockImplementation(() => {
                throw new Error('getAllServices failed');
            });

            const health = await factory.healthCheck();

            expect(health.healthy).toBe(false);
            expect(health.services).toEqual({});
            expect(health.details).toEqual({
                error: 'getAllServices failed'
            });

            // Restore original method
            factory.getAllServices = originalGetAllServices;
        });

        test('should handle service health check errors', async () => {
            const failingService = {
                constructor: {
                    get name() {
                        throw new Error('Service health check failed');
                    }
                }
            };

            mockDiContainer.authService = failingService;
            mockDiContainer.balanceService = {};
            mockDiContainer.positionService = {};
            mockDiContainer.positionValidatorService = {};
            mockDiContainer.positionSyncService = {};
            mockDiContainer.roleManagementService = {};
            mockDiContainer.roleQualificationService = {};
            mockDiContainer.walletQualificationService = {};
            mockDiContainer.botManagementService = {};
            mockDiContainer.strategyService = {};
            mockDiContainer.marketService = {};
            mockDiContainer.healthService = {};
            mockDiContainer.engineManager = {};
            mockDiContainer.userRepository = {};
            mockDiContainer.cacheService = {};
            mockDiContainer.passwordService = {};
            mockDiContainer.auditLogRepository = {};

            const health = await factory.healthCheck();

            expect(health.healthy).toBe(false);
            expect(health.services.authService).toBe(false);
            expect(health.details.authService).toEqual({
                healthy: false,
                error: 'Service health check failed'
            });
        });
    });

    describe('Service Caching', () => {
        test('should cache service instances', () => {
            const service1 = factory.getAuthService();
            const service2 = factory.getAuthService();
            const service3 = factory.getAuthService();

            expect(service1).toBe(service2);
            expect(service2).toBe(service3);
            expect(mockDiContainer.authService).toBeDefined();
        });

        test('should cache different service types independently', () => {
            const authService1 = factory.getAuthService();
            const balanceService1 = factory.getBalanceService();
            const authService2 = factory.getAuthService();
            const balanceService2 = factory.getBalanceService();

            expect(authService1).toBe(authService2);
            expect(balanceService1).toBe(balanceService2);
            expect(authService1).not.toBe(balanceService1);
        });
    });

    describe('Service Factory Initialization', () => {
        test('should log initialization on creation', () => {
            const newFactory = new ServiceFactory();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Service Factory initialized',
                expect.objectContaining({
                    implementation: 'clean-architecture',
                    pattern: 'factory'
                })
            );
        });
    });

    describe('Singleton Pattern', () => {
        test('should return singleton instance from getServiceFactory', () => {
            // Import getServiceFactory dynamically to reset module state
            const { getServiceFactory } = require('../../src/core/service-factory');
            const instance1 = getServiceFactory();
            const instance2 = getServiceFactory();

            expect(instance1).toBe(instance2);
            expect(instance1).toBeInstanceOf(ServiceFactory);
        });

        test('should export singleton instance', () => {
            const { serviceFactory } = require('../../src/core/service-factory');

            expect(serviceFactory).toBeDefined();
            expect(serviceFactory).toBeInstanceOf(ServiceFactory);
        });

        test('getServiceFactory and exported instance should be the same', () => {
            const { getServiceFactory, serviceFactory } = require('../../src/core/service-factory');

            expect(getServiceFactory()).toBe(serviceFactory);
        });
    });
});