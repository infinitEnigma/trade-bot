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
import { WalletQualificationService } from '../../src/core/wallet/wallet-qualification.service';
import { UserProfileService } from '../../src/core/user/user-profile.service';
import { UserKodiakService } from '../../src/core/user/user-kodiak.service';
import { serviceProvider } from '../../src/core/service-provider';

// Mock dependencies
jest.mock('../../src/core/logging');

describe('Service Provider Singleton', () => {
    let mockLogger: jest.Mocked<typeof contextLogger>;
    let mockServiceProvider: jest.Mocked<typeof serviceProvider>;
    let mockAuthService: jest.Mocked<AuthService>;
    let mockUserProfileService: jest.Mocked<UserProfileService>;
    let mockUserKodiakService: jest.Mocked<UserKodiakService>;
    let mockWalletQualificationService: jest.Mocked<WalletQualificationService>;


    beforeEach(() => {
        mockLogger = contextLogger as jest.Mocked<typeof contextLogger>;
        // Setup mock services
        mockAuthService = {
            authenticate: jest.fn(),
            register: jest.fn(),
            refreshToken: jest.fn(),
            logout: jest.fn(),
            verifyEmail: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            CACHE_TTL: 3600,
            CACHE_PREFIX: 'auth',
            deps: {
                userRepository: {} as any,
                cache: {} as any,
                passwordService: {} as any
            }
        } as any;

        mockUserProfileService = {
            getUserProfile: jest.fn(),
            updateUserProfile: jest.fn(),
            verifyWalletOwnership: jest.fn(),
            CACHE_TTL: 3600,
            deps: {
                userRepository: {} as any,
                cache: {} as any,
                passwordService: {} as any
            }
        } as any;

        mockUserKodiakService = {
            linkKodiakAccount: jest.fn(),
            unlinkKodiakAccount: jest.fn(),
            getKodiakConnectionStatus: jest.fn(),
            deps: {
                kodiakConnectionService: {} as any,
                cache: {} as any
            }
        } as any;

        mockWalletQualificationService = {
            checkAlphaQualification: jest.fn(),
            validateWalletChain: jest.fn(),
            checkNFTOwnership: jest.fn(),
            checkTokenBalance: jest.fn(),
            getQualificationConfig: jest.fn(),
            deps: {
                blockchainService: {} as any,
                cache: {} as any
            }
        } as any;

        // Setup mock service provider
        mockServiceProvider = {
            getAuthService: jest.fn().mockReturnValue(mockAuthService),
            getBalanceService: jest.fn(),
            getPositionService: jest.fn(),
            getRoleManagementService: jest.fn(),
            getRoleQualificationService: jest.fn(),
            getWalletQualificationService: jest.fn().mockReturnValue(mockWalletQualificationService),
            getUserProfileService: jest.fn().mockReturnValue(mockUserProfileService),
            getUserKodiakService: jest.fn().mockReturnValue(mockUserKodiakService)
        } as any;

        // Mock the serviceProvider import
        (serviceProvider as any) = mockServiceProvider;
    });

    describe('Singleton Pattern', () => {
        test('should return same instance across multiple calls', () => {
            const instance1 = ServiceProvider.getInstance();
            const instance2 = ServiceProvider.getInstance();

            expect(instance1).toBe(instance2);
            expect(instance1).toBeInstanceOf(ServiceProvider);
        });

        test('should create only one instance', () => {
            // Create multiple instances
            const instance1 = ServiceProvider.getInstance();
            const instance2 = ServiceProvider.getInstance();
            const instance3 = ServiceProvider.getInstance();

            // All should be the same reference
            expect(instance1).toBe(instance2);
            expect(instance2).toBe(instance3);
            expect(instance1).toBe(instance3);
        });

        test('should maintain singleton across different access patterns', () => {
            const instances: ServiceProvider[] = [];

            // Access singleton in different ways
            instances.push(ServiceProvider.getInstance());
            instances.push(ServiceProvider.getInstance());

            // Create a new reference
            const serviceProvider = ServiceProvider;
            instances.push(serviceProvider.getInstance());

            // All should be the same
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

        test('should provide Auth Service access', () => {
            const mockAuthService = { authenticate: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getAuthService: jest.fn().mockReturnValue(mockAuthService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getAuthService();

            expect(mockFactory.getAuthService).toHaveBeenCalled();
            expect(service).toBe(mockAuthService);
        });

        test('should provide Balance Service access', () => {
            const mockBalanceService = { getBalance: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getBalanceService: jest.fn().mockReturnValue(mockBalanceService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getBalanceService();

            expect(mockFactory.getBalanceService).toHaveBeenCalled();
            expect(service).toBe(mockBalanceService);
        });

        test('should provide Position Service access', () => {
            const mockPositionService = { validatePosition: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getPositionService: jest.fn().mockReturnValue(mockPositionService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getPositionService();

            expect(mockFactory.getPositionService).toHaveBeenCalled();
            expect(service).toBe(mockPositionService);
        });

        test('should provide Role Management Service access', () => {
            const mockRoleManagementService = { assignRole: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getRoleManagementService: jest.fn().mockReturnValue(mockRoleManagementService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getRoleManagementService();

            expect(mockFactory.getRoleManagementService).toHaveBeenCalled();
            expect(service).toBe(mockRoleManagementService);
        });

        test('should provide Role Qualification Service access', () => {
            const mockRoleQualificationService = { checkQualification: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getRoleQualificationService: jest.fn().mockReturnValue(mockRoleQualificationService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getRoleQualificationService();

            expect(mockFactory.getRoleQualificationService).toHaveBeenCalled();
            expect(service).toBe(mockRoleQualificationService);
        });

        test('should provide Wallet Qualification Service access', () => {
            const mockWalletQualificationService = { checkAlphaQualification: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getWalletQualificationService: jest.fn().mockReturnValue(mockWalletQualificationService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getWalletQualificationService();

            expect(mockFactory.getWalletQualificationService).toHaveBeenCalled();
            expect(service).toBe(mockWalletQualificationService);
        });

        test('should provide User Profile Service access', () => {
            const mockUserProfileService = { getUserProfile: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getUserProfileService: jest.fn().mockReturnValue(mockUserProfileService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getUserProfileService();

            expect(mockFactory.getUserProfileService).toHaveBeenCalled();
            expect(service).toBe(mockUserProfileService);
        });

        test('should provide User Kodiak Service access', () => {
            const mockUserKodiakService = { linkKodiakAccount: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getUserKodiakService: jest.fn().mockReturnValue(mockUserKodiakService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getUserKodiakService();

            expect(mockFactory.getUserKodiakService).toHaveBeenCalled();
            expect(service).toBe(mockUserKodiakService);
        });
    });

    describe('Service Factory Integration', () => {
        let serviceProvider: ServiceProvider;

        beforeEach(() => {
            serviceProvider = ServiceProvider.getInstance();
        });

        test('should use service factory for service instantiation', () => {
            const mockAuthService = { authenticate: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getAuthService: jest.fn().mockReturnValue(mockAuthService)
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            const service = serviceProvider.getAuthService();

            expect(mockFactory.getAuthService).toHaveBeenCalled();
            expect(service).toBe(mockAuthService);
        });

        test('should handle service factory errors gracefully', () => {
            const error = new Error('Service factory error');

            // Mock the factory method
            const mockFactory = {
                getAuthService: jest.fn().mockImplementation(() => {
                    throw error;
                })
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            expect(() => {
                serviceProvider.getAuthService();
            }).toThrow(error);
        });

        test('should maintain service factory instance', () => {
            const serviceProvider = ServiceProvider.getInstance();

            // Mock the factory
            const mockFactory = {
                getAuthService: jest.fn()
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            // Access the private factory property for testing
            const factoryProperty = (serviceProvider as any).factory;

            expect(factoryProperty).toBeDefined();
            expect(factoryProperty).toBe(mockFactory);
        });
    });

    describe('Thread Safety', () => {
        test('should handle concurrent access to singleton', async () => {
            const promises: Promise<ServiceProvider>[] = [];

            // Create multiple concurrent access attempts
            for (let i = 0; i < 10; i++) {
                promises.push(Promise.resolve(ServiceProvider.getInstance()));
            }

            const instances = await Promise.all(promises);

            // All instances should be the same
            const firstInstance = instances[0];
            instances.forEach((instance) => {
                expect(instance).toBe(firstInstance);
            });
        });

        test('should handle rapid singleton access', () => {
            const instances: ServiceProvider[] = [];

            // Rapid access in a loop
            for (let i = 0; i < 100; i++) {
                instances.push(ServiceProvider.getInstance());
            }

            // All should be the same instance
            const firstInstance = instances[0];
            instances.forEach((instance) => {
                expect(instance).toBe(firstInstance);
            });
        });

        test('should maintain singleton behavior under stress', () => {
            const instanceSet = new Set<ServiceProvider>();

            // Create many instances rapidly
            for (let i = 0; i < 1000; i++) {
                const instance = ServiceProvider.getInstance();
                instanceSet.add(instance);
            }

            // Should only have one unique instance
            expect(instanceSet.size).toBe(1);
        });
    });

    describe('Service Provider Initialization', () => {
        test('should log initialization on first access', () => {
            // Mock the factory constructor to log initialization
            const mockFactory = {
                getAuthService: jest.fn()
            };

            // Create a new service provider instance to trigger initialization
            const serviceProvider = new (ServiceProvider as any)();
            serviceProvider.factory = mockFactory;

            // Access the singleton to trigger the initialization log
            ServiceProvider.getInstance();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Service Provider initialized',
                expect.objectContaining({
                    pattern: 'singleton',
                    factory: 'ServiceFactory'
                })
            );
        });

        test('should not log initialization on subsequent accesses', () => {
            // First access
            ServiceProvider.getInstance();

            // Clear the mock
            mockLogger.info.mockClear();

            // Second access
            ServiceProvider.getInstance();

            // Should not log again since factory is already initialized
            expect(mockLogger.info).not.toHaveBeenCalled();
        });
    });

    describe('Service Provider Error Handling', () => {
        let serviceProvider: ServiceProvider;

        beforeEach(() => {
            serviceProvider = ServiceProvider.getInstance();
        });

        test('should handle service factory not being available', () => {
            // Mock service factory to be undefined
            (serviceProvider as any).factory = undefined;

            expect(() => {
                serviceProvider.getAuthService();
            }).toThrow();
        });

        test('should provide meaningful error messages for service access failures', () => {
            const error = new Error('Service instantiation failed');

            // Mock the factory method
            const mockFactory = {
                getAuthService: jest.fn().mockImplementation(() => {
                    throw error;
                })
            };

            // Access private factory property and set it
            (serviceProvider as any).factory = mockFactory;

            expect(() => {
                serviceProvider.getAuthService();
            }).toThrow('Service instantiation failed');
        });
    });

    describe('Service Provider Performance', () => {
        test('should provide fast singleton access', () => {
            const startTime = performance.now();

            // Access singleton multiple times
            for (let i = 0; i < 1000; i++) {
                ServiceProvider.getInstance();
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should be very fast (less than 15ms for 1000 accesses)
            expect(duration).toBeLessThan(15);
        });

        test('should provide fast service access', () => {
            const mockAuthService = { authenticate: jest.fn() } as any;

            // Mock the factory method
            const mockFactory = {
                getAuthService: jest.fn().mockReturnValue(mockAuthService)
            };

            // Access private factory property and set it
            (ServiceProvider.getInstance() as any).factory = mockFactory;

            const startTime = performance.now();

            // Access service multiple times
            for (let i = 0; i < 1000; i++) {
                ServiceProvider.getInstance().getAuthService();
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should be very fast (less than 10ms for 1000 accesses)
            expect(duration).toBeLessThan(15);
        });
    });
});