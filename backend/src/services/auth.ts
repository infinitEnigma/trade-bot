/** @format */

import "dotenv/config";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { UserLevel } from "@trade-bot/shared";
import { pool } from "../database";
import { redisService } from "./redis";
import logger from "./logger";

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable required");
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("JWT_SECRET must be 32+ characters in production");
  }
  return secret;
})();

const JWT_REFRESH_SECRET = (() => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret)
    throw new Error("JWT_REFRESH_SECRET environment variable required");
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("JWT_REFRESH_SECRET must be 32+ characters in production");
  }
  return secret;
})();
const ACCESS_TOKEN_EXPIRY = "4h"; // Increased from 1h to 4h
const REFRESH_TOKEN_EXPIRY = "30d"; // Increased from 7d to 30d

export interface TokenPayload {
  userId: string;
  email: string;
  userLevel: UserLevel;
  exp?: number;
  iat?: number;
}

export interface AuthResult {
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

export class AuthService {
  async register(email: string, password: string): Promise<AuthResult> {
    try {
      const existingUser = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );
      if (existingUser.rows.length > 0) {
        return { success: false, message: "Email already registered" };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        "INSERT INTO users (email, password_hash, user_level) VALUES ($1, $2, $3) RETURNING id, email, user_level",
        [email, passwordHash, UserLevel.BASIC]
      );

      const user = result.rows[0];
      const tokens = this.generateTokens(user);

      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [user.id, "USER_REGISTERED", { email: user.email }]
      );

      return {
        success: true,
        user: { id: user.id, email: user.email, userLevel: user.user_level },
        tokens,
      };
    } catch (error) {
      logger.error("Registration error", {
        error: error instanceof Error ? error.message : String(error),
        email,
      });
      return { success: false, message: "Registration failed" };
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const result = await pool.query(
        "SELECT id, email, password_hash, user_level FROM users WHERE email = $1",
        [email]
      );

      if (result.rows.length === 0) {
        return { success: false, message: "Invalid credentials" };
      }

      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        return { success: false, message: "Invalid credentials" };
      }

