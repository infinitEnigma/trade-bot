/**
 * User Profile Service
 *
 * Handles user profile operations including retrieval, updates, and validation.
 * Provides centralized profile management with proper validation and auditing.
 */

import { query } from "../../database/pool";
import { selectAuthService } from "../service-selector";
import { redisService } from "../../infrastructure";
import { logger } from "../../core/logging";

const authService = selectAuthService();

export interface ProfileUpdateData {
    email?: string;
    currentPassword?: string;
    newPassword?: string;
}

export interface ProfileUpdateResult {
    success: boolean;
    message: string;
    data?: {
        email?: string;
        updatedAt: string;
    };
    error?: string;
}

export interface UserProfile {
    id: string;
    email: string;
    userLevel: string;
    roles: string[];
    hasKodiak: boolean;
    kodiakStatus: {
        accountId: string;
        verified: boolean;
    } | null;
}

export interface UserSettings {
    theme: 'light' | 'dark';
    language: string;
    timezone: string;
    notifications: boolean;
    twoFactorEnabled: boolean;
}

/**
 * User Profile Service
 */
export class UserProfileService {
    private readonly CACHE_TTL = 300; // 5 minutes for user profiles

    /**
     * Get comprehensive user profile information with optimized single query and caching
     */
    async getUserProfile(userId: string): Promise<UserProfile> {
        const cacheKey = `user:profile:${userId}`;

        // Check Redis cache first for performance
        try {
            const cachedResult = await redisService.get(cacheKey);
            if (cachedResult.success && cachedResult.data) {
                logger.debug("User profile retrieved from cache", { userId });
                return JSON.parse(cachedResult.data);
            }
        } catch (cacheError) {
            logger.warn("Failed to read from cache, falling back to database", {
                userId,
                error: (cacheError as Error).message,
            });
        }

        // Single optimized query with LEFT JOIN to eliminate N+1 problem
        const result = await query<{
            id: string;
            email: string;
            user_level: string;
            user_created_at: string;
            account_id: string | null;
            verified: boolean | null;
            kodiak_connected_at: string | null;
        }>(`
      SELECT
        u.id,
        u.email,
        u.user_level,
        u.created_at as user_created_at,
        kc.account_id,
        kc.verified,
        kc.created_at as kodiak_connected_at
      FROM users u
      LEFT JOIN kodiak_credentials kc ON u.id = kc.user_id
      WHERE u.id = $1
    `, [userId]);

        if (result.rows.length === 0) {
            throw new Error('User not found');
        }

        const row = result.rows[0];
        const hasKodiak = !!row.account_id;
        const kodiakStatus = hasKodiak
            ? {
                accountId: row.account_id ?? '', // Provide empty string default if null
                verified: row.verified ?? false, // Provide false default if null
            }
            : null;

        const profile: UserProfile = {
            id: row.id,
            email: row.email,
            userLevel: row.user_level,
            roles: [], // TODO: Implement role retrieval from auth middleware
            hasKodiak,
            kodiakStatus,
        };

        // Cache the profile for future requests
        try {
            await redisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(profile));
            logger.debug("User profile cached", { userId, ttl: this.CACHE_TTL });
        } catch (cacheError) {
            logger.warn("Failed to cache user profile", {
                userId,
                error: (cacheError as Error).message,
            });
        }

        logger.debug("User profile retrieved with optimized query", {
            userId: row.id,
            hasKodiak,
            cached: false,
        });

        return profile;
    }

    /**
     * Verify wallet ownership for user verification
     */
    async verifyWalletOwnership(
        userId: string,
        walletAddress: string,
        signature: string,
        message: string
    ): Promise<{ success: boolean; message: string }> {
        try {
            return await authService.verifyWalletOwnership(
                userId,
                walletAddress,
                signature,
                message
            );
        } catch (error) {
            logger.error("Wallet verification error", {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });

            return {
                success: false,
                message: "Failed to verify wallet ownership",
            };
        }
    }

    /**
     * Update user profile with validation (simplified)
     */
    async updateUserProfile(userId: string, updateData: ProfileUpdateData): Promise<ProfileUpdateResult> {
        try {
            const { email } = updateData;

            // Only support email changes for now (password change not implemented in pure service)
            if (!email) {
                return {
                    success: false,
                    message: "Only email updates are currently supported",
                    error: "Only email updates are currently supported",
                };
            }

            // Check if email is actually changing
            const currentEmail = await this.getCurrentEmail(userId);
            if (email.toLowerCase() === currentEmail.toLowerCase()) {
                return {
                    success: false,
                    message: "No changes detected",
                    error: "No changes detected",
                };
            }

            // Check for email conflicts
            const emailAvailable = await this.checkEmailAvailability(email, userId);
            if (!emailAvailable) {
                return {
                    success: false,
                    message: "Email address is already in use",
                    error: "Email address is already in use",
                };
            }

            // Perform the email update
            const updateResult = await this.executeProfileUpdate(userId, { email });

            // Clear cache after successful update
            await this.invalidateUserProfileCache(userId);

            // Log the profile update
            await this.logProfileUpdate(userId, ["email"]);

            logger.info("Profile updated successfully", {
                userId,
                changes: ["email"],
                cacheInvalidated: true,
            });

            return {
                success: true,
                message: "Profile updated successfully",
                data: {
                    email: updateResult.email,
                    updatedAt: updateResult.updatedAt,
                },
            };

        } catch (error) {
            logger.error("Profile update error", {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });

            return {
                success: false,
                message: "Failed to update profile",
                error: "Failed to update profile",
            };
        }
    }



    /**
     * Get current user email
     */
    private async getCurrentEmail(userId: string): Promise<string> {
        const result = await query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        return result.rows[0].email;
    }



    /**
     * Check if email is available for use
     */
    private async checkEmailAvailability(email: string, excludeUserId: string): Promise<boolean> {
        const existingUser = await query(
            "SELECT id FROM users WHERE email = $1 AND id != $2",
            [email.toLowerCase(), excludeUserId]
        );

        return existingUser.rows.length === 0;
    }

    /**
     * Execute the profile update in database
     */
    private async executeProfileUpdate(
        userId: string,
        changes: { email?: string }
    ): Promise<{ email: string; updatedAt: string }> {
        // Execute email update
        const emailToSet = changes.email ? changes.email.toLowerCase() : '';
        const updateResult = await query<{ id: string; email: string }>(`
            UPDATE users
            SET email = $1, updated_at = $2
            WHERE id = $3
            RETURNING id, email
        `, [emailToSet, new Date(), userId]);

        if (updateResult.rows.length === 0) {
            throw new Error('User not found');
        }

        return {
            email: updateResult.rows[0].email,
            updatedAt: new Date().toISOString(),
        };
    }

    /**
     * Log profile update for audit trail
     */
    private async logProfileUpdate(userId: string, changes: string[]): Promise<void> {
        await query(
            "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
            [userId, "PROFILE_UPDATED", { changes }]
        );
    }

    /**
     * Invalidate user profile cache after updates
     */
    private async invalidateUserProfileCache(userId: string): Promise<void> {
        const cacheKey = `user:profile:${userId}`;
        try {
            await redisService.del(cacheKey);
            logger.debug("User profile cache invalidated", { userId });
        } catch (error) {
            logger.warn("Failed to invalidate user profile cache", {
                userId,
                error: (error as Error).message,
            });
        }
    }
}

// Export singleton instance
export const userProfileService = new UserProfileService();
