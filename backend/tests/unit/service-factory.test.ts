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
            expect(factory.getRoleManagementService).toBeDefined();
            expect(factory.getRoleQualificationService).toBeDefined();
            expect(factory.getWalletQualificationService).toBeDefined();
            expect(factory.getUserProfileService).toBeDefined();
            expect(factory.getUserKodiakService).toBeDefined();
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
    });

    describe('Error Handling', () => {
        test('should handle service instantiation errors gracefully', async () => {
            // Mock the diContainer to throw an error when accessing authService
            Object.defineProperty(mockDiContainer, 'authService', {
                get() {
                    throw new Error('Service instantiation failed');
                },
                configurable: true
            });

            // Mock the logger.error to capture the error
            mockLogger.error = jest.fn();

            // Service factory should return undefined instead of throwing
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
    });

    describe('Health Check', () => {
        test('should provide health check for all services', async () => {
            const mockAuthService = { authenticate: jest.fn() };
            const mockBalanceService = { getBalance: jest.fn() };
            const mockPositionService = { validatePosition: jest.fn() };
            const mockRoleManagementService = { assignRole: jest.fn() };
            const mockUserProfileService = { getUserProfile: jest.fn() };
            const mockUserKodiakService = { linkKodiakAccount: jest.fn() };
            const mockBotManagementService = { manageBots: jest.fn() };

            mockDiContainer.authService = mockAuthService;
            mockDiContainer.balanceService = mockBalanceService;
            mockDiContainer.positionService = mockPositionService;
            mockDiContainer.roleManagementService = mockRoleManagementService;
            mockDiContainer.userRepository = {} as any;
            mockDiContainer.cacheService = {} as any;
            mockDiContainer.passwordService = {} as any;
            mockDiContainer.auditLogRepository = {} as any;
            mockDiContainer.botManagementService = mockBotManagementService;

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
                roleManagementService: true,
                userProfileService: true,
                userKodiakService: true,
                botManagementService: true
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
                roleManagementService: true,
                userProfileService: false,
                userKodiakService: true,
                botManagementService: false
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
});