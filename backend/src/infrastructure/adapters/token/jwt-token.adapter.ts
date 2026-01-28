/**
 * JWT Token Adapter - Clean Architecture Implementation
 *
 * Adapter that implements ITokenService interface using jsonwebtoken library.
 * This adapter provides a clean abstraction layer for JWT token operations,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { ITokenService, TokenPayload } from '@trade-bot/shared';

/**
 * JWT Token Adapter
 *
 * Implements the ITokenService interface using the jsonwebtoken library.
 * Provides JWT token generation, verification, and utility functions.
 */
export class JwtTokenAdapter implements ITokenService {
    private readonly JWT_SECRET: string;
    private readonly JWT_REFRESH_SECRET: string;
    private readonly ACCESS_TOKEN_EXPIRY = '4h';
    private readonly REFRESH_TOKEN_EXPIRY = '30d';

    constructor() {
        // Initialize secrets with validation
        this.JWT_SECRET = this.getJwtSecret();
        this.JWT_REFRESH_SECRET = this.getJwtRefreshSecret();
    }

    /**
     * Generate access token
     */
    generateAccessToken(payload: TokenPayload): string {
        try {
            return jwt.sign(payload, this.JWT_SECRET, {
                expiresIn: this.ACCESS_TOKEN_EXPIRY
            });
        } catch (error) {
            throw new Error(`Failed to generate access token: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Generate refresh token
     */
    generateRefreshToken(payload: TokenPayload): string {
        try {
            return jwt.sign(payload, this.JWT_REFRESH_SECRET, {
                expiresIn: this.REFRESH_TOKEN_EXPIRY
            });
        } catch (error) {
            throw new Error(`Failed to generate refresh token: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Verify and decode token
     *
     * This method tries both access and refresh token secrets to verify the token.
     * Returns null if token is invalid or expired.
     */
    verifyToken(token: string): TokenPayload | null {
        try {
            // Try to verify as access token first
            try {
                return jwt.verify(token, this.JWT_SECRET) as TokenPayload;
            } catch (_accessTokenError) {
                // If access token verification fails, try refresh token
                try {
                    return jwt.verify(token, this.JWT_REFRESH_SECRET) as TokenPayload;
                } catch (_refreshTokenError) {
                    // Both verifications failed
                    return null;
                }
            }
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
        authService: any
    ): Promise<TokenPayload | null> {
        try {
            const payload = this.verifyToken(token);
            if (!payload) {
                return null;
            }

            // Check if user still exists in database (handles database resets)
            const userExists = await authService.getUserById(payload.userId);
            if (!userExists) {
                return null; // User doesn't exist anymore (e.g., after DB reset)
            }

            return payload;
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
            return createHash('sha256')
                .update(token)
                .digest('hex')
                .substring(0, 16); // First 16 characters for reasonable key length
        } catch (error) {
            throw new Error(`Failed to hash token for storage: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Validate JWT secret environment variable
     */
    private getJwtSecret(): string {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET environment variable is required');
        }
        if (process.env.NODE_ENV === 'production' && secret.length < 32) {
            throw new Error('JWT_SECRET must be at least 32 characters in production');
        }
        return secret;
    }

    /**
     * Validate JWT refresh secret environment variable
     */
    private getJwtRefreshSecret(): string {
        const secret = process.env.JWT_REFRESH_SECRET;
        if (!secret) {
            throw new Error('JWT_REFRESH_SECRET environment variable is required');
        }
        if (process.env.NODE_ENV === 'production' && secret.length < 32) {
            throw new Error('JWT_REFRESH_SECRET must be at least 32 characters in production');
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
            refreshTokenExpiry: this.REFRESH_TOKEN_EXPIRY
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