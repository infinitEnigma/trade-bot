/** @format */

import { Request, Response } from 'express';
import { userProfileRoutes } from '../../../src/interfaces/http/users/profile';
import { serviceProvider } from '../../../src/core/service-provider';

// Mock all dependencies
jest.mock('../../../src/core/service-provider', () => ({
    serviceProvider: {
        getUserProfileService: jest.fn(),
    },
}));

// Mock user profile service
const mockUserProfileService = {
    getUserProfile: jest.fn(),
    updateUserProfile: jest.fn(),
    verifyWalletOwnership: jest.fn(),
};

describe('User Profile Controller', () => {
    let req: Partial<Request> & { user?: any };
    let res: Partial<Response>;
    let next: jest.Mock;

    beforeEach(() => {
        req = {
            body: {},
            params: {},
            headers: {},
            ip: '127.0.0.1',
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();

        // Reset all mocks
        jest.clearAllMocks();

        // Set up service provider mock
        (serviceProvider.getUserProfileService as jest.Mock).mockReturnValue(mockUserProfileService);

        // Mock authenticated user
        req.user = {
            userId: 'user-123',
            email: 'test@example.com',
            userLevel: 'VERIFIED',
            roles: [],
        };
    });

    describe('GET /api/user/profile', () => {
        it('should return user profile for authenticated user', async () => {
            const mockProfile = {
                id: 'user-123',
                email: 'test@example.com',
                userLevel: 'VERIFIED',
                roles: [],
                hasKodiak: false,
                kodiakStatus: null,
                createdAt: new Date('2024-01-01'),
                updatedAt: new Date('2024-01-02'),
            };

            mockUserProfileService.getUserProfile.mockResolvedValue(mockProfile);

            const profileRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/profile' && route.route.methods.get
            );

            if (!profileRoute || !profileRoute.route) {
                throw new Error('Profile route not found');
            }

            const profileHandler = profileRoute.route.stack[1].handle; // Skip auth middleware

            await profileHandler(req as Request, res as Response, next);

            expect(mockUserProfileService.getUserProfile).toHaveBeenCalledWith('user-123');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: {
                    user: {
                        id: mockProfile.id,
                        email: mockProfile.email,
                        userLevel: mockProfile.userLevel,
                        roles: mockProfile.roles,
                        createdAt: mockProfile.createdAt,
                        updatedAt: mockProfile.updatedAt,
                    },
                    kodiakStatus: mockProfile.kodiakStatus,
                },
            });
        });

        it('should handle profile retrieval errors', async () => {
            mockUserProfileService.getUserProfile.mockRejectedValue(new Error('Failed to get profile'));

            const profileRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/profile' && route.route.methods.get
            );

            if (!profileRoute || !profileRoute.route) {
                throw new Error('Profile route not found');
            }

            const profileHandler = profileRoute.route.stack[1].handle; // Skip auth middleware

            await profileHandler(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
            }));
        });
    });

    describe('POST /api/user/profile/update', () => {
        it('should update user profile', async () => {
            const mockUpdateResult = {
                success: true,
                message: 'Profile updated successfully',
                data: {
                    email: 'updated@example.com',
                    updatedAt: new Date().toISOString(),
                },
            };

            mockUserProfileService.updateUserProfile.mockResolvedValue(mockUpdateResult);

            req.body = {
                email: 'updated@example.com',
            };

            const updateRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/profile/update' && route.route.methods.post
            );

            if (!updateRoute || !updateRoute.route) {
                throw new Error('Update route not found');
            }

            const updateHandler = updateRoute.route.stack[1].handle; // Skip auth middleware

            await updateHandler(req as Request, res as Response, next);

            expect(mockUserProfileService.updateUserProfile).toHaveBeenCalledWith('user-123', {
                email: 'updated@example.com',
            });
            expect(res.json).toHaveBeenCalledWith(mockUpdateResult);
        });

        it('should handle profile update errors', async () => {
            const mockUpdateResult = {
                success: false,
                message: 'Email already in use',
                error: 'Email already in use',
            };

            mockUserProfileService.updateUserProfile.mockResolvedValue(mockUpdateResult);

            req.body = {
                email: 'existing@example.com',
            };

            const updateRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/profile/update' && route.route.methods.post
            );

            if (!updateRoute || !updateRoute.route) {
                throw new Error('Update route not found');
            }

            const updateHandler = updateRoute.route.stack[1].handle; // Skip auth middleware

            await updateHandler(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: 'Email already in use',
            }));
        });

        it('should handle validation errors', async () => {
            req.body = {
                newPassword: 'newpassword', // Missing currentPassword
            };

            const updateRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/profile/update' && route.route.methods.post
            );

            if (!updateRoute || !updateRoute.route) {
                throw new Error('Update route not found');
            }

            const updateHandler = updateRoute.route.stack[1].handle; // Skip auth middleware

            await updateHandler(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
            }));
        });
    });

    describe('POST /api/user/verify-wallet', () => {
        it('should verify wallet ownership', async () => {
            const mockVerificationResult = {
                success: true,
                message: 'Wallet verified successfully',
            };

            mockUserProfileService.verifyWalletOwnership.mockResolvedValue(mockVerificationResult);

            req.body = {
                walletAddress: '0x1234567890123456789012345678901234567890',
                signature: '0xabcdef1234567890',
                message: 'Sign this message to verify your wallet',
            };

            const verifyWalletRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/verify-wallet' && route.route.methods.post
            );

            if (!verifyWalletRoute || !verifyWalletRoute.route) {
                throw new Error('Verify wallet route not found');
            }

            const verifyWalletHandler = verifyWalletRoute.route.stack[1].handle; // Skip auth middleware

            await verifyWalletHandler(req as Request, res as Response, next);

            expect(mockUserProfileService.verifyWalletOwnership).toHaveBeenCalledWith(
                'user-123',
                '0x1234567890123456789012345678901234567890',
                '0xabcdef1234567890',
                'Sign this message to verify your wallet'
            );
            expect(res.json).toHaveBeenCalledWith(mockVerificationResult);
        });

        it('should handle wallet verification errors', async () => {
            const mockVerificationResult = {
                success: false,
                message: 'Invalid signature',
            };

            mockUserProfileService.verifyWalletOwnership.mockResolvedValue(mockVerificationResult);

            req.body = {
                walletAddress: '0x1234567890123456789012345678901234567890',
                signature: 'invalid-signature',
                message: 'Sign this message to verify your wallet',
            };

            const verifyWalletRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/verify-wallet' && route.route.methods.post
            );

            if (!verifyWalletRoute || !verifyWalletRoute.route) {
                throw new Error('Verify wallet route not found');
            }

            const verifyWalletHandler = verifyWalletRoute.route.stack[1].handle; // Skip auth middleware

            await verifyWalletHandler(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: 'Invalid signature',
            }));
        });

        it('should handle validation errors for wallet verification', async () => {
            req.body = {
                walletAddress: '0x1234567890123456789012345678901234567890',
                signature: '0xabcdef1234567890',
                // Missing message
            };

            const verifyWalletRoute = userProfileRoutes.stack.find((route: any) =>
                route.route && route.route.path === '/verify-wallet' && route.route.methods.post
            );

            if (!verifyWalletRoute || !verifyWalletRoute.route) {
                throw new Error('Verify wallet route not found');
            }

            const verifyWalletHandler = verifyWalletRoute.route.stack[1].handle; // Skip auth middleware

            await verifyWalletHandler(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
            }));
        });
    });
});