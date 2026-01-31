/** @format */

import request from 'supertest';
import { Express } from 'express';

// Mock DI container before importing any other modules
jest.mock('../../../src/infrastructure/dependency-injection.container', () => {
    const mockWalletQualificationService = {
        checkAlphaQualification: jest.fn().mockResolvedValue({
            qualified: true,
            walletConnected: true,
            chainValid: true,
            criteria: { balance: 1000 },
            reasons: [],
        }),
        getQualificationConfig: jest.fn().mockReturnValue({ minBalance: 500 }),
    };

    const mockRoleManagementService = {
        assignRole: jest.fn().mockResolvedValue(true),
    };

    return {
        diContainer: {
            authService: {
                register: jest.fn(),
                login: jest.fn(),
                refreshToken: jest.fn(),
                validateToken: jest.fn(),
                getUserById: jest.fn(),
                getAuthenticatedUserData: jest.fn(),
            },
            userRepository: {},
            passwordService: {},
            cacheService: {},
            roleManagementService: mockRoleManagementService,
            roleQualificationService: {},
            walletQualificationService: mockWalletQualificationService,
            balanceService: {},
            positionService: {},
            userProfileService: {},
            userKodiakService: {},
        },
    };
});

// Mock database query
jest.mock('../../../src/database/pool', () => ({
    query: jest.fn()
        .mockImplementation((sql: string) => {
            if (sql.includes('user_roles')) {
                return {
                    rows: [{ role: 'USER' }],
                };
            }
            return {
                rows: [{
                    id: 'test',
                    email: 'test@example.com',
                    user_level: 'VERIFIED',
                    created_at: new Date(),
                    updated_at: new Date(),
                }],
            };
        }),
}));

// Mock csrf module
jest.mock('csrf', () => {
    const mockTokens = {
        secretSync: jest.fn().mockReturnValue('secret'),
        create: jest.fn().mockReturnValue('csrf-token'),
        verify: jest.fn().mockReturnValue(true),
    };
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => mockTokens),
    };
});

jest.mock('../../../src/infrastructure/cache/redis.service', () => ({
    redisService: {
        connect: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn(() => ({
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
            setNX: jest.fn().mockResolvedValue(true),
        })),
        del: jest.fn().mockResolvedValue({ success: true }),
        atomicReadModifyWrite: jest.fn(),
        cleanupForTests: jest.fn(),
    },
}));

jest.mock('../../../src/infrastructure/security/rate-limiter.service', () => ({
    progressiveAuthLimiter: {
        recordSuccess: jest.fn(),
    },
}));

jest.mock('../../../src/shared/utils/context', () => ({
    setUserContext: jest.fn(),
    getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
}));

