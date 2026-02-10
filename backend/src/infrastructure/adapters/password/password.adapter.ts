/**
 * Password Service Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IPasswordService interface using the existing password worker.
 * This adapter provides a clean abstraction layer for password operations,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { IPasswordService } from '@trade-bot/shared';
import { hashPassword, comparePassword } from '../../../workers/password-worker';
import { securityLogger as logger } from '../../../core/logging/context-aware-logger.service';

/**
 * Password Service Adapter
 *
 * Implements the IPasswordService interface using the existing worker thread-based
 * password hashing system. Provides secure, non-blocking password operations.
 */
export class PasswordAdapter implements IPasswordService {

    /**
     * Hash a password using bcrypt with worker threads (non-blocking)
     *
     * @param password - Plain text password to hash
     * @param rounds - Number of bcrypt rounds (default: 12)
     * @returns Promise<string> - Hashed password
     */
    async hash(password: string, rounds: number = 12): Promise<string> {
        try {
            if (!password || password.length === 0) {
                throw new Error('Password cannot be empty');
            }

            if (rounds < 8 || rounds > 20) {
                throw new Error('Bcrypt rounds must be between 8 and 20');
            }

            return await hashPassword(password, rounds);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Password hashing failed: ${errorMessage}`);
        }
    }

    /**
     * Verify a password against its hash using bcrypt with worker threads (non-blocking)
     *
     * @param password - Plain text password to verify
     * @param hash - Hashed password to compare against
     * @returns Promise<boolean> - True if password matches hash
     */
    async verify(password: string, hash: string): Promise<boolean> {
        try {
            if (!password || password.length === 0) {
                return false;
            }

            if (!hash || hash.length === 0) {
                return false;
            }

            return await comparePassword(password, hash);
        } catch (error) {
            // For security, verification errors should return false
            // rather than throwing exceptions that could leak information
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Password verification error: ${errorMessage}`, error as Error);
            return false;
        }
    }

    /**
     * Get recommended bcrypt rounds for current security requirements
     *
     * @returns number - Recommended number of bcrypt rounds
     */
    getRecommendedRounds(): number {
        // Adjust based on environment and performance requirements
        if (process.env.NODE_ENV === 'test') {
            return 8; // Faster for tests
        }

        // For production, use higher rounds for better security
        // bcrypt rounds double computation time per round
        // 12 rounds = ~1 second on modern hardware
        return 12;
    }

    /**
     * Validate password strength (basic validation)
     *
     * @param password - Password to validate
     * @returns { valid: boolean, errors: string[] } - Validation result
     */
    validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!password || password.length < 8) {
            errors.push('Password must be at least 8 characters long');
        }

        if (!/[A-Z]/.test(password)) {
            errors.push('Password must contain at least one uppercase letter');
        }

        if (!/[a-z]/.test(password)) {
            errors.push('Password must contain at least one lowercase letter');
        }

        if (!/\d/.test(password)) {
            errors.push('Password must contain at least one number');
        }

        // Optional: Check for special characters
        // if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        //     errors.push('Password must contain at least one special character');
        // }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Export singleton instance
export const passwordAdapter = new PasswordAdapter();