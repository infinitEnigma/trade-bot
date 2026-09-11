/** @format */

import { UserProfileService, createUserProfileService, ProfileUpdateData, ProfileUpdateResult } from '../../src/core/user/user-profile.service';

// Mock dependencies
jest.mock('../../src/core/logging', () => ({
    userLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        startOperation: jest.fn().mockReturnValue({
            success: jest.fn(),
            failure: jest.fn()
        })
    }
}));

jest.mock('../../src/core/service-selector', () => ({
    selectAuthService: jest.fn().mockReturnValue({
        verifyWalletOwnership: jest.fn()
    })
}));

describe('UserProfileService', () => {
    let service: UserProfileService;
    let mockUserRepository: any;
    let mockCache: any;
    let mockPasswordService: any;
    let mockAuditLogRepository: any;

    beforeEach(() => {
        // Create mock dependencies
        mockUserRepository = {
            getAuthenticatedUserData: jest.fn(),
            findById: jest.fn(),
            findByEmail: jest.fn(),
            updateProfile: jest.fn()
        };

        mockCache = {
            get: jest.fn(),
            setex: jest.fn(),
            delete: jest.fn()
        };

        mockPasswordService = {
            hashPassword: jest.fn(),
            verifyPassword: jest.fn()
        };

        mockAuditLogRepository = {
            logEvent: jest.fn()
        };

        // Clear any existing mocks before each test
        jest.clearAllMocks();

        // Create new service instance for each test
        service = createUserProfileService({
            userRepository: mockUserRepository,
            cache: mockCache,
            passwordService: mockPasswordService,
            auditLogRepository: mockAuditLogRepository
        });
    });

    describe('getUserProfile', () => {
        const mockUserId = 'test-user-id';

        it('should return user profile from cache if available', async () => {
            const mockCachedProfile = {
                id: mockUserId,
                email: 'test@example.com',
                userLevel: 'standard',
                roles: ['user'],
                hasKodiak: false,
                kodiakStatus: null
            };

            mockCache.get.mockResolvedValue({ success: true, data: mockCachedProfile });

            const result = await service.getUserProfile(mockUserId);

            expect(result).toEqual(mockCachedProfile);
            expect(mockCache.get).toHaveBeenCalledWith(`user:profile:${mockUserId}`);
            expect(mockUserRepository.getAuthenticatedUserData).not.toHaveBeenCalled();
        });

        it('should retrieve user profile from database when cache misses', async () => {
            const mockUserData = {
                user: {
                    id: mockUserId,
                    email: 'test@example.com',
                    userLevel: 'standard'
                },
                roles: ['user'],
                hasCredentials: false
            };

            mockCache.get.mockResolvedValue({ success: false, data: null });
            mockUserRepository.getAuthenticatedUserData.mockResolvedValue(mockUserData);
            mockCache.setex.mockResolvedValue(true);

            const result = await service.getUserProfile(mockUserId);

            expect(result).toEqual({
                id: mockUserData.user.id,
                email: mockUserData.user.email,
                userLevel: mockUserData.user.userLevel,
                roles: mockUserData.roles,
                hasKodiak: mockUserData.hasCredentials,
                kodiakStatus: null
            });
            expect(mockUserRepository.getAuthenticatedUserData).toHaveBeenCalledWith(mockUserId);
            expect(mockCache.setex).toHaveBeenCalled();
        });

        it('should handle cache errors gracefully', async () => {
            const mockUserData = {
                user: {
                    id: mockUserId,
                    email: 'test@example.com',
                    userLevel: 'standard'
                },
                roles: ['user'],
                hasCredentials: false
            };

            mockCache.get.mockRejectedValue(new Error('Cache connection failed'));
            mockUserRepository.getAuthenticatedUserData.mockResolvedValue(mockUserData);
            mockCache.setex.mockResolvedValue(true);

            const result = await service.getUserProfile(mockUserId);

            expect(result).toEqual({
                id: mockUserData.user.id,
                email: mockUserData.user.email,
                userLevel: mockUserData.user.userLevel,
                roles: mockUserData.roles,
                hasKodiak: mockUserData.hasCredentials,
                kodiakStatus: null
            });
        });

        it('should throw error when user not found', async () => {
            mockCache.get.mockResolvedValue({ success: false, data: null });
            mockUserRepository.getAuthenticatedUserData.mockResolvedValue(null);

            await expect(service.getUserProfile(mockUserId)).rejects.toThrow('User not found');
        });
    });

    describe('verifyWalletOwnership', () => {
        const mockUserId = 'test-user-id';
        const mockWalletAddress = '0x1234567890123456789012345678901234567890';
        const mockSignature = 'test-signature';
        const mockMessage = 'test-message';

        it('should verify wallet ownership successfully', async () => {
            const mockResult = {
                success: true,
                message: 'Wallet ownership verified'
            };

            const mockAuthService = require('../../src/core/service-selector').selectAuthService();
            mockAuthService.verifyWalletOwnership.mockResolvedValue(mockResult);

            const result = await service.verifyWalletOwnership(
                mockUserId,
                mockWalletAddress,
                mockSignature,
                mockMessage
            );

            expect(result).toEqual(mockResult);
            expect(mockAuthService.verifyWalletOwnership).toHaveBeenCalledWith(
                mockUserId,
                mockWalletAddress,
                mockSignature,
                mockMessage
            );
        });

        it('should handle wallet verification failure', async () => {
            const mockResult = {
                success: false,
                message: 'Invalid signature'
            };

            const mockAuthService = require('../../src/core/service-selector').selectAuthService();
            mockAuthService.verifyWalletOwnership.mockResolvedValue(mockResult);

            const result = await service.verifyWalletOwnership(
                mockUserId,
                mockWalletAddress,
                mockSignature,
                mockMessage
            );

            expect(result).toEqual(mockResult);
        });

        it('should handle errors during wallet verification', async () => {
            const testError = new Error('Server error');

            const mockAuthService = require('../../src/core/service-selector').selectAuthService();
            mockAuthService.verifyWalletOwnership.mockRejectedValue(testError);

            const result = await service.verifyWalletOwnership(
                mockUserId,
                mockWalletAddress,
                mockSignature,
                mockMessage
            );

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to verify wallet ownership');
        });
    });

    describe('updateUserProfile', () => {
        const mockUserId = 'test-user-id';

        it('should update user profile email successfully', async () => {
            const newEmail = 'newemail@example.com';
            const updatedAt = new Date('2024-01-01');

            mockUserRepository.findById.mockResolvedValue({ email: 'oldemail@example.com' });
            mockUserRepository.findByEmail.mockResolvedValue(null);
            mockUserRepository.updateProfile.mockResolvedValue({
                email: newEmail,
                updatedAt: updatedAt
            });
            mockCache.delete.mockResolvedValue(true);
            mockAuditLogRepository.logEvent.mockResolvedValue(true);

            const result: ProfileUpdateResult = await service.updateUserProfile(mockUserId, {
                email: newEmail
            });

            expect(result.success).toBe(true);
            expect(result.message).toBe('Profile updated successfully');
            expect(result.data?.email).toBe(newEmail);
            expect(mockUserRepository.updateProfile).toHaveBeenCalledWith(mockUserId, { email: newEmail });
            expect(mockCache.delete).toHaveBeenCalledWith(`user:profile:${mockUserId}`);
            expect(mockAuditLogRepository.logEvent).toHaveBeenCalled();
        });

        it('should return error when no email provided', async () => {
            const result: ProfileUpdateResult = await service.updateUserProfile(mockUserId, {});

            expect(result.success).toBe(false);
            expect(result.message).toBe('Only email updates are currently supported');
        });

        it('should return error when no changes detected', async () => {
            const currentEmail = 'test@example.com';

            mockUserRepository.findById.mockResolvedValue({ email: currentEmail });

            const result: ProfileUpdateResult = await service.updateUserProfile(mockUserId, {
                email: currentEmail
            });

            expect(result.success).toBe(false);
            expect(result.message).toBe('No changes detected');
        });

        it('should return error when email is already in use', async () => {
            const newEmail = 'existing@example.com';

            mockUserRepository.findById.mockResolvedValue({ email: 'oldemail@example.com' });
            mockUserRepository.findByEmail.mockResolvedValue({ id: 'another-user-id' });

            const result: ProfileUpdateResult = await service.updateUserProfile(mockUserId, {
                email: newEmail
            });

            expect(result.success).toBe(false);
            expect(result.message).toBe('Email address is already in use');
        });

        it('should handle errors during profile update', async () => {
            const testError = new Error('Database connection failed');

            mockUserRepository.findById.mockRejectedValue(testError);

            const result: ProfileUpdateResult = await service.updateUserProfile(mockUserId, {
                email: 'newemail@example.com'
            });

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to update profile');
        });
    });
});