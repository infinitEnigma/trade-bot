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
  ISignatureVerificationService,
  User,
  UserLevel,
  UserRegistration,
  UserLogin,
  AuthTokens,
  TokenPayload,
  TokenType,
  CacheResult,
} from "@trade-bot/shared";

export interface AuthServiceDependencies {
  userRepository: IUserRepository;
  cache: ICacheService;
  tokenService: ITokenService;
  passwordService: IPasswordService;
  logger: ILogger;
  auditLogger?: IAuditLogRepository;
  signatureVerificationService: ISignatureVerificationService;
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
  private readonly CACHE_PREFIX = "auth:user";
  private readonly JWT_BLACKLIST_PREFIX = "jwt:blacklist:"; // Must match CACHE_KEYS.jwtBlacklist in config/cache.config.ts
  private readonly REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds - matches refresh token expiry
  private readonly ACCESS_TOKEN_TTL = 4 * 60 * 60; // 4 hours in seconds - matches access token expiry

  constructor(private deps: AuthServiceDependencies) {}

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
  async register(
    email: string,
    password: string
  ): Promise<AuthResult | LegacyAuthResult> {
    try {
      this.deps.logger.debug("User registration attempt", { email });

      // Check email uniqueness
      const existingUser = await this.deps.userRepository.findByEmail(email);
      if (existingUser) {
        this.deps.logger.warn("Registration failed - email already exists", {
          email,
        });
        await this.logAuditEvent("USER_REGISTRATION_FAILED", {
          email,
          reason: "email_exists",
        });
        return { success: false, message: "Email already registered" };
      }

      // Hash password using abstracted service
      const passwordHash = await this.deps.passwordService.hash(password);

      // Create user registration data
      const userData: UserRegistration = {
        email,
        password: passwordHash,
      };

      // Create user through repository
      const newUser = await this.deps.userRepository.create(userData);

      // Generate tokens
      const tokens = await this.generateTokens(newUser);

      // Log successful registration
      await this.logAuditEvent("USER_REGISTERED", {
        userId: newUser.id,
        email: newUser.email,
      });

      this.deps.logger.info("User registered successfully", {
        userId: newUser.id,
        email: newUser.email,
      });

      return {
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          userLevel: newUser.userLevel,
        },
        tokens,
      };
    } catch (error) {
      this.deps.logger.error("Registration error", {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: "Registration failed" };
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
      this.deps.logger.debug("User login attempt", {
        email: credentials.email,
      });

      // Find user by email with password hash
      const user = await this.deps.userRepository.findByEmailWithPassword(
        credentials.email
      );
      if (!user) {
        this.deps.logger.warn("Login failed - user not found", {
          email: credentials.email,
        });
        await this.logAuditEvent("USER_LOGIN_FAILED", {
          email: credentials.email,
          reason: "user_not_found",
        });
        return { success: false, message: "Invalid credentials" };
      }

      // Verify password using abstracted service
      const passwordValid = await this.deps.passwordService.verify(
        credentials.password,
        user.passwordHash
      );

      if (!passwordValid) {
        this.deps.logger.warn("Login failed - invalid password", {
          userId: user.id,
          email: user.email,
        });
        await this.logAuditEvent("USER_LOGIN_FAILED", {
          userId: user.id,
          email: user.email,
          reason: "invalid_password",
        });
        return { success: false, message: "Invalid credentials" };
      }

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Log successful login
      await this.logAuditEvent("USER_LOGIN", {
        userId: user.id,
        email: user.email,
      });

      this.deps.logger.info("User logged in successfully", {
        userId: user.id,
        email: user.email,
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          userLevel: user.userLevel,
        },
        tokens,
      };
    } catch (error) {
      this.deps.logger.error("Login error", {
        email: credentials.email,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: "Login failed" };
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
  async refreshToken(
    refreshToken: string
  ): Promise<AuthResult | LegacyAuthResult> {
    try {
      this.deps.logger.debug("Token refresh attempt");

      // Reject refresh tokens that were blacklisted (e.g. via logout)
      if (await this.isTokenBlacklisted(refreshToken)) {
        this.deps.logger.warn("Token refresh failed - token is blacklisted");
        return { success: false, message: "Invalid refresh token" };
      }

      // Validate refresh token (type claim enforces this is a refresh token,
      // signed with the refresh secret - never accepts access tokens)
      const payload = this.deps.tokenService.verifyToken(
        refreshToken,
        "refresh"
      );
      if (!payload) {
        this.deps.logger.warn("Token refresh failed - invalid token");
        return { success: false, message: "Invalid refresh token" };
      }

      // Check if user still exists
      const user = await this.deps.userRepository.findById(payload.userId);
      if (!user) {
        this.deps.logger.warn("Token refresh failed - user not found", {
          userId: payload.userId,
        });
        return { success: false, message: "User not found" };
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      this.deps.logger.info("Token refresh successful", { userId: user.id });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          userLevel: user.userLevel,
        },
        tokens,
      };
    } catch (error) {
      this.deps.logger.error("Token refresh error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: "Invalid refresh token" };
    }
  }

  /**
   * Validate access token with database validation
   *
   * Business Logic:
   * - Verify JWT signature and expiration
   * - Check if user still exists in database (handles database resets)
   * - Return decoded payload if valid and user exists
   */
  async validateToken(token: string): Promise<TokenPayload | null> {
    try {
      // Reject tokens that were blacklisted (e.g. via logout/password change)
      if (await this.isTokenBlacklisted(token)) {
        this.deps.logger.debug(
          "Token validation failed - token is blacklisted"
        );
        return null;
      }

      // Use the new database validation method
      const payload =
        await this.deps.tokenService.verifyTokenWithDatabaseValidation(
          token,
          this
        );
      if (!payload) {
        this.deps.logger.debug(
          "Token validation failed - invalid token or user not found"
        );
        return null;
      }

      return payload;
    } catch (error) {
      this.deps.logger.debug("Token validation failed", {
        error: error instanceof Error ? error.message : String(error),
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
      const cachedResult: CacheResult<{
        user: User;
        roles: string[];
        hasCredentials: boolean;
      } | null> = await this.deps.cache.get(cacheKey);
      if (cachedResult.success && cachedResult.data) {
        this.deps.logger.debug("Auth user data cache hit", { userId });
        return cachedResult.data;
      }

      // Cache miss - query repository
      this.deps.logger.debug("Auth user data cache miss, querying repository", {
        userId,
      });

      const userData =
        await this.deps.userRepository.getAuthenticatedUserData(userId);
      if (!userData) {
        return null;
      }

      // Cache the result
      const cacheResult = await this.deps.cache.setex(
        cacheKey,
        this.CACHE_TTL,
        userData
      );
      if (!cacheResult.success) {
        this.deps.logger.warn("Failed to cache auth user data", {
          userId,
          error: cacheResult.error,
        });
      }

      this.deps.logger.debug("Auth user data cached", {
        userId,
        rolesCount: userData.roles.length,
      });

      return userData;
    } catch (error) {
      this.deps.logger.error("Failed to get authenticated user data", {
        userId,
        error: error instanceof Error ? error.message : String(error),
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
      this.deps.logger.debug("Auth user data cache invalidated", { userId });
    } else {
      this.deps.logger.warn("Failed to invalidate auth user data cache", {
        userId,
        error: result.error,
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
      this.deps.logger.info("Updating user level", { userId, newLevel: level });

      const success = await this.deps.userRepository.updateUserLevel(
        userId,
        level
      );

      if (success) {
        // Invalidate cached user data
        await this.invalidateUserDataCache(userId);

        // Log the change
        await this.logAuditEvent("USER_LEVEL_UPDATED", {
          userId,
          newLevel: level,
        });

        this.deps.logger.info("User level updated successfully", {
          userId,
          newLevel: level,
        });
      }

      return success;
    } catch (error) {
      this.deps.logger.error("User level update failed", {
        userId,
        newLevel: level,
        error: error instanceof Error ? error.message : String(error),
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
      this.deps.logger.error("Failed to get user by ID", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Verify wallet ownership for user registration (BASIC -> REGISTERED)
   *
   * Business Logic:
   * - Verify that a user owns a specific wallet address via signed message
   * - BASIC users: persist wallet address and upgrade to REGISTERED
   * - REGISTERED+ users: re-verify ownership against stored address (no level change)
   * - No Kodiak credentials required (wallet connect precedes Kodiak setup)
   */
  async verifyWalletOwnership(
    userId: string,
    walletAddress: string,
    signature: string,
    message: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.deps.logger.info("Wallet ownership verification requested", {
        userId,
        walletAddress,
      });

      // Verify the signature matches the wallet address using the signature verification service
      const signatureValid =
        await this.deps.signatureVerificationService.verifySignature(
          walletAddress,
          signature,
          message
        );

      if (!signatureValid) {
        this.deps.logger.warn(
          "Wallet signature verification failed - address mismatch",
          {
            userId,
            providedAddress: walletAddress,
          }
        );
        return {
          success: false,
          message: "Signature does not match the provided wallet address",
        };
      }

      const normalizedProvided = walletAddress.toLowerCase().trim();

      // Get the stored wallet address (if any)
      const storedWalletAddress =
        await this.deps.userRepository.getWalletAddress(userId);
      const normalizedStored = storedWalletAddress?.toLowerCase().trim();

      // If a wallet is already linked, the signature must match the linked address
      if (normalizedStored && normalizedProvided !== normalizedStored) {
        this.deps.logger.warn(
          "Wallet verification failed - address does not match linked wallet",
          {
            userId,
            providedAddress: walletAddress,
          }
        );
        return {
          success: false,
          message:
            "Wallet address does not match the wallet linked to your account",
        };
      }

      // Get current user to decide on level transition
      const currentUser = await this.deps.userRepository.findById(userId);
      if (!currentUser) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // First-time wallet link: persist the address
      if (!normalizedStored) {
        const persisted = await this.deps.userRepository.setWalletAddress(
          userId,
          normalizedProvided
        );
        if (!persisted) {
          this.deps.logger.error("Failed to persist wallet address", {
            userId,
          });
          return {
            success: false,
            message:
              "Wallet signature valid but failed to link wallet to account",
          };
        }
      }

      // BASIC users graduate to REGISTERED on wallet verification
      if (currentUser.userLevel === UserLevel.BASIC) {
        const success = await this.updateUserLevel(
          userId,
          UserLevel.REGISTERED
        );

        if (!success) {
          this.deps.logger.error("Failed to update user level to REGISTERED", {
            userId,
          });
          return {
            success: false,
            message:
              "Wallet verification succeeded but failed to update user level",
          };
        }

        await this.logAuditEvent("WALLET_VERIFIED", {
          userId,
          walletAddress: normalizedProvided,
          previousLevel: UserLevel.BASIC,
          newLevel: UserLevel.REGISTERED,
        });

        this.deps.logger.info(
          "Wallet ownership verified and user level updated to REGISTERED",
          {
            userId,
            walletAddress,
          }
        );

        return {
          success: true,
          message:
            "Wallet ownership verified. Your account has been upgraded to REGISTERED level.",
        };
      }

      // Already REGISTERED+: re-verification succeeds, no level change
      await this.logAuditEvent("WALLET_REVERIFIED", {
        userId,
        walletAddress: normalizedProvided,
      });

      return {
        success: true,
        message: "Wallet ownership verified.",
      };
    } catch (error) {
      this.deps.logger.error("Wallet ownership verification failed", {
        userId,
        walletAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: "Failed to verify wallet ownership",
      };
    }
  }

  /**
   * Unlink wallet from user account (REGISTERED -> BASIC)
   *
   * Business Logic:
   * - Removes the stored wallet address (proof of ownership is gone)
   * - Downgrades REGISTERED users back to BASIC with audit trail
   * - VERIFIED users keep their level only if they still hold Kodiak
   *   credentials; otherwise they drop to BASIC as well
   */
  async unlinkWallet(
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.deps.logger.info("Wallet unlink requested", { userId });

      const currentUser = await this.deps.userRepository.findById(userId);
      if (!currentUser) {
        return {
          success: false,
          message: "User not found",
        };
      }

      const removed = await this.deps.userRepository.clearWalletAddress(userId);
      if (!removed) {
        return {
          success: false,
          message: "No linked wallet found",
        };
      }

      if (currentUser.userLevel === UserLevel.REGISTERED) {
        await this.updateUserLevel(userId, UserLevel.BASIC);
      } else if (currentUser.userLevel === UserLevel.VERIFIED) {
        const authData =
          await this.deps.userRepository.getAuthenticatedUserData(userId);
        // Wallet gone but Kodiak remains -> back to REGISTERED;
        // neither -> BASIC
        await this.updateUserLevel(
          userId,
          authData?.hasCredentials ? UserLevel.REGISTERED : UserLevel.BASIC
        );
      }

      await this.logAuditEvent("WALLET_UNLINKED", {
        userId,
        previousLevel: currentUser.userLevel,
      });

      this.deps.logger.info("Wallet unlinked successfully", { userId });

      return {
        success: true,
        message: "Wallet unlinked from your account.",
      };
    } catch (error) {
      this.deps.logger.error("Wallet unlink failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: "Failed to unlink wallet",
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
  async verifyPassword(
    storedHash: string,
    plainPassword: string
  ): Promise<boolean> {
    try {
      return await this.deps.passwordService.verify(plainPassword, storedHash);
    } catch (error) {
      this.deps.logger.error("Password verification failed", {
        error: error instanceof Error ? error.message : String(error),
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
      this.deps.logger.error("Password hashing failed", {
        error: error instanceof Error ? error.message : String(error),
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
  async invalidateUserTokens(userId: string): Promise<{
    success: boolean;
    tokensBlacklisted?: number;
    errors?: string[];
  }> {
    try {
      this.deps.logger.info("Invalidating user tokens", { userId });

      // Invalidate the user data cache which will force re-authentication
      await this.invalidateUserDataCache(userId);

      // Log the token invalidation
      await this.logAuditEvent("USER_TOKENS_INVALIDATED", {
        userId,
        reason: "manual_invalidation",
      });

      return {
        success: true,
        tokensBlacklisted: 0, // Cache-based invalidation doesn't track individual tokens
      };
    } catch (error) {
      this.deps.logger.error("Token invalidation failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Logout - blacklist the presented tokens so they can no longer be used
   *
   * Business Logic:
   * - Verify each token to obtain its expiry (invalid/expired tokens are skipped)
   * - Blacklist the token hash in cache until its natural expiry
   * - Refresh tokens can no longer be used via refreshToken()
   * - Access tokens can no longer be used via validateToken()
   */
  async logout(
    refreshToken?: string,
    accessToken?: string
  ): Promise<{
    success: boolean;
    message?: string;
    tokensBlacklisted?: number;
  }> {
    try {
      let tokensBlacklisted = 0;

      if (refreshToken) {
        tokensBlacklisted += await this.blacklistToken(refreshToken, "refresh");
      }
      if (accessToken) {
        tokensBlacklisted += await this.blacklistToken(accessToken, "access");
      }

      this.deps.logger.info("User logged out", { tokensBlacklisted });
      await this.logAuditEvent("USER_LOGGED_OUT", { tokensBlacklisted });

      return {
        success: true,
        message: "Logged out successfully",
        tokensBlacklisted,
      };
    } catch (error) {
      this.deps.logger.error("Logout failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: "Logout failed" };
    }
  }

  /**
   * Blacklist a single token until its natural expiry
   * @returns 1 if the token was blacklisted, 0 if it was invalid/expired or blacklisting failed
   */
  private async blacklistToken(
    token: string,
    expectedType: TokenType
  ): Promise<number> {
    try {
      const payload = this.deps.tokenService.verifyToken(token, expectedType);
      if (!payload) {
        // Invalid or expired tokens don't need blacklisting
        return 0;
      }

      const hash = this.deps.tokenService.hashTokenForStorage(token);
      const ttl = this.remainingTtlSeconds(payload, expectedType);
      const result = await this.deps.cache.setex(
        `${this.JWT_BLACKLIST_PREFIX}${hash}`,
        ttl,
        "1"
      );
      return result?.success ? 1 : 0;
    } catch (error) {
      this.deps.logger.warn("Failed to blacklist token", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /** Remaining TTL (seconds) for the token, clamped to [60, type max TTL] */
  private remainingTtlSeconds(
    payload: TokenPayload,
    expectedType: TokenType
  ): number {
    const maxTtl =
      expectedType === "refresh"
        ? this.REFRESH_TOKEN_TTL
        : this.ACCESS_TOKEN_TTL;
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = (payload.exp ?? 0) - nowSec;
    return Math.min(Math.max(remaining, 60), maxTtl);
  }

  /** Check whether a token was previously blacklisted (logout / invalidation) */
  private async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const hash = this.deps.tokenService.hashTokenForStorage(token);
      const result = await this.deps.cache.get(
        `${this.JWT_BLACKLIST_PREFIX}${hash}`
      );
      return Boolean(result?.success && result.data);
    } catch (error) {
      // Fail open: a cache outage should not lock out every request
      this.deps.logger.debug(
        "Blacklist check failed, treating token as valid",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Generate JWT tokens for user
   */
  private async generateTokens(user: User): Promise<AuthTokens> {
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      userLevel: user.userLevel,
    };

    const accessToken = this.deps.tokenService.generateAccessToken(payload);
    const refreshToken = this.deps.tokenService.generateRefreshToken(payload);

    return {
      accessToken,
      refreshToken,
      expiresIn: 4 * 60 * 60, // 4 hours in seconds
    };
  }

  /**
   * Check if legacy API format should be returned
   *
   * Based on LEGACY_AUTH_API environment flag for backward compatibility
   * during gradual migration to pure services.
   */
  private shouldReturnLegacyFormat(): boolean {
    return process.env.LEGACY_AUTH_API === "true";
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
      tokens: result.tokens
        ? {
            accessToken: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            expiresIn: result.tokens.expiresIn,
          }
        : undefined,
    };
  }

  /**
   * Log audit event if audit logger is available
   */
  private async logAuditEvent(
    action: string,
    details: Record<string, unknown>
  ): Promise<void> {
    if (this.deps.auditLogger) {
      try {
        await this.deps.auditLogger.logEvent({
          userId: (details.userId as string) || null, // Allow null instead of 'system'
          action,
          details,
          ipAddress: undefined,
          userAgent: undefined,
        });
      } catch (error) {
        this.deps.logger.warn("Failed to log audit event", {
          action,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

// Export factory function for creating service instances
export function createAuthService(deps: AuthServiceDependencies): AuthService {
  return new AuthService(deps);
}
