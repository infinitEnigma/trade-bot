/**
 * JWT Token Adapter - Clean Architecture Implementation
 *
 * Adapter that implements ITokenService interface using jsonwebtoken library.
 * This adapter provides a clean abstraction layer for JWT token operations,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import {
  ITokenService,
  TokenPayload,
  TokenType,
  TokenValidationUserLookup,
} from "@trade-bot/shared";

/**
 * JWT Token Adapter
 *
 * Implements the ITokenService interface using the jsonwebtoken library.
 * Provides JWT token generation, verification, and utility functions.
 */
export class JwtTokenAdapter implements ITokenService {
  private readonly JWT_SECRET: string;
  private readonly JWT_REFRESH_SECRET: string;
  private readonly ACCESS_TOKEN_EXPIRY = "4h";
  private readonly REFRESH_TOKEN_EXPIRY = "30d";

  constructor() {
    // Initialize secrets with validation
    this.JWT_SECRET = this.getJwtSecret();
    this.JWT_REFRESH_SECRET = this.getJwtRefreshSecret();
  }

  /**
   * Generate access token
   *
   * Embeds a `type: 'access'` claim so the token can only be verified on the access path.
   */
  generateAccessToken(payload: TokenPayload): string {
    try {
      return jwt.sign(
        { ...payload, type: "access" as const },
        this.JWT_SECRET,
        {
          expiresIn: this.ACCESS_TOKEN_EXPIRY,
        }
      );
    } catch (error) {
      throw new Error(
        `Failed to generate access token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate refresh token
   *
   * Embeds a `type: 'refresh'` claim so the token can only be verified on the refresh path.
   */
  generateRefreshToken(payload: TokenPayload): string {
    try {
      return jwt.sign(
        { ...payload, type: "refresh" as const },
        this.JWT_REFRESH_SECRET,
        {
          expiresIn: this.REFRESH_TOKEN_EXPIRY,
        }
      );
    } catch (error) {
      throw new Error(
        `Failed to generate refresh token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Verify and decode token
   *
   * Verifies the token against the secret that matches the expected token type
   * and enforces the `type` claim. Tokens signed with the other secret, or
   * carrying the wrong `type` claim, are rejected.
   *
   * @param token - JWT token to verify
   * @param expectedType - Which token type is acceptable at this call site (default: 'access')
   * @returns TokenPayload if valid and of the expected type; null otherwise
   */
  verifyToken(
    token: string,
    expectedType: TokenType = "access"
  ): TokenPayload | null {
    try {
      const secret =
        expectedType === "refresh" ? this.JWT_REFRESH_SECRET : this.JWT_SECRET;
      const payload = jwt.verify(token, secret) as TokenPayload;

      // Enforce the type claim: a refresh token must never authenticate as an
      // access token (and vice versa), even if both secrets were ever leaked.
      if (payload?.type !== expectedType) {
        return null;
      }

      return payload;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Verify token with database validation
   *
   * This method verifies the token and checks if the user still exists in the database.
   * If the user doesn't exist (e.g., after database reset), the token is considered invalid.
   *
   * @param token - JWT token to verify
   * @param authService - Auth service instance to check user existence
   * @returns TokenPayload if valid and user exists, null otherwise
   */
  async verifyTokenWithDatabaseValidation(
    token: string,
    authService: TokenValidationUserLookup
  ): Promise<TokenPayload | null> {
    try {
      const payload = this.verifyToken(token, "access");
      if (!payload) {
        return null;
      }

      // Check if user still exists in database (handles database resets)
      const user = await authService.getUserById(payload.userId);
      if (!user) {
        return null; // User doesn't exist anymore (e.g., after DB reset)
      }

      // Update payload with current user level from database (not from token)
      return {
        ...payload,
        userLevel: user.userLevel, // Use current database value, not token's stored value
      };
    } catch (_error) {
      return null;
    }
  }

  /**
   * Hash token for storage
   *
   * Creates a short hash of the token for use as a storage key.
   * Not cryptographically secure - just for key length management.
   */
  hashTokenForStorage(token: string): string {
    try {
      if (!token || token.trim() === "") {
        throw new Error("Token cannot be empty");
      }
      return createHash("sha256").update(token).digest("hex").substring(0, 16); // First 16 characters for reasonable key length
    } catch (error) {
      throw new Error(
        `Failed to hash token for storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate JWT secret environment variable
   */
  private getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is required");
    }
    if (process.env.NODE_ENV === "production" && secret.length < 32) {
      throw new Error(
        "JWT_SECRET must be at least 32 characters in production"
      );
    }
    return secret;
  }

  /**
   * Validate JWT refresh secret environment variable
   */
  private getJwtRefreshSecret(): string {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
      throw new Error("JWT_REFRESH_SECRET environment variable is required");
    }
    if (process.env.NODE_ENV === "production" && secret.length < 32) {
      throw new Error(
        "JWT_REFRESH_SECRET must be at least 32 characters in production"
      );
    }
    return secret;
  }

  /**
   * Get token expiry information for debugging/testing
   */
  getTokenExpiryInfo(): {
    accessTokenExpiry: string;
    refreshTokenExpiry: string;
  } {
    return {
      accessTokenExpiry: this.ACCESS_TOKEN_EXPIRY,
      refreshTokenExpiry: this.REFRESH_TOKEN_EXPIRY,
    };
  }

  /**
   * Decode token without verification (for debugging)
   * WARNING: Only use for debugging - does not verify signature
   */
  decodeTokenUnsafe(token: string): TokenPayload | null {
    try {
      return jwt.decode(token) as TokenPayload | null;
    } catch (_error) {
      return null;
    }
  }
}

// Export singleton instance
export const jwtTokenAdapter = new JwtTokenAdapter();
