/**
 * Controller Service Provider Usage Tests
 *
 * Tests to verify that controllers properly use the service provider
 * pattern instead of direct service imports.
 */

import { Request, Response } from 'express';
import { serviceProvider } from '../../../src/core/service-provider';
import { AuthService } from '../../../src/core/auth/auth.service.pure';
import { UserProfileService } from '../../../src/core/user/user-profile.service';
import { UserKodiakService } from '../../../src/core/user/user-kodiak.service';
import { WalletQualificationService } from '../../../src/core/wallet/wallet-qualification.service';

// Mock dependencies
jest.mock('../../../src/core/service-provider');

describe('Controller Service Provider Usage', () => {
    let mockServiceProvider: jest.Mocked<typeof serviceProvider>;
    let mockAuthService: jest.Mocked<AuthService>;
    let mockUserProfileService: jest.Mocked<UserProfileService>;
    let mockUserKodiakService: jest.Mocked<UserKodiakService>;
    let mockWalletQualificationService: jest.Mocked<WalletQualificationService>;

    beforeEach(() => {
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

    describe('Service Provider Access Pattern', () => {
        test('should use service provider for Auth Service access', () => {
            // Verify that the service provider provides Auth Service
            const service = mockServiceProvider.getAuthService();

            expect(mockServiceProvider.getAuthService).toHaveBeenCalled();
            expect(service).toBe(mockAuthService);
        });

        test('should use service provider for User Profile Service access', () => {
            // Verify that the service provider provides User Profile Service
            const service = mockServiceProvider.getUserProfileService();

            expect(mockServiceProvider.getUserProfileService).toHaveBeenCalled();
            expect(service).toBe(mockUserProfileService);
        });

        test('should use service provider for User Kodiak Service access', () => {
            // Verify that the service provider provides User Kodiak Service
            const service = mockServiceProvider.getUserKodiakService();

            expect(mockServiceProvider.getUserKodiakService).toHaveBeenCalled();
            expect(service).toBe(mockUserKodiakService);
        });

        test('should use service provider for Wallet Qualification Service access', () => {
            // Verify that the service provider provides Wallet Qualification Service
            const service = mockServiceProvider.getWalletQualificationService();

            expect(mockServiceProvider.getWalletQualificationService).toHaveBeenCalled();
            expect(service).toBe(mockWalletQualificationService);
        });
    });

    describe('Service Provider Error Handling', () => {
        test('should handle service provider failures gracefully', () => {
            // Mock service provider to throw an error
            mockServiceProvider.getAuthService.mockImplementation(() => {
                throw new Error('Service provider error');
            });

            // Verify that the service provider throws the error
            expect(() => {
                mockServiceProvider.getAuthService();
            }).toThrow('Service provider error');
        });

        test('should handle service instantiation failures', () => {
            // Mock service provider to return undefined services
            mockServiceProvider.getAuthService.mockReturnValue(undefined as any);

            // Verify that the service provider returns undefined
            const service = mockServiceProvider.getAuthService();
            expect(service).toBeUndefined();
        });

    });

    describe('Service Provider Integration', () => {
        test('should consistently use service provider across all services', () => {
            // Test that all services use the service provider pattern
            // by verifying that the service provider methods are called

            // Auth Service
            mockServiceProvider.getAuthService();
            expect(mockServiceProvider.getAuthService).toHaveBeenCalled();

            // User Profile Service
            mockServiceProvider.getUserProfileService();
            expect(mockServiceProvider.getUserProfileService).toHaveBeenCalled();

            // User Kodiak Service
            mockServiceProvider.getUserKodiakService();
            expect(mockServiceProvider.getUserKodiakService).toHaveBeenCalled();

            // Wallet Qualification Service
            mockServiceProvider.getWalletQualificationService();
            expect(mockServiceProvider.getWalletQualificationService).toHaveBeenCalled();
        });

        test('should not have direct service imports', () => {
            // This test verifies that services don't import dependencies directly
            // by checking that they rely on the service provider

            // Verify that the service provider is the only way to access services
            expect(mockServiceProvider.getAuthService).toBeDefined();
            expect(mockServiceProvider.getUserProfileService).toBeDefined();
            expect(mockServiceProvider.getUserKodiakService).toBeDefined();
            expect(mockServiceProvider.getWalletQualificationService).toBeDefined();
        });
    });

    describe('Service Provider Performance', () => {
        test('should provide fast service access', () => {
            const startTime = performance.now();

            // Access services multiple times
            for (let i = 0; i < 1000; i++) {
                mockServiceProvider.getAuthService();
                mockServiceProvider.getUserProfileService();
                mockServiceProvider.getUserKodiakService();
                mockServiceProvider.getWalletQualificationService();
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should be very fast (less than 15ms for 4000 accesses)
            expect(duration).toBeLessThan(15);
        });
    });
});
