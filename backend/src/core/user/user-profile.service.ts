/**
 * User Profile Service
 *
 * Handles user profile operations including retrieval, updates, and validation.
 * Provides centralized profile management with proper validation and auditing.
 */

import { userLogger } from "../../core/logging";
import { selectAuthService } from "../service-selector";
import { ICacheService, IPasswordService, IUserRepository, IAuditLogRepository } from "@trade-bot/shared";

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
    createdAt: Date;
    updatedAt: Date;
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
export interface UserProfileServiceDependencies {
    userRepository: IUserRepository;
    cache: ICacheService;
    passwordService: IPasswordService;
    auditLogRepository: IAuditLogRepository;
}

export class UserProfileService {
    private readonly CACHE_TTL = 300; // 5 minutes for user profiles

    constructor(private deps: UserProfileServiceDependencies) { }

    /**
     * Get comprehensive user profile information with optimized single query and caching
     */
    async getUserProfile(userId: string): Promise<UserProfile> {
        const cacheKey = `user:profile:${userId}`;

        // Check Redis cache first for performance
        try {
            const cachedResult = await this.deps.cache.get<UserProfile>(cacheKey);
            if (cachedResult.success && cachedResult.data) {
                userLogger.debug("User profile retrieved from cache", { userId });
                return cachedResult.data;
            }
        } catch (cacheError) {
            userLogger.warn("Failed to read from cache, falling back to database", {
                userId,
                error: cacheError instanceof Error ? cacheError.message : String(cacheError),
            });
        }

        // Get authenticated user data using repository pattern
        const userData = await this.deps.userRepository.getAuthenticatedUserData(userId);
        if (!userData) {
            throw new Error('User not found');
        }

        const profile: UserProfile = {
            id: userData.user.id,
            email: userData.user.email,
            userLevel: userData.user.userLevel,
            roles: userData.roles,
            hasKodiak: userData.hasCredentials,
            kodiakStatus: userData.hasCredentials ? {
                accountId: userData.kodiakAccountId || '',
                verified: !!userData.kodiakVerified
            } : null,
            createdAt: userData.user.createdAt,
            updatedAt: userData.user.updatedAt,
        };

        // Debug logging to check if kodiakStatus.accountId is being set correctly
        userLogger.debug('🔍 UserProfile debug:', {
            userId: userData.user.id,
            hasKodiak: userData.hasCredentials,
            kodiakAccountId: userData.kodiakAccountId,
            kodiakVerified: userData.kodiakVerified,
            kodiakStatus: profile.kodiakStatus
        });

        // Cache the profile for future requests
        try {
            await this.deps.cache.setex(cacheKey, this.CACHE_TTL, profile);
            userLogger.debug("User profile cached", { userId, ttl: this.CACHE_TTL });
        } catch (cacheError) {
            userLogger.warn("Failed to cache user profile", {
                userId,
                error: cacheError instanceof Error ? cacheError.message : String(cacheError),
            });
        }

        userLogger.debug("User profile retrieved with optimized query", {
            userId: userData.user.id,
            hasKodiak: userData.hasCredentials,
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
            // Start operation timing
            const timer = userLogger.startOperation("verifyWalletOwnership", {
                userId,
                walletAddress
            });

            const authService = selectAuthService();
            const result = await authService.verifyWalletOwnership(
                userId,
                walletAddress,
                signature,
                message
            );

            timer.success();
            return result;
        } catch (error) {
            userLogger.error("Wallet verification error", error instanceof Error ? error : undefined, {
                userId,
                walletAddress
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

            userLogger.info("Profile updated successfully", {
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
            userLogger.error("Profile update error", error instanceof Error ? error : undefined, {
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
        const user = await this.deps.userRepository.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }
        return user.email;
    }



    /**
     * Check if email is available for use
     */
    private async checkEmailAvailability(email: string, excludeUserId: string): Promise<boolean> {
        const existingUser = await this.deps.userRepository.findByEmail(email.toLowerCase());
        return !existingUser || existingUser.id === excludeUserId;
    }

    /**
     * Execute the profile update in database
     */
    private async executeProfileUpdate(
        userId: string,
        changes: { email?: string }
    ): Promise<{ email: string; updatedAt: string }> {
        const updateResult = await this.deps.userRepository.updateProfile(userId, changes);

        if (!updateResult) {
            throw new Error('User not found');
        }

        return {
            email: updateResult.email,
            updatedAt: updateResult.updatedAt.toISOString(),
        };
    }

    /**
     * Log profile update for audit trail
     */
    private async logProfileUpdate(userId: string, changes: string[]): Promise<void> {
        await this.deps.auditLogRepository.logEvent({
            userId,
            action: "PROFILE_UPDATED",
            details: { changes }
        });
    }

    /**
     * Invalidate user profile cache after updates
     */
    private async invalidateUserProfileCache(userId: string): Promise<void> {
        const cacheKey = `user:profile:${userId}`;
        try {
            await this.deps.cache.delete(cacheKey);
            userLogger.debug("User profile cache invalidated", { userId });
        } catch (error) {
            userLogger.warn("Failed to invalidate user profile cache", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

// Export factory function for creating service instances
export function createUserProfileService(deps: UserProfileServiceDependencies): UserProfileService {
    return new UserProfileService(deps);
}

