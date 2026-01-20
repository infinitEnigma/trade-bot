/**
 * User Profile Service
 *
 * Handles user profile operations including retrieval, updates, and validation.
 * Provides centralized profile management with proper validation and auditing.
 */

import { query } from "../../database/pool";
import { authService } from "../auth";
import { redisService } from "../../infrastructure";
import { logger } from "../../core/logging";

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
        const result = await query(`
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
                accountId: row.account_id,
                verified: row.verified,
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
     * Update user profile with validation
     */
    async updateUserProfile(userId: string, updateData: ProfileUpdateData): Promise<ProfileUpdateResult> {
        try {
            const { email, currentPassword, newPassword } = updateData;

            // Check if there are any changes to make
            const hasEmailChange = email && email.toLowerCase() !== (await this.getCurrentEmail(userId)).toLowerCase();
            const hasPasswordChange = !!newPassword;

            if (!hasEmailChange && !hasPasswordChange) {
                return {
                    success: false,
                    message: "No changes detected",
                    error: "No changes detected",
                };
            }

            // Get current user data for validation
            const currentUser = await authService.getUserById(userId);
            if (!currentUser) {
                return {
                    success: false,
                    message: "User not found",
                    error: "User not found",
                };
            }

            // Validate current password if changing password
            if (hasPasswordChange) {
                const passwordValid = await this.validateCurrentPassword(userId, currentPassword);
                if (!passwordValid) {
                    return {
                        success: false,
                        message: "Current password is incorrect",
                        error: "Current password is incorrect",
                    };
                }
            }

            // Check for email conflicts if email is being changed
            if (hasEmailChange) {
                const emailAvailable = await this.checkEmailAvailability(email!, userId);
                if (!emailAvailable) {
                    return {
                        success: false,
                        message: "Email address is already in use",
                        error: "Email address is already in use",
                    };
                }
            }

            // Perform the update
            const updateResult = await this.executeProfileUpdate(userId, {
                email: hasEmailChange ? email : undefined,
                newPassword: hasPasswordChange ? newPassword : undefined,
            });

            // CRITICAL SECURITY: Blacklist all refresh tokens when password changes
            if (hasPasswordChange) {
                logger.warn("Password changed - revoking all user tokens", { userId });
                const tokenResult = await authService.invalidateUserTokens(userId);
                if (!tokenResult.success) {
                    logger.error("Failed to revoke user tokens on password change", {
                        userId,
                        errors: tokenResult.errors
                    });
                } else {
                    logger.info("Successfully revoked user tokens on password change", {
                        userId,
                        tokensBlacklisted: tokenResult.tokensBlacklisted
                    });
                }
            }

            // Clear cache after successful update
            await this.invalidateUserProfileCache(userId);

            // Log the profile update
            const changes = [];
            if (hasEmailChange) changes.push("email");
            if (hasPasswordChange) changes.push("password");

            await this.logProfileUpdate(userId, changes);

            logger.info("Profile updated successfully", {
                userId,
                changes,
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
     * Validate wallet ownership for user verification
     */
    async verifyWalletOwnership(
        userId: string,
        walletAddress: string,
        signature: string,
        message: string
    ): Promise<{ success: boolean; message: string }> {
        try {
            const result = await authService.verifyWalletOwnership(
                userId,
                walletAddress,
                signature,
                message
            );

            if (result.success) {
                logger.info("Wallet verified successfully", { userId, walletAddress });
            } else {
                logger.warn("Wallet verification failed", { userId, walletAddress, reason: result.message });
            }

            return {
                success: result.success,
                message: result.message || "Wallet verification completed",
            };
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
     * Get current user email
     */
    private async getCurrentEmail(userId: string): Promise<string> {
        const result = await query("SELECT email FROM users WHERE id = $1", [userId]);
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        return result.rows[0].email;
    }

    /**
     * Validate current password
     */
    private async validateCurrentPassword(userId: string, currentPassword: string | undefined): Promise<boolean> {
        if (!currentPassword) return false;

        // Get user with password hash for verification
        const passwordCheckResult = await query(
            "SELECT password_hash FROM users WHERE id = $1",
            [userId]
        );

        if (passwordCheckResult.rows.length === 0) {
            return false;
        }

        return await authService.verifyPassword(
            { password_hash: passwordCheckResult.rows[0].password_hash },
            currentPassword
        );
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
        changes: { email?: string; newPassword?: string }
    ): Promise<{ email: string; updatedAt: string }> {
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (changes.email) {
            updateFields.push(`email = $${paramIndex++}`);
            updateValues.push(changes.email.toLowerCase());
        }

        if (changes.newPassword) {
            const hashedPassword = await authService.hashPassword(changes.newPassword);
            updateFields.push(`password_hash = $${paramIndex++}`);
            updateValues.push(hashedPassword);
        }

        updateFields.push(`updated_at = $${paramIndex++}`);
        updateValues.push(new Date());

        updateValues.push(userId); // WHERE clause

        // Execute update
        const updateQuery = `
      UPDATE users
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email
    `;

        const updateResult = await query(updateQuery, updateValues);

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