      const tokens = this.generateTokens(user);

      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [user.id, "USER_LOGIN", { email: user.email }]
      );

      return {
        success: true,
        user: { id: user.id, email: user.email, userLevel: user.user_level },
        tokens,
      };
    } catch (error) {
      logger.error("Login error", {
        error: error instanceof Error ? error.message : String(error),
        email,
      });
      return { success: false, message: "Login failed" };
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      // First check if token is blacklisted
      const isBlacklisted = await this.isRefreshTokenBlacklisted(refreshToken);
      if (isBlacklisted) {
        logger.warn("Attempted to use blacklisted refresh token", {
          tokenHash: this.hashTokenForStorage(refreshToken),
        });
        return { success: false, message: "Token has been invalidated" };
      }

      let decoded: TokenPayload;
      try {
        decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as TokenPayload;
      } catch (jwtError) {
        // JWT verification failed - could be malformed or tampered
        logger.warn("Refresh token JWT verification failed", {
          error: jwtError instanceof Error ? jwtError.message : String(jwtError),
        });
        // Blacklist malformed tokens to prevent replay attacks
        await this.blacklistRefreshToken(refreshToken, 3600); // 1 hour blacklist for malformed tokens
        return { success: false, message: "Invalid refresh token" };
      }

      // Additional TTL validation
      const now = Math.floor(Date.now() / 1000);
      const tokenExp = decoded.exp;
      if (tokenExp && tokenExp < now) {
        logger.warn("Refresh token TTL expired - blacklisting", {
          userId: decoded.userId,
          tokenExp: new Date(tokenExp * 1000).toISOString(),
        });
        // CRITICAL: Blacklist expired tokens to prevent replay attacks
        await this.blacklistRefreshToken(refreshToken, 86400); // 24 hour blacklist for expired tokens
        return { success: false, message: "Refresh token expired" };
      }

      const result = await pool.query(
        "SELECT id, email, user_level FROM users WHERE id = $1",
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        logger.warn("Refresh token for non-existent user - blacklisting", {
          userId: decoded.userId,
        });
        // Blacklist tokens for deleted users
        await this.blacklistRefreshToken(refreshToken, 86400);
        return { success: false, message: "User not found" };
      }

      const user = result.rows[0];
      const tokens = this.generateTokens(user);

      return {
        success: true,
        user: { id: user.id, email: user.email, userLevel: user.user_level },
        tokens,
      };
    } catch (error) {
      logger.error("Refresh token validation error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: "Invalid refresh token" };
    }
  }

  async validateToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  async getUserById(
    userId: string
  ): Promise<{ id: string; email: string; userLevel: UserLevel } | null> {
    try {
      const result = await pool.query(
        "SELECT id, email, user_level FROM users WHERE id = $1",
        [userId]
      );

      if (result.rows.length === 0) return null;

      const user = result.rows[0];
      return { id: user.id, email: user.email, userLevel: user.user_level };
    } catch {
      return null;
    }
  }

  /**
   * Get complete authenticated user data in a single optimized query
   * Solves N+1 query problem by JOINing user + roles + credentials
   * Includes Redis caching for high-frequency auth middleware calls
   */
  async getAuthenticatedUserData(
    userId: string
  ): Promise<{
    user: { id: string; email: string; userLevel: UserLevel };
    roles: string[];
    hasCredentials: boolean;
  } | null> {
    const cacheKey = `auth:user:${userId}`;

    try {
      // Try Redis cache first (5 minute TTL for auth data)
      const cacheResult = await redisService.get(cacheKey);
      if (cacheResult.success && cacheResult.data) {
        const cachedData = JSON.parse(cacheResult.data);
        logger.debug("Authenticated user data cache hit", { userId });
        return cachedData;
      } else if (!cacheResult.success) {
        logger.warn("Auth user data cache read failed", {
          userId,
          error: cacheResult.error,
        });
      }

      logger.debug("Auth user data cache miss, querying database", { userId });

      // Single optimized query with JOINs
      const result = await pool.query(`
        SELECT
          u.id,
          u.email,
          u.user_level,
          COALESCE(
            JSON_AGG(
              DISTINCT ur.role
              ORDER BY ur.role
            ) FILTER (WHERE ur.role IS NOT NULL),
            '[]'::json
          ) as roles,
          CASE WHEN kc.id IS NOT NULL THEN true ELSE false END as has_credentials
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN kodiak_credentials kc ON u.id = kc.user_id AND kc.verified = true
        WHERE u.id = $1
        GROUP BY u.id, u.email, u.user_level, kc.id
      `, [userId]);

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      const userData = {
        user: {
          id: row.id,
          email: row.email,
          userLevel: row.user_level,
        },
        roles: row.roles || [],
        hasCredentials: row.has_credentials || false,
      };

      // Cache the result for 5 minutes (frequent auth middleware calls)
      const cacheSuccess = await redisService.setex(cacheKey, 300, JSON.stringify(userData));
      if (!cacheSuccess.success) {
        logger.warn("Failed to cache auth user data", {
          userId,
          error: cacheSuccess.error,
        });
      }

      logger.debug("Cached auth user data", { userId, rolesCount: userData.roles.length });
      return userData;

    } catch (error) {
      logger.error("Failed to get authenticated user data", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Invalidate cached user data (call when user data changes)
   */
  async invalidateUserDataCache(userId: string): Promise<void> {
    const cacheKey = `auth:user:${userId}`;
    try {
      await redisService.del(cacheKey);
      logger.debug("Invalidated auth user data cache", { userId });
    } catch (error) {
      logger.warn("Failed to invalidate auth user data cache", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async updateUserLevel(userId: string, level: UserLevel): Promise<boolean> {
    try {
      await pool.query(
        "UPDATE users SET user_level = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [level, userId]
      );
      return true;
    } catch {
      return false;
    }
  }

  async verifyWalletOwnership(
    userId: string,
    walletAddress: string,
    signature: string,
    message: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      // Verify the signature matches the wallet address
      const { ethers } = await import("ethers");

      // Recover the address from the signature
      const recoveredAddress = ethers.verifyMessage(message, signature);

      // Check if the recovered address matches the expected wallet address
      if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return {
          success: false,
          message: "Signature verification failed - address mismatch",
        };
      }

      // Check if user has Kodiak credentials with matching wallet address
      const credentialsResult = await pool.query(
        "SELECT wallet_address FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
        [userId]
      );

      if (credentialsResult.rows.length === 0) {
        return {
          success: false,
          message: "No verified Kodiak credentials found",
        };
      }

      const kodiakWalletAddress = credentialsResult.rows[0].wallet_address;
      if (
        !kodiakWalletAddress ||
        kodiakWalletAddress.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        return {
          success: false,
          message: "Wallet address does not match Kodiak account",
        };
      }

      // Update user level to VERIFIED
      const updateSuccess = await this.updateUserLevel(
        userId,
        UserLevel.VERIFIED
      );

      if (!updateSuccess) {
        return {
          success: false,
          message: "Failed to update user verification status",
        };
      }

      // Log the verification
      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [
          userId,
          "WALLET_VERIFIED",
          {
            walletAddress,
            kodiakWalletAddress,
          },
        ]
      );

      return { success: true };
    } catch (error) {
      logger.error("Wallet verification error", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        walletAddress,
      });
      return {
        success: false,
        message: "Wallet verification failed",
      };
    }
  }

  async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, 12);
  }

  async verifyPassword(user: { password_hash: string }, password: string): Promise<boolean> {
    return await bcrypt.compare(password, user.password_hash);
  }

  // Token blacklist methods
  async isRefreshTokenBlacklisted(refreshToken: string): Promise<boolean> {
    try {
      const tokenHash = this.hashTokenForStorage(refreshToken);
      const result = await redisService.exists(`blacklist:refresh:${tokenHash}`);
      return result.success && result.data;
    } catch (error) {
      logger.error("Error checking refresh token blacklist", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false; // Fail open - allow token if Redis is down
    }
  }

  async blacklistRefreshToken(refreshToken: string, ttlSeconds?: number): Promise<boolean> {
    try {
      const tokenHash = this.hashTokenForStorage(refreshToken);
      // Default TTL is 30 days to match refresh token expiry
      const ttl = ttlSeconds || (30 * 24 * 60 * 60);
      const result = await redisService.setex(`blacklist:refresh:${tokenHash}`, ttl, "1");
      return result.success;
    } catch (error) {
      logger.error("Error blacklisting refresh token", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async invalidateUserTokens(userId: string): Promise<{ success: boolean; tokensBlacklisted: number; errors: string[] }> {
    try {
      logger.warn("Invalidating all tokens for user - SECURITY EVENT", { userId });

      const errors: string[] = [];
      let tokensBlacklisted = 0;

      // Get user's email for token identification
      const userResult = await pool.query(
        "SELECT email FROM users WHERE id = $1",
        [userId]
      );

      if (userResult.rows.length === 0) {
        return {
          success: false,
          tokensBlacklisted: 0,
          errors: ["User not found"]
        };
      }

      const userEmail = userResult.rows[0].email;

      // Generate a family blacklist pattern
      // This creates a special marker that indicates all tokens for this user should be rejected
      const familyBlacklistKey = `blacklist:family:${userId}`;
      const blacklistSuccess = await redisService.setex(
        familyBlacklistKey,
        30 * 24 * 60 * 60, // 30 days - matches refresh token expiry
        JSON.stringify({
          userId,
          email: userEmail,
          blacklistedAt: new Date().toISOString(),
          reason: "security_invalidated"
        })
      );

      if (blacklistSuccess.success) {
        tokensBlacklisted = 1; // Family marker counts as 1
        logger.info("User token family blacklisted", { userId, familyKey: familyBlacklistKey });
      } else {
        errors.push("Failed to create family blacklist marker");
      }

      // Log the security event
      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [userId, "TOKENS_INVALIDATED", {
          reason: "security",
          familyBlacklisted: blacklistSuccess.success,
          timestamp: new Date().toISOString()
        }]
      );

      return {
        success: errors.length === 0,
        tokensBlacklisted,
        errors
      };
    } catch (error) {
      logger.error("Error invalidating user tokens", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return {
        success: false,
        tokensBlacklisted: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Check if user token family is blacklisted
   */
  async isUserTokenFamilyBlacklisted(userId: string): Promise<boolean> {
    try {
      const familyBlacklistKey = `blacklist:family:${userId}`;
      const result = await redisService.get(familyBlacklistKey);
      return result.success && !!result.data;
    } catch (error) {
      logger.error("Error checking user token family blacklist", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return false; // Fail open - allow token if Redis is down
    }
  }

  /**
   * Get blacklist statistics for monitoring
   */
  async getBlacklistStats(): Promise<{
    individualTokens: number;
    familyBlacklists: number;
    totalBlacklisted: number;
  }> {
    try {
      // Count individual token blacklists (approximate)
      const individualPattern = "blacklist:refresh:*";
      // Note: Redis SCAN would be needed for accurate counting in production

      // Count family blacklists
      const familyPattern = "blacklist:family:*";
      // Note: Redis SCAN would be needed for accurate counting in production

      // For now, return placeholder stats
      // In production, implement proper Redis key counting
      return {
        individualTokens: 0, // Would use Redis SCAN
        familyBlacklists: 0,  // Would use Redis SCAN
        totalBlacklisted: 0,
      };
    } catch (error) {
      logger.error("Error getting blacklist stats", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        individualTokens: 0,
        familyBlacklists: 0,
        totalBlacklisted: 0,
      };
    }
  }

  private hashTokenForStorage(token: string): string {
    // Use a simple hash for storage key (not for security, just for key length)
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
  }

  private generateTokens(user: {
    id: string;
    email: string;
    user_level: UserLevel;
  }) {
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      userLevel: user.user_level,
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    });

    const expiresIn = 4 * 60 * 60; // 4 hours in seconds

    return { accessToken, refreshToken, expiresIn };
  }
}

export const authService = new AuthService();