// Mock validation middleware to pass through
jest.mock('../../../src/interfaces/middleware/validation', () => ({
    validateRequest: jest.fn().mockImplementation(() => (req: any, res: any, next: any) => next()),
    validators: {
        register: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
        login: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
        refreshToken: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
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

// Get the mock auth service from the DI container mock
const mockAuthService = require('../../../src/infrastructure/dependency-injection.container').diContainer.authService;

// Create a test app
function createTestApp(): Express {
    const express = require('express');
    const app = express();

    // Add necessary middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Import and register routes
    const { authRoutes } = require('../../../src/interfaces/http/auth');
    app.use('/api/auth', authRoutes);

    return app;
}

describe('Auth Controller - Final Working Tests', () => {
    let app: Express;

    beforeAll(() => {
        // Set JWT secrets for tests
        process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-purposes-only';
        process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-testing-purposes-only';
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create fresh app instance
        app = createTestApp();
    });

    describe('POST /api/auth/register', () => {
        it('should successfully register a new user', async () => {
            const testUser = {
                id: 'test',
                email: 'test@example.com',
                userLevel: 'BASIC',
            };
            const tokens = {
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            };

            mockAuthService.register.mockResolvedValue({
                success: true,
                user: testUser,
                tokens,
            });

            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    password: 'Password123!', // Valid password: uppercase, lowercase, number, special char
                })
                .expect(201);

            expect(response.body).toEqual({
                success: true,
                user: testUser,
            });

            expect(mockAuthService.register).toHaveBeenCalledWith('test@example.com', 'Password123!');
        });

        it('should handle registration failure', async () => {
            mockAuthService.register.mockResolvedValue({
                success: false,
                message: 'Email already exists',
            });

            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    password: 'Password123!', // Valid password: uppercase, lowercase, number, special char
                })
                .expect(400);

            expect(response.body).toEqual({
                success: false,
                error: 'Validation failed: Email already exists',
                code: 'VALIDATION_ERROR',
                correlationId: 'test-correlation-id',
            });
        });
    });

    describe('POST /api/auth/login', () => {
        it('should successfully login a user', async () => {
            const testUser = {
                id: 'test',
                email: 'test@example.com',
                userLevel: 'REGISTERED',
            };
            const tokens = {
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            };

            mockAuthService.login.mockResolvedValue({
                success: true,
                user: testUser,
                tokens,
            });

            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'Password123!', // Valid password: uppercase, lowercase, number, special char
                })
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                user: testUser,
            });

            expect(mockAuthService.login).toHaveBeenCalledWith({
                email: 'test@example.com',
                password: 'Password123!',
            });
        });

        it('should handle login failure', async () => {
            mockAuthService.login.mockResolvedValue({
                success: false,
                message: 'Invalid credentials',
            });

            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'WrongPassword123!', // Valid password format but wrong credentials
                })
                .expect(400);

            expect(response.body).toEqual({
                success: false,
                error: 'Validation failed: Invalid credentials',
                code: 'VALIDATION_ERROR',
                correlationId: 'test-correlation-id',
            });
        });
    });

    describe('POST /api/auth/refresh', () => {
        it('should successfully refresh tokens', async () => {
            const testUser = {
                id: 'test',
                email: 'test@example.com',
                userLevel: 'REGISTERED',
            };
            const tokens = {
                accessToken: 'new-access-token',
                refreshToken: 'new-refresh-token',
            };

            mockAuthService.refreshToken.mockResolvedValue({
                success: true,
                user: testUser,
                tokens,
            });

            const response = await request(app)
                .post('/api/auth/refresh')
                .send({
                    refreshToken: 'valid-refresh-token-jwt-format',
                })
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                user: testUser,
            });

            expect(mockAuthService.refreshToken).toHaveBeenCalledWith('valid-refresh-token-jwt-format');
        });

        it('should handle refresh token failure', async () => {
            mockAuthService.refreshToken.mockResolvedValue({
                success: false,
                message: 'Invalid refresh token',
            });

            const response = await request(app)
                .post('/api/auth/refresh')
                .send({
                    refreshToken: 'invalid-refresh-token-format',
                })
                .expect(400);

            expect(response.body).toEqual({
                success: false,
                error: 'Validation failed: Invalid refresh token',
                code: 'VALIDATION_ERROR',
                correlationId: 'test-correlation-id',
            });
        });
    });

    describe('POST /api/auth/logout', () => {
        it('should successfully logout a user', async () => {
            const response = await request(app)
                .post('/api/auth/logout')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                message: 'Logged out successfully',
            });
        });

        it('should logout even without refresh token', async () => {
            const response = await request(app)
                .post('/api/auth/logout')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                message: 'Logged out successfully',
            });
        });
    });

    describe('POST /api/auth/check-qualification', () => {
        it('should check qualification for VERIFIED user', async () => {
            const response = await request(app)
                .post('/api/auth/check-qualification')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                qualified: true,
                walletConnected: true,
                chainValid: true,
                criteria: { balance: 1000 },
                reasons: [],
                config: { minBalance: 500 },
            });
        });

        it('should reject qualification check for non-VERIFIED user', async () => {
            // Temporarily override the auth middleware to set user as non-VERIFIED
            const originalAuthMiddleware = require('../../../src/interfaces/middleware/auth').authMiddleware;
            jest.spyOn(require('../../../src/interfaces/middleware/auth'), 'authMiddleware').mockImplementation((req: any, res: any, next: any) => {
                req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'REGISTERED', roles: [] };
                next();
            });

            // Recreate app with the overridden middleware
            app = createTestApp();

            const response = await request(app)
                .post('/api/auth/check-qualification')
                .expect(400);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/auth/qualification-config', () => {
        it('should return qualification config for authenticated user', async () => {
            const response = await request(app)
                .get('/api/auth/qualification-config')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                config: { minBalance: 500 },
            });
        });
    });

    describe('GET /api/auth/me', () => {
        it('should return user data for authenticated user', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(expect.objectContaining({
                id: 'test',
                email: 'test@example.com',
                userLevel: 'VERIFIED',
                roles: ['USER'],
            }));
        });

        it('should handle user not found', async () => {
            // Temporarily override the database query to return no user
            const originalQuery = require('../../../src/database/pool').query;
            jest.spyOn(require('../../../src/database/pool'), 'query').mockImplementation((...args: unknown[]) => {
                const sql = args[0] as string;
                if (sql.includes('user_roles')) {
                    return { rows: [] };
                }
                return { rows: [] };
            });

            const response = await request(app)
                .get('/api/auth/me')
                .expect(400);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/auth/csrf-token', () => {
        it('should generate and return CSRF token', async () => {
            const response = await request(app)
                .get('/api/auth/csrf-token')
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                csrfToken: 'csrf-token',
                expiresIn: 24 * 60 * 60,
            });
        });
    });
});
