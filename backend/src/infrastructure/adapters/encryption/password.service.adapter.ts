/**
 * ===========================================
 * 🔐 PASSWORD SERVICE ADAPTER
 * ===========================================
 *
 * Adapter that implements IPasswordService interface using bcrypt.
 * Provides password hashing and verification services for user authentication.
 *
 * @format
 */

import bcrypt from "bcryptjs";
import { IPasswordService } from "@trade-bot/shared";

/**
 * Password Service Adapter
 *
 * Implements the IPasswordService interface using bcrypt for secure password hashing.
 * Provides password hashing and verification with configurable rounds.
 */
export class PasswordServiceAdapter implements IPasswordService {
    private readonly DEFAULT_ROUNDS = 12;

    /**
     * Hash a password using bcrypt
     */
    async hash(password: string, rounds: number = this.DEFAULT_ROUNDS): Promise<string> {
        try {
            return await bcrypt.hash(password, rounds);
        } catch (error) {
            throw new Error(`Failed to hash password: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Verify a password against its hash
     */
    async verify(password: string, hash: string): Promise<boolean> {
        try {
            return await bcrypt.compare(password, hash);
        } catch (error) {
            throw new Error(`Failed to verify password: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// Export singleton instance
export const passwordService = new PasswordServiceAdapter();