/** @format */

import { AuthService, createAuthService, AuthServiceDependencies } from '../../src/core/auth/auth.service.pure';
import { UserLevel } from '@trade-bot/shared';

describe('AuthService', () => {
    // Create mock dependencies for the AuthService
    const createMockDependencies = (): AuthServiceDependencies => {
        return {
            userRepository: {
                findByEmail: jest.fn(),
                findByEmailWithPassword: jest.fn(),
                create: jest.fn(),
                findById: jest.fn(),
                getAuthenticatedUserData: jest.fn(),
                updateUserLevel: jest.fn(),
                updateProfile: jest.fn(),
                getWalletAddress: jest.fn(),
            },
            cache: {
                get: jest.fn(),
                setex: jest.fn(),
                delete: jest.fn(),
                set: jest.fn(),
                exists: jest.fn(),
                mget: jest.fn(),
                mset: jest.fn(),
                atomicConditionalUpdate: jest.fn(),
            },
            tokenService: {
                verifyToken: jest.fn(),
                verifyTokenWithDatabaseValidation: jest.fn(),
                generateAccessToken: jest.fn(),
                generateRefreshToken: jest.fn(),
                hashTokenForStorage: jest.fn(),
            },
            passwordService: {
                hash: jest.fn(),
                verify: jest.fn(),
            },
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                child: jest.fn(),
            },
            auditLogger: {
                logEvent: jest.fn(),
                getUserLogs: jest.fn(),
            },
        };
    };

    describe('Constructor', () => {
        it('should create an instance of AuthService', () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);
            expect(authService).toBeInstanceOf(AuthService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const authService = createAuthService(deps);
            expect(authService).toBeInstanceOf(AuthService);
        });
    });

    describe('User Registration', () => {
        it('should successfully register a new user', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'test@example.com';
            const testPassword = 'Password123!';
            const testUserId = 'user-123';
            const testUserLevel = UserLevel.BASIC;
            const testPasswordHash = 'hashed-password';
            const testAccessToken = 'access-token';
            const testRefreshToken = 'refresh-token';

            // Mock dependencies
            (deps.userRepository.findByEmail as jest.Mock).mockResolvedValue(null);
            (deps.passwordService.hash as jest.Mock).mockResolvedValue(testPasswordHash);
            (deps.userRepository.create as jest.Mock).mockResolvedValue({
                id: testUserId,
                email: testEmail,
                userLevel: testUserLevel,
            });
            (deps.tokenService.generateAccessToken as jest.Mock).mockReturnValue(testAccessToken);
            (deps.tokenService.generateRefreshToken as jest.Mock).mockReturnValue(testRefreshToken);

            const result = await authService.register(testEmail, testPassword);

            expect(result.success).toBe(true);
            expect(result.user?.id).toEqual(testUserId);
            expect(result.user?.email).toEqual(testEmail);
            expect(result.user?.userLevel).toEqual(testUserLevel);
            expect(result.tokens?.accessToken).toEqual(testAccessToken);
            expect(result.tokens?.refreshToken).toEqual(testRefreshToken);

            expect(deps.userRepository.findByEmail).toHaveBeenCalledWith(testEmail);
            expect(deps.passwordService.hash).toHaveBeenCalledWith(testPassword);
            expect(deps.userRepository.create).toHaveBeenCalled();
            expect(deps.tokenService.generateAccessToken).toHaveBeenCalled();
            expect(deps.tokenService.generateRefreshToken).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
            expect(deps.auditLogger?.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'USER_REGISTERED' })
            );
        });

        it('should fail to register when email already exists', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'test@example.com';
            const testPassword = 'Password123!';

            (deps.userRepository.findByEmail as jest.Mock).mockResolvedValue({
                id: 'existing-user',
                email: testEmail,
            });

            const result = await authService.register(testEmail, testPassword);

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Email already registered');
            expect(deps.logger.warn).toHaveBeenCalled();
            expect(deps.auditLogger?.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'USER_REGISTRATION_FAILED' })
            );
        });

        it('should handle registration errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'test@example.com';
            const testPassword = 'Password123!';

            (deps.userRepository.findByEmail as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await authService.register(testEmail, testPassword);

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Registration failed');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('User Login', () => {
        it('should successfully login a user with valid credentials', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'test@example.com';
            const testPassword = 'Password123!';
            const testUserId = 'user-123';
            const testUserLevel = UserLevel.VERIFIED;
            const testPasswordHash = 'hashed-password';
            const testAccessToken = 'access-token';
            const testRefreshToken = 'refresh-token';

            (deps.userRepository.findByEmailWithPassword as jest.Mock).mockResolvedValue({
                id: testUserId,
                email: testEmail,
                userLevel: testUserLevel,
                passwordHash: testPasswordHash,
            });
            (deps.passwordService.verify as jest.Mock).mockResolvedValue(true);
            (deps.tokenService.generateAccessToken as jest.Mock).mockReturnValue(testAccessToken);
            (deps.tokenService.generateRefreshToken as jest.Mock).mockReturnValue(testRefreshToken);

            const result = await authService.login({ email: testEmail, password: testPassword });

            expect(result.success).toBe(true);
            expect(result.user?.id).toEqual(testUserId);
            expect(result.tokens?.accessToken).toEqual(testAccessToken);

            expect(deps.userRepository.findByEmailWithPassword).toHaveBeenCalledWith(testEmail);
            expect(deps.passwordService.verify).toHaveBeenCalledWith(testPassword, testPasswordHash);
            expect(deps.tokenService.generateAccessToken).toHaveBeenCalled();
            expect(deps.tokenService.generateRefreshToken).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
            expect(deps.auditLogger?.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'USER_LOGIN' })
            );
        });

        it('should fail login when user not found', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'nonexistent@example.com';
            const testPassword = 'Password123!';

            (deps.userRepository.findByEmailWithPassword as jest.Mock).mockResolvedValue(null);

            const result = await authService.login({ email: testEmail, password: testPassword });

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Invalid credentials');
            expect(deps.logger.warn).toHaveBeenCalled();
            expect(deps.auditLogger?.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'USER_LOGIN_FAILED',
                    details: expect.objectContaining({ reason: 'user_not_found' })
                })
            );
        });

        it('should fail login when password is invalid', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'test@example.com';
            const testPassword = 'WrongPassword123!';
            const testUserId = 'user-123';
            const testPasswordHash = 'hashed-password';

            (deps.userRepository.findByEmailWithPassword as jest.Mock).mockResolvedValue({
                id: testUserId,
                email: testEmail,
                userLevel: UserLevel.BASIC,
                passwordHash: testPasswordHash,
            });
            (deps.passwordService.verify as jest.Mock).mockResolvedValue(false);

            const result = await authService.login({ email: testEmail, password: testPassword });

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Invalid credentials');
            expect(deps.logger.warn).toHaveBeenCalled();
            expect(deps.auditLogger?.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'USER_LOGIN_FAILED',
                    details: expect.objectContaining({ reason: 'invalid_password' })
                })
            );
        });

        it('should handle login errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'test@example.com';
            const testPassword = 'Password123!';

            (deps.userRepository.findByEmailWithPassword as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await authService.login({ email: testEmail, password: testPassword });

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Login failed');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Token Refresh', () => {
        it('should successfully refresh tokens with valid refresh token', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testEmail = 'test@example.com';
            const testUserLevel = UserLevel.VERIFIED;
            const testRefreshToken = 'valid-refresh-token';
            const testAccessToken = 'new-access-token';
            const testNewRefreshToken = 'new-refresh-token';

            (deps.tokenService.verifyToken as jest.Mock).mockReturnValue({ userId: testUserId });
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                email: testEmail,
                userLevel: testUserLevel,
            });
            (deps.tokenService.generateAccessToken as jest.Mock).mockReturnValue(testAccessToken);
            (deps.tokenService.generateRefreshToken as jest.Mock).mockReturnValue(testNewRefreshToken);

            const result = await authService.refreshToken(testRefreshToken);

            expect(result.success).toBe(true);
            expect(result.user?.id).toEqual(testUserId);
            expect(result.tokens?.accessToken).toEqual(testAccessToken);
            expect(result.tokens?.refreshToken).toEqual(testNewRefreshToken);

            expect(deps.tokenService.verifyToken).toHaveBeenCalledWith(testRefreshToken);
            expect(deps.userRepository.findById).toHaveBeenCalledWith(testUserId);
            expect(deps.tokenService.generateAccessToken).toHaveBeenCalled();
            expect(deps.tokenService.generateRefreshToken).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should fail to refresh token with invalid token', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            (deps.tokenService.verifyToken as jest.Mock).mockReturnValue(null);

            const result = await authService.refreshToken('invalid-refresh-token');

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Invalid refresh token');
            expect(deps.logger.warn).toHaveBeenCalled();
        });

        it('should fail to refresh token when user not found', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'nonexistent-user';
            (deps.tokenService.verifyToken as jest.Mock).mockReturnValue({ userId: testUserId });
            (deps.userRepository.findById as jest.Mock).mockResolvedValue(null);

            const result = await authService.refreshToken('valid-refresh-token');

            expect(result.success).toBe(false);
            expect(result.message).toEqual('User not found');
            expect(deps.logger.warn).toHaveBeenCalled();
        });

        it('should handle token refresh errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            (deps.tokenService.verifyToken as jest.Mock).mockImplementation(() => {
                throw new Error('Token verification failed');
            });

            const result = await authService.refreshToken('valid-refresh-token');

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Invalid refresh token');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Token Validation', () => {
        it('should validate valid token successfully', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testEmail = 'test@example.com';
            const testUserLevel = UserLevel.VERIFIED;
            const testToken = 'valid-access-token';

            (deps.tokenService.verifyTokenWithDatabaseValidation as jest.Mock).mockResolvedValue({
                userId: testUserId,
                email: testEmail,
                userLevel: testUserLevel,
            });

            const result = await authService.validateToken(testToken);

            expect(result).not.toBeNull();
            expect(result?.userId).toEqual(testUserId);
            expect(deps.tokenService.verifyTokenWithDatabaseValidation).toHaveBeenCalledWith(testToken, authService);
        });

        it('should return null for invalid token', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            (deps.tokenService.verifyTokenWithDatabaseValidation as jest.Mock).mockResolvedValue(null);

            const result = await authService.validateToken('invalid-token');

            expect(result).toBeNull();
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle token validation errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            (deps.tokenService.verifyTokenWithDatabaseValidation as jest.Mock).mockRejectedValue(new Error('Validation error'));

            const result = await authService.validateToken('valid-token');

            expect(result).toBeNull();
            expect(deps.logger.debug).toHaveBeenCalled();
        });
    });

    describe('User Data Management', () => {
        it('should get authenticated user data with cache hit', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testUserData = {
                user: { id: testUserId, email: 'test@example.com', userLevel: UserLevel.VERIFIED },
                roles: ['USER'],
                hasCredentials: true,
            };

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: true, data: testUserData });

            const result = await authService.getAuthenticatedUserData(testUserId);

            expect(result).toEqual(testUserData);
            expect(deps.cache.get).toHaveBeenCalled();
            expect(deps.userRepository.getAuthenticatedUserData).not.toHaveBeenCalled();
            expect(deps.logger.debug).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: testUserId }));
        });

        it('should get authenticated user data with cache miss', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testUserData = {
                user: { id: testUserId, email: 'test@example.com', userLevel: UserLevel.VERIFIED },
                roles: ['USER'],
                hasCredentials: true,
            };

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.userRepository.getAuthenticatedUserData as jest.Mock).mockResolvedValue(testUserData);
            (deps.cache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await authService.getAuthenticatedUserData(testUserId);

            expect(result).toEqual(testUserData);
            expect(deps.cache.get).toHaveBeenCalled();
            expect(deps.userRepository.getAuthenticatedUserData).toHaveBeenCalledWith(testUserId);
            expect(deps.cache.setex).toHaveBeenCalled();
            expect(deps.logger.debug).toHaveBeenCalledWith('Auth user data cache miss, querying repository', expect.any(Object));
        });

        it('should handle cache set failure when storing authenticated user data', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testUserData = {
                user: { id: testUserId, email: 'test@example.com', userLevel: UserLevel.VERIFIED },
                roles: ['USER'],
                hasCredentials: true,
            };

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.userRepository.getAuthenticatedUserData as jest.Mock).mockResolvedValue(testUserData);
            (deps.cache.setex as jest.Mock).mockResolvedValue({ success: false, error: 'Cache storage failed' });

            const result = await authService.getAuthenticatedUserData(testUserId);

            expect(result).toEqual(testUserData);
            expect(deps.cache.get).toHaveBeenCalled();
            expect(deps.userRepository.getAuthenticatedUserData).toHaveBeenCalledWith(testUserId);
            expect(deps.cache.setex).toHaveBeenCalled();
            expect(deps.logger.warn).toHaveBeenCalled();
        });

        it('should return null when user data not found', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'nonexistent-user';

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.userRepository.getAuthenticatedUserData as jest.Mock).mockResolvedValue(null);

            const result = await authService.getAuthenticatedUserData(testUserId);

            expect(result).toBeNull();
        });

        it('should handle getting user data errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';

            (deps.cache.get as jest.Mock).mockRejectedValue(new Error('Cache error'));

            const result = await authService.getAuthenticatedUserData(testUserId);

            expect(result).toBeNull();
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should invalidate user data cache', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            (deps.cache.delete as jest.Mock).mockResolvedValue({ success: true });

            await authService.invalidateUserDataCache(testUserId);

            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle cache invalidation errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            (deps.cache.delete as jest.Mock).mockResolvedValue({ success: false, error: 'Cache error' });

            await authService.invalidateUserDataCache(testUserId);

            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.logger.warn).toHaveBeenCalled();
        });
    });

    describe('User Level Management', () => {
        it('should update user level successfully', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testNewLevel = UserLevel.VERIFIED;

            (deps.userRepository.updateUserLevel as jest.Mock).mockResolvedValue(true);
            (deps.cache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result = await authService.updateUserLevel(testUserId, testNewLevel);

            expect(result).toBe(true);
            expect(deps.userRepository.updateUserLevel).toHaveBeenCalledWith(testUserId, testNewLevel);
            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
            expect(deps.auditLogger?.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'USER_LEVEL_UPDATED',
                    details: expect.objectContaining({ newLevel: testNewLevel })
                })
            );
        });

        it('should return false when user level update fails', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testNewLevel = UserLevel.VERIFIED;

            (deps.userRepository.updateUserLevel as jest.Mock).mockResolvedValue(false);

            const result = await authService.updateUserLevel(testUserId, testNewLevel);

            expect(result).toBe(false);
        });

        it('should handle user level update errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testNewLevel = UserLevel.VERIFIED;

            (deps.userRepository.updateUserLevel as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await authService.updateUserLevel(testUserId, testNewLevel);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('User Lookup', () => {
        it('should get user by ID successfully', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testUser = {
                id: testUserId,
                email: 'test@example.com',
                userLevel: UserLevel.BASIC,
            };

            (deps.userRepository.findById as jest.Mock).mockResolvedValue(testUser);

            const result = await authService.getUserById(testUserId);

            expect(result).toEqual(testUser);
            expect(deps.userRepository.findById).toHaveBeenCalledWith(testUserId);
        });

        it('should handle user lookup errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';

            (deps.userRepository.findById as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await authService.getUserById(testUserId);

            expect(result).toBeNull();
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Password Management', () => {
        it('should verify valid password', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testPassword = 'Password123!';
            const testPasswordHash = 'hashed-password';

            (deps.passwordService.verify as jest.Mock).mockResolvedValue(true);

            const result = await authService.verifyPassword(testPasswordHash, testPassword);

            expect(result).toBe(true);
            expect(deps.passwordService.verify).toHaveBeenCalledWith(testPassword, testPasswordHash);
        });

        it('should fail password verification for invalid password', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testPassword = 'WrongPassword123!';
            const testPasswordHash = 'hashed-password';

            (deps.passwordService.verify as jest.Mock).mockResolvedValue(false);

            const result = await authService.verifyPassword(testPasswordHash, testPassword);

            expect(result).toBe(false);
        });

        it('should handle password verification errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testPassword = 'Password123!';
            const testPasswordHash = 'hashed-password';

            (deps.passwordService.verify as jest.Mock).mockRejectedValue(new Error('Verification error'));

            const result = await authService.verifyPassword(testPasswordHash, testPassword);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should hash password successfully', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testPassword = 'Password123!';
            const testHash = 'hashed-password';

            (deps.passwordService.hash as jest.Mock).mockResolvedValue(testHash);

            const result = await authService.hashPassword(testPassword);

            expect(result).toEqual(testHash);
            expect(deps.passwordService.hash).toHaveBeenCalledWith(testPassword);
        });

        it('should throw error when password hashing fails', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testPassword = 'Password123!';

            (deps.passwordService.hash as jest.Mock).mockRejectedValue(new Error('Hashing error'));

            await expect(authService.hashPassword(testPassword)).rejects.toThrow();
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Token Invalidation', () => {
        it('should invalidate user tokens successfully', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';

            (deps.cache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result = await authService.invalidateUserTokens(testUserId);

            expect(result.success).toBe(true);
            expect(result.tokensBlacklisted).toEqual(0);
            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.auditLogger?.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'USER_TOKENS_INVALIDATED' })
            );
        });

        it('should handle token invalidation errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';

            (deps.cache.delete as jest.Mock).mockRejectedValue(new Error('Cache error'));

            const result = await authService.invalidateUserTokens(testUserId);

            expect(result.success).toBe(false);
            expect(result.errors).toEqual(expect.arrayContaining([expect.any(String)]));
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Wallet Verification', () => {
        it('should verify wallet ownership', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testWalletAddress = '0x1234...';
            const testSignature = 'signature';
            const testMessage = 'message';

            const result = await authService.verifyWalletOwnership(testUserId, testWalletAddress, testSignature, testMessage);

            expect(result.success).toBe(true);
            expect(result.message).toEqual('Wallet ownership verified');
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should handle wallet verification errors', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testUserId = 'user-123';
            const testWalletAddress = '0x1234...';
            const testSignature = 'signature';
            const testMessage = 'message';

            (deps.logger.info as jest.Mock).mockImplementation(() => {
                throw new Error('Wallet verification failed');
            });

            const result = await authService.verifyWalletOwnership(testUserId, testWalletAddress, testSignature, testMessage);

            expect(result.success).toBe(false);
            expect(result.message).toEqual('Failed to verify wallet ownership');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Legacy API Support', () => {
        it('should detect legacy format requirement', () => {
            // This tests the private method by accessing through prototype
            const originalEnv = process.env.LEGACY_AUTH_API;

            process.env.LEGACY_AUTH_API = 'true';

            // We need to use any type to access private properties/methods for testing
            const getShouldReturnLegacyFormat = (service: any) => service.shouldReturnLegacyFormat();

            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const result = getShouldReturnLegacyFormat(authService);

            expect(result).toBe(true);

            process.env.LEGACY_AUTH_API = originalEnv;
        });

        it('should convert to legacy format', () => {
            const originalEnv = process.env.LEGACY_AUTH_API;
            process.env.LEGACY_AUTH_API = 'true';

            // We need to use any type to access private properties/methods for testing
            const convertToLegacyFormat = (service: any, result: any) => service.convertToLegacyFormat(result);

            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testResult = {
                success: true,
                message: 'Success',
                user: { id: 'user-123', email: 'test@example.com', userLevel: UserLevel.BASIC },
                tokens: {
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                    expiresIn: 14400,
                },
            };

            const legacyResult = convertToLegacyFormat(authService, testResult);

            expect(legacyResult.success).toEqual(testResult.success);
            expect(legacyResult.message).toEqual(testResult.message);
            expect(legacyResult.user).toEqual(testResult.user);
            expect(legacyResult.tokens).toEqual(testResult.tokens);

            process.env.LEGACY_AUTH_API = originalEnv;
        });
    });

    describe('Audit Logging', () => {
        it('should handle audit log event failure', async () => {
            const deps = createMockDependencies();
            const authService = new AuthService(deps);

            const testEmail = 'test@example.com';
            const testPassword = 'Password123!';
            const testUserId = 'user-123';
            const testUserLevel = UserLevel.BASIC;
            const testPasswordHash = 'hashed-password';
            const testAccessToken = 'access-token';
            const testRefreshToken = 'refresh-token';

            (deps.userRepository.findByEmail as jest.Mock).mockResolvedValue(null);
            (deps.passwordService.hash as jest.Mock).mockResolvedValue(testPasswordHash);
            (deps.userRepository.create as jest.Mock).mockResolvedValue({
                id: testUserId,
                email: testEmail,
                userLevel: testUserLevel,
            });
            (deps.tokenService.generateAccessToken as jest.Mock).mockReturnValue(testAccessToken);
            (deps.tokenService.generateRefreshToken as jest.Mock).mockReturnValue(testRefreshToken);
            (deps.auditLogger?.logEvent as jest.Mock).mockRejectedValue(new Error('Audit log failed'));

            const result = await authService.register(testEmail, testPassword);

            expect(result.success).toBe(true);
            expect(deps.logger.warn).toHaveBeenCalledWith(
                'Failed to log audit event',
                expect.any(Object)
            );
        });
    });
});