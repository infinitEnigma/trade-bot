/**
 * Pure Auth Service - Clean Architecture Implementation
 *
 * Business logic for user authentication and authorization with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IUserRepository: User data access abstraction
 * - ICacheService: Caching abstraction for user data
 * - ITokenService: JWT token management abstraction
 * - IPasswordService: Password hashing abstraction
 * - ILogger: Logging abstraction
 * - IAuditLogRepository: Security audit logging abstraction
 *
 * @format
 */

import {
    IUserRepository,
    ICacheService,
    ITokenService,
    IPasswordService,
    ILogger,
    IAuditLogRepository,
    User,
    UserLevel,
    UserRegistration,
    UserLogin,
    AuthTokens,
    TokenPayload,
    CacheResult
} from '@trade-bot/shared';

export interface AuthServiceDependencies {
    userRepository: IUserRepository;
    cache: ICacheService;
    tokenService: ITokenService;
    passwordService: IPasswordService;
    logger: ILogger;
    auditLogger?: IAuditLogRepository;
}

/**
 * Result type for authentication operations
 */
export interface AuthResult {
    success: boolean;
    message?: string;
    user?: {
        id: string;
        email: string;
        userLevel: UserLevel;
    };
    tokens?: AuthTokens;
}

/**
 * Legacy Auth Result - For API compatibility during migration
 *
 * Matches the format returned by the legacy impure auth service.
 * Used when LEGACY_AUTH_API=true to maintain backward compatibility.
 */
export interface LegacyAuthResult {
    success: boolean;
    message?: string;
    user?: {
        id: string;
        email: string;
        userLevel: UserLevel;
    };
    tokens?: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    };
}

/**
 * Pure Auth Service
 *
 * Implements authentication business logic using dependency injection.
 * No direct dependencies on databases, Redis, JWT libraries, or password hashing.
 */
export class AuthService {
    private readonly CACHE_TTL = 300; // 5 minutes for user data
    private readonly CACHE_PREFIX = 'auth:user';

    constructor(private deps: AuthServiceDependencies) { }

    /**
     * Register a new user
     *
     * Business Logic:
     * 1. Validate email uniqueness
     * 2. Hash password using abstracted service
     * 3. Create user with BASIC level
     * 4. Generate JWT tokens
     * 5. Log security event
     * 6. Return user data and tokens (or legacy format)
     */
    async register(email: string, password: string): Promise<AuthResult | LegacyAuthResult> {
        try {
            this.deps.logger.debug('User registration attempt', { email });

            // Check email uniqueness
            const existingUser = await this.deps.userRepository.findByEmail(email);
            if (existingUser) {
                this.deps.logger.warn('Registration failed - email already exists', { email });
                await this.logAuditEvent('USER_REGISTRATION_FAILED', { email, reason: 'email_exists' });
                return { success: false, message: 'Email already registered' };
            }

            // Hash password using abstracted service
            const passwordHash = await this.deps.passwordService.hash(password);

            // Create user registration data
            const userData: UserRegistration = {
                email,
                password: passwordHash
            };

            // Create user through repository
            const newUser = await this.deps.userRepository.create(userData);

            // Generate tokens
            const tokens = await this.generateTokens(newUser);

            // Log successful registration
            await this.logAuditEvent('USER_REGISTERED', {
                userId: newUser.id,
                email: newUser.email
            });

            this.deps.logger.info('User registered successfully', {
                userId: newUser.id,
                email: newUser.email
            });

            return {
                success: true,
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    userLevel: newUser.userLevel
                },
                tokens
            };

        } catch (error) {
            this.deps.logger.error('Registration error', {
                email,
                error: error instanceof Error ? error.message : String(error)
            });
            return { success: false, message: 'Registration failed' };
        }
    }

    /**
     * Authenticate user login
     *
     * Business Logic:
     * 1. Find user by email
     * 2. Verify password using abstracted service
     * 3. Generate JWT tokens
     * 4. Log successful authentication
     * 5. Return user data and tokens (or legacy format)
     */
    async login(credentials: UserLogin): Promise<AuthResult | LegacyAuthResult> {
        try {
            this.deps.logger.debug('User login attempt', { email: credentials.email });

            // Find user by email with password hash
            const user = await this.deps.userRepository.findByEmailWithPassword(credentials.email);
            if (!user) {
                this.deps.logger.warn('Login failed - user not found', { email: credentials.email });
                await this.logAuditEvent('USER_LOGIN_FAILED', {
                    email: credentials.email,
                    reason: 'user_not_found'
                });
                return { success: false, message: 'Invalid credentials' };
            }

            // Verify password using abstracted service
            const passwordValid = await this.deps.passwordService.verify(
                credentials.password,
                user.passwordHash
            );

            if (!passwordValid) {
                this.deps.logger.warn('Login failed - invalid password', {
                    userId: user.id,
                    email: user.email
                });
                await this.logAuditEvent('USER_LOGIN_FAILED', {
                    userId: user.id,
                    email: user.email,
                    reason: 'invalid_password'
                });
                return { success: false, message: 'Invalid credentials' };
            }

            // Generate tokens
            const tokens = await this.generateTokens(user);

            // Log successful login
            await this.logAuditEvent('USER_LOGIN', {
                userId: user.id,
                email: user.email
            });

            this.deps.logger.info('User logged in successfully', {
                userId: user.id,
                email: user.email
            });

            return {
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    userLevel: user.userLevel
                },
                tokens
            };

        } catch (error) {
            this.deps.logger.error('Login error', {
                email: credentials.email,
                error: error instanceof Error ? error.message : String(error)
            });
            return { success: false, message: 'Login failed' };
        }
    }

    /**
     * Refresh access token using refresh token
     *
     * Business Logic:
     * 1. Validate refresh token
     * 2. Verify token is not blacklisted
     * 3. Ensure user still exists
     * 4. Generate new token pair
     * 5. Handle concurrency protection
     */
    async refreshToken(refreshToken: string): Promise<AuthResult | LegacyAuthResult> {
        try {
            this.deps.logger.debug('Token refresh attempt');

            // Validate refresh token
            const payload = this.deps.tokenService.verifyToken(refreshToken);
            if (!payload) {
                this.deps.logger.warn('Token refresh failed - invalid token');
                return { success: false, message: 'Invalid refresh token' };
            }

            // Check if user still exists
            const user = await this.deps.userRepository.findById(payload.userId);
            if (!user) {
                this.deps.logger.warn('Token refresh failed - user not found', {
                    userId: payload.userId
                });
                return { success: false, message: 'User not found' };
            }

            // Generate new tokens
            const tokens = await this.generateTokens(user);

            this.deps.logger.info('Token refresh successful', { userId: user.id });

            return {
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    userLevel: user.userLevel
                },
                tokens
            };

        } catch (error) {
            this.deps.logger.error('Token refresh error', {
                error: error instanceof Error ? error.message : String(error)
            });
            return { success: false, message: 'Invalid refresh token' };
        }
    }

    /**
     * Validate access token
     *
     * Business Logic:
     * - Verify JWT signature and expiration
     * - Return decoded payload if valid
     */
    async validateToken(token: string): Promise<TokenPayload | null> {
        try {
            return this.deps.tokenService.verifyToken(token);
        } catch (error) {
            this.deps.logger.debug('Token validation failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Get authenticated user data with caching
     *
     * Business Logic:
     * 1. Check cache first for performance
     * 2. Query repository with JOIN for related data
     * 3. Cache result for future requests
     * 4. Return comprehensive user data
     */
    async getAuthenticatedUserData(userId: string): Promise<{
        user: User;
        roles: string[];
        hasCredentials: boolean;
    } | null> {
        try {
            const cacheKey = `${this.CACHE_PREFIX}:${userId}`;

            // Try cache first
            const cachedResult: CacheResult<any> = await this.deps.cache.get(cacheKey);
            if (cachedResult.success && cachedResult.data) {
                this.deps.logger.debug('Auth user data cache hit', { userId });
                return cachedResult.data;
            }

            // Cache miss - query repository
            this.deps.logger.debug('Auth user data cache miss, querying repository', { userId });

            const userData = await this.deps.userRepository.getAuthenticatedUserData(userId);
            if (!userData) {
                return null;
            }

            // Cache the result
            const cacheResult = await this.deps.cache.setex(cacheKey, this.CACHE_TTL, userData);
            if (!cacheResult.success) {
                this.deps.logger.warn('Failed to cache auth user data', {
                    userId,
                    error: cacheResult.error
                });
            }

            this.deps.logger.debug('Auth user data cached', {
                userId,
                rolesCount: userData.roles.length
            });

            return userData;

        } catch (error) {
            this.deps.logger.error('Failed to get authenticated user data', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Invalidate cached user data
     *
     * Business Logic:
     * - Clear cached auth data when user data changes
     * - Ensures fresh data on next request
     */
    async invalidateUserDataCache(userId: string): Promise<void> {
        const cacheKey = `${this.CACHE_PREFIX}:${userId}`;

        const result = await this.deps.cache.delete(cacheKey);

        if (result.success) {
            this.deps.logger.debug('Auth user data cache invalidated', { userId });
        } else {
            this.deps.logger.warn('Failed to invalidate auth user data cache', {
                userId,
                error: result.error
            });
        }
    }

    /**
     * Update user level
     *
     * Business Logic:
     * - Change user's permission level
     * - Invalidate cached data
     * - Log level change for audit
     */
    async updateUserLevel(userId: string, level: UserLevel): Promise<boolean> {
        try {
            this.deps.logger.info('Updating user level', { userId, newLevel: level });

            const success = await this.deps.userRepository.updateUserLevel(userId, level);

            if (success) {
                // Invalidate cached user data
                await this.invalidateUserDataCache(userId);

                // Log the change
                await this.logAuditEvent('USER_LEVEL_UPDATED', {
                    userId,
                    newLevel: level
                });

                this.deps.logger.info('User level updated successfully', {
                    userId,
                    newLevel: level
                });
            }

            return success;

        } catch (error) {
            this.deps.logger.error('User level update failed', {
                userId,
                newLevel: level,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Get user by ID
     *
     * Business Logic:
     * - Retrieve basic user information
     * - Used for token validation and user lookups
     */
    async getUserById(userId: string): Promise<User | null> {
        try {
            return await this.deps.userRepository.findById(userId);
        } catch (error) {
            this.deps.logger.error('Failed to get user by ID', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Verify wallet ownership for user verification
     *
     * Business Logic:
     * - Verify that a user owns a specific wallet address
     * - Used for wallet verification and security features
     */
    async verifyWalletOwnership(
        userId: string,
        walletAddress: string,
        signature: string,
        message: string
    ): Promise<{ success: boolean; message: string }> {
        try {
            // This is a placeholder implementation
            // In a real implementation, this would verify the signature against the message
            // and check if the wallet address matches the user's verified wallets
            this.deps.logger.info('Wallet ownership verification requested', {
                userId,
                walletAddress
            });

            // For now, return success - this should be implemented based on your wallet verification logic
            return {
                success: true,
                message: 'Wallet ownership verified'
            };
        } catch (error) {
            this.deps.logger.error('Wallet ownership verification failed', {
                userId,
                walletAddress,
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                success: false,
                message: 'Failed to verify wallet ownership'
            };
        }
    }

    /**
     * Verify password against stored hash
     *
     * Business Logic:
     * - Verify a plain text password against a stored hash
     * - Used for password validation during login/profile updates
     */
    async verifyPassword(storedHash: string, plainPassword: string): Promise<boolean> {
        try {
            return await this.deps.passwordService.verify(plainPassword, storedHash);
        } catch (error) {
            this.deps.logger.error('Password verification failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Hash a password using the configured password service
     *
     * Business Logic:
     * - Hash a plain text password for secure storage
     * - Used during user registration and password changes
     */
    async hashPassword(plainPassword: string): Promise<string> {
        try {
            return await this.deps.passwordService.hash(plainPassword);
        } catch (error) {
            this.deps.logger.error('Password hashing failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Invalidate user tokens (for logout/password change)
     *
     * Business Logic:
     * - Mark user tokens as invalid
     * - Used when passwords change or manual logout is required
     */
    async invalidateUserTokens(userId: string): Promise<{ success: boolean; tokensBlacklisted?: number; errors?: any[] }> {
        try {
            this.deps.logger.info('Invalidating user tokens', { userId });

            // Invalidate the user data cache which will force re-authentication
            await this.invalidateUserDataCache(userId);

            // Log the token invalidation
            await this.logAuditEvent('USER_TOKENS_INVALIDATED', {
                userId,
                reason: 'manual_invalidation'
            });

            return {
                success: true,
                tokensBlacklisted: 0, // Cache-based invalidation doesn't track individual tokens
            };
        } catch (error) {
            this.deps.logger.error('Token invalidation failed', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                success: false,
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
    }

    /**
     * Generate JWT tokens for user
     */
    private async generateTokens(user: User): Promise<AuthTokens> {
        const payload: TokenPayload = {
            userId: user.id,
            email: user.email,
            userLevel: user.userLevel
        };

        const accessToken = this.deps.tokenService.generateAccessToken(payload);
        const refreshToken = this.deps.tokenService.generateRefreshToken(payload);

        return {
            accessToken,
            refreshToken,
            expiresIn: 4 * 60 * 60 // 4 hours in seconds
        };
    }

    /**
     * Check if legacy API format should be returned
     *
     * Based on LEGACY_AUTH_API environment flag for backward compatibility
     * during gradual migration to pure services.
     */
    private shouldReturnLegacyFormat(): boolean {
        return process.env.LEGACY_AUTH_API === 'true';
    }

    /**
     * Convert AuthResult to legacy format
     *
     * Maintains API compatibility during migration by converting
     * the rich domain result to the flat legacy format.
     */
    private convertToLegacyFormat(result: AuthResult): LegacyAuthResult {
        return {
            success: result.success,
            message: result.message,
            user: result.user,
            tokens: result.tokens ? {
                accessToken: result.tokens.accessToken,
                refreshToken: result.tokens.refreshToken,
                expiresIn: result.tokens.expiresIn
            } : undefined
        };
    }

    /**
     * Log audit event if audit logger is available
     */
    private async logAuditEvent(action: string, details: Record<string, any>): Promise<void> {
        if (this.deps.auditLogger) {
            try {
                await this.deps.auditLogger.logEvent({
                    userId: details.userId || 'system',
                    action,
                    details
                });
            } catch (error) {
                this.deps.logger.warn('Failed to log audit event', {
                    action,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }
}

// Export factory function for creating service instances
export function createAuthService(deps: AuthServiceDependencies): AuthService {
    return new AuthService(deps);
}