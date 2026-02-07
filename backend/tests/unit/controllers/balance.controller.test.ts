/** @format */

import request from 'supertest';
import { Express } from 'express';

// Mock blockchain service
jest.mock('../../../src/infrastructure/external/blockchain.service', () => ({
    blockchainService: {
        getUserWalletAddress: jest.fn(),
        getNativeBalance: jest.fn(),
        invalidateUserCache: jest.fn(),
    },
}));

// Mock rate limiters
jest.mock('../../../src/infrastructure', () => ({
    RateLimiters: {
        balance: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
    },
}));

// Mock auth middleware to set user context for protected routes
jest.mock('../../../src/interfaces/middleware/auth', () => ({
    authMiddleware: jest.fn().mockImplementation((req: any, res: any, next: any) => {
        req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
        next();
    }),
    AuthenticatedRequest: jest.fn(),
}));

// Mock logger
jest.mock('../../../src/core/logging/logger.service', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

// Get the mock blockchain service
const mockBlockchainService = require('../../../src/infrastructure/external/blockchain.service').blockchainService;

// Create a test app
function createTestApp(): Express {
    const express = require('express');
    const app = express();

    // Add necessary middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Import and register routes
    const { walletBalanceRoutes } = require('../../../src/interfaces/http/wallet/balance');
    app.use('/api/balance', walletBalanceRoutes);

    // Add error handling middleware
    const { handleErrors } = require('../../../src/interfaces/middleware/error-handler');
    app.use(handleErrors);

    return app;
}

describe('Balance Controller Tests', () => {
    let app: Express;
    let originalAuthMiddleware: any;

    beforeAll(() => {
        // Save original auth middleware
        originalAuthMiddleware = require('../../../src/interfaces/middleware/auth').authMiddleware;
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Restore original auth middleware
        jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation(originalAuthMiddleware);

        // Create fresh app instance
        app = createTestApp();
    });

    describe('GET /api/balance/current', () => {
        it('should return null balance for BASIC user', async () => {
            // Temporarily override auth middleware to set user as BASIC
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'BASIC', roles: [] };
                next();
            });

            // Recreate app with the overridden middleware
            app = createTestApp();

            const response = await request(app)
                .get('/api/balance/current')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                data: null,
                message: 'Wallet balance data available after wallet connection',
            });
        });

        it('should return current balance for VERIFIED user with connected wallet', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            const mockBalance = '100.50';

            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.getNativeBalance.mockResolvedValue(mockBalance);

            const response = await request(app)
                .get('/api/balance/current')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                data: mockBalance,
            });

            expect(mockBlockchainService.getUserWalletAddress).toHaveBeenCalledWith('user-123');
            expect(mockBlockchainService.getNativeBalance).toHaveBeenCalledWith(mockWalletAddress);
        });

        it('should throw validation error when wallet is not connected for VERIFIED user', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            mockBlockchainService.getUserWalletAddress.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/balance/current')
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Wallet not connected');
        });

        it('should throw external service error when blockchain service fails', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.getNativeBalance.mockRejectedValue(new Error('Failed to get balance from blockchain'));

            const response = await request(app)
                .get('/api/balance/current')
                .expect(502);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBeDefined();
        });

        it('should throw validation error for Kodiak account errors', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.getNativeBalance.mockRejectedValue(new Error('no Kodiak account connected'));

            const response = await request(app)
                .get('/api/balance/current')
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Wallet not connected');
        });

        it('should throw validation error for Kodiak credentials errors', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.getNativeBalance.mockRejectedValue(new Error('Kodiak credentials not found'));

            const response = await request(app)
                .get('/api/balance/current')
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Wallet not connected');
        });

        it('should throw not found error for unexpected failures', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.getNativeBalance.mockRejectedValue(new Error('Unexpected error'));

            const response = await request(app)
                .get('/api/balance/current')
                .expect(404);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('temporarily unavailable');
        });

        it('should throw validation error for non-VERIFIED (REGISTERED) users', async () => {
            // Temporarily override auth middleware to set user as REGISTERED
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'REGISTERED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.getNativeBalance.mockRejectedValue(new Error('Some error'));

            const response = await request(app)
                .get('/api/balance/current')
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('requires VERIFIED account status');
        });

        it('should handle unauthenticated user scenario', async () => {
            // Temporarily override auth middleware to not set user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = null;
                next();
            });

            app = createTestApp();

            const response = await request(app)
                .get('/api/balance/current')
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('User not authenticated');
        });
    });

    describe('POST /api/balance/refresh', () => {
        it('should refresh balance successfully for user with connected wallet', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            const mockBalance = '200.75';

            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.invalidateUserCache.mockResolvedValue(undefined);
            mockBlockchainService.getNativeBalance.mockResolvedValue(mockBalance);

            const response = await request(app)
                .post('/api/balance/refresh')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                data: mockBalance,
            });

            expect(mockBlockchainService.getUserWalletAddress).toHaveBeenCalledWith('user-123');
            expect(mockBlockchainService.invalidateUserCache).toHaveBeenCalledWith('user-123', mockWalletAddress);
            expect(mockBlockchainService.getNativeBalance).toHaveBeenCalledWith(mockWalletAddress);
        });

        it('should return validation error when wallet is not connected', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            mockBlockchainService.getUserWalletAddress.mockResolvedValue(null);

            const response = await request(app)
                .post('/api/balance/refresh')
                .expect(500);

            expect(response.body.success).toBe(true);
            expect(response.body.error).toContain('No connected wallet found');
        });

        it('should handle refresh failure and return error', async () => {
            // Ensure we're using VERIFIED user
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
                next();
            });

            app = createTestApp();

            const mockWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
            const mockError = new Error('Blockchain connection timeout');

            mockBlockchainService.getUserWalletAddress.mockResolvedValue(mockWalletAddress);
            mockBlockchainService.invalidateUserCache.mockRejectedValue(mockError);

            const response = await request(app)
                .post('/api/balance/refresh')
                .expect(500);

            expect(response.body.success).toBe(true);
            expect(response.body.error).toBeDefined();
        });
    });
});