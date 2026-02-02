/**
 * ===========================================
 * 👤 USER KODIAK SERVICE
 * ===========================================
 *
 * User-specific Kodiak integration and configuration management.
 * Handles user credentials, preferences, and Kodiak-specific operations.
 *
 * RESPONSIBILITIES:
 * - User Kodiak credential management
 * - User-specific Kodiak configurations
 * - Kodiak account linking and unlinking
 * - User Kodiak preferences and settings
 *
 * @format
 */

import { userLogger } from "../../core/logging";
import { KodiakConnectionData, KodiakConnectionResult, KodiakConnectionStatus } from "../../infrastructure/external/kodiak-connection.service";
import { ICacheService } from "@trade-bot/shared";

// Simple in-memory cache for Kodiak status
interface KodiakStatusCache {
    status: KodiakConnectionStatus;
    timestamp: number;
}

const STATUS_CACHE_TTL = 10000; // 10 seconds cache

export interface KodiakUserConfig {
    userId: string;
    kodiakAccountId: string;
    isActive: boolean;
    preferences: {
        defaultLeverage: number;
        riskLevel: 'low' | 'medium' | 'high';
        autoSync: boolean;
    };
    createdAt: Date;
    updatedAt: Date;
}

export interface KodiakCredentials {
    apiKey: string;
    secretKey: string;
    accountId: string;
}

export interface UserKodiakServiceDependencies {
    kodiakConnectionService: {
        connectKodiak: (userId: string, connectionData: KodiakConnectionData) => Promise<KodiakConnectionResult>;
        disconnectKodiak: (userId: string) => Promise<{ success: boolean; message: string; error?: string }>;
        getConnectionStatus: (userId: string) => Promise<KodiakConnectionStatus>;
    };
    cache: {
        getCachedResult: (userId: string, accountId: string) => Promise<any>;
        setCachedResult: (userId: string, accountId: string, success: boolean, error?: string) => Promise<void>;
    };
}

export class UserKodiakService {
    private statusCache: Map<string, KodiakStatusCache>;

    constructor(private deps: UserKodiakServiceDependencies) {
        this.statusCache = new Map<string, KodiakStatusCache>();
    }

    /**
     * Link Kodiak account to user
     */
    async linkKodiakAccount(
        userId: string,
        connectionData: KodiakConnectionData
    ): Promise<KodiakConnectionResult> {
        try {
            userLogger.info("Linking Kodiak account for user", {
                userId,
                accountId: connectionData.accountId
            });

            // Start operation timing
            const timer = userLogger.startOperation("linkKodiakAccount", {
                userId,
                accountId: connectionData.accountId
            });

            // Check cache first to avoid duplicate API calls
            const cachedResult = await this.deps.cache.getCachedResult(userId, connectionData.accountId);
            if (cachedResult) {
                timer.success({
                    cached: true,
                    verified: cachedResult.success
                });
                userLogger.info("Kodiak connection result retrieved from cache", {
                    userId,
                    accountId: connectionData.accountId,
                    success: cachedResult.success,
                    error: cachedResult.error
                });

                return {
                    success: cachedResult.success,
                    message: cachedResult.success ? "Connection successful" : "Connection failed",
                    error: cachedResult.error,
                    data: cachedResult.success ? {
                        accountId: connectionData.accountId,
                        verified: true
                    } : undefined
                };
            }

            // Delegate to infrastructure service for actual connection
            const result = await this.deps.kodiakConnectionService.connectKodiak(userId, connectionData);

            // Cache the result
            await this.deps.cache.setCachedResult(
                userId,
                connectionData.accountId,
                result.success,
                result.error
            );

            if (result.success) {
                timer.success({
                    verified: result.data?.verified
                });
                userLogger.info("Kodiak account linked successfully", {
                    userId,
                    accountId: connectionData.accountId,
                    verified: result.data?.verified
                });
            } else {
                timer.failure();
                userLogger.warn("Kodiak account linking failed", {
                    userId,
                    accountId: connectionData.accountId,
                    error: result.error
                });
            }

            return result;
        } catch (error) {
            userLogger.error("Failed to link Kodiak account", error instanceof Error ? error : undefined, {
                userId,
                accountId: connectionData.accountId
            });
            return {
                success: false,
                message: "Failed to link Kodiak account",
                error: "Internal server error during connection"
            };
        }
    }

    /**
     * Unlink Kodiak account from user
     */
    async unlinkKodiakAccount(userId: string): Promise<{ success: boolean; message: string; error?: string }> {
        try {
            userLogger.info("Unlinking Kodiak account for user", { userId });

            // Start operation timing
            const timer = userLogger.startOperation("unlinkKodiakAccount", { userId });

            // Delegate to infrastructure service for actual disconnection
            const result = await this.deps.kodiakConnectionService.disconnectKodiak(userId);

            if (result.success) {
                timer.success();
                userLogger.info("Kodiak account unlinked successfully", { userId });
            } else {
                timer.failure();
            }

            return result;
        } catch (error) {
            userLogger.error("Failed to unlink Kodiak account", error instanceof Error ? error : undefined, {
                userId
            });
            return {
                success: false,
                message: "Failed to unlink Kodiak account",
                error: "Internal server error during disconnection"
            };
        }
    }

    /**
     * Get user's Kodiak connection status with caching
     */
    async getKodiakConnectionStatus(userId: string): Promise<KodiakConnectionStatus> {
        try {
            userLogger.debug("Getting Kodiak connection status for user", { userId });

            // Start operation timing
            const timer = userLogger.startOperation("getKodiakConnectionStatus", { userId });

            // Check cache first
            const cached = this.statusCache.get(userId);
            const now = Date.now();

            if (cached && (now - cached.timestamp) < STATUS_CACHE_TTL) {
                timer.success();
                userLogger.debug("Kodiak connection status retrieved from cache", {
                    userId,
                    connected: cached.status.connected,
                    verified: cached.status.verified,
                    cacheAge: now - cached.timestamp
                });
                return cached.status;
            }

            // Cache miss or expired, fetch from infrastructure service
            const status = await this.deps.kodiakConnectionService.getConnectionStatus(userId);

            // Update cache
            this.statusCache.set(userId, {
                status,
                timestamp: now
            });

            timer.success();
            userLogger.debug("Kodiak connection status retrieved and cached", {
                userId,
                connected: status.connected,
                verified: status.verified
            });

            return status;
        } catch (error) {
            userLogger.error("Failed to get Kodiak connection status", error instanceof Error ? error : undefined, {
                userId
            });
            // Re-throw the error instead of returning a default status
            throw error;
        }
    }

    /**
     * Get user's Kodiak configuration
     */
    async getUserKodiakConfig(userId: string): Promise<KodiakUserConfig | null> {
        try {
            userLogger.debug("Getting Kodiak configuration for user", { userId });

            // Start operation timing
            const timer = userLogger.startOperation("getUserKodiakConfig", { userId });

            // Get connection status first
            const status = await this.getKodiakConnectionStatus(userId);

            if (!status.connected || !status.accountId) {
                timer.success();
                userLogger.debug("No active Kodiak connection found for user", { userId });
                return null;
            }

            timer.success();
            // Return configuration based on connection status
            return {
                userId,
                kodiakAccountId: status.accountId,
                isActive: status.connected && status.verified === true,
                preferences: {
                    defaultLeverage: 5,
                    riskLevel: 'medium',
                    autoSync: true
                },
                createdAt: new Date(),
                updatedAt: new Date()
            };
        } catch (error) {
            userLogger.error("Failed to get user Kodiak config", error instanceof Error ? error : undefined, {
                userId
            });
            return null;
        }
    }

    /**
     * Update user's Kodiak preferences
     */
    async updateKodiakPreferences(
        userId: string,
        preferences: Partial<KodiakUserConfig['preferences']>
    ): Promise<{ success: boolean; message: string }> {
        try {
            userLogger.info("Updating Kodiak preferences for user", { userId, preferences });

            // Start operation timing
            const timer = userLogger.startOperation("updateKodiakPreferences", { userId, preferences });

            // Validate that user has an active Kodiak connection
            const status = await this.getKodiakConnectionStatus(userId);
            if (!status.connected) {
                timer.failure();
                userLogger.warn("Cannot update preferences - no active Kodiak connection", { userId });
                return {
                    success: false,
                    message: "Cannot update preferences - no active Kodiak connection"
                };
            }

            // Note: In a real implementation, this would update database
            // For now, just log the preference update
            timer.success();
            userLogger.info("Kodiak preferences updated", { userId, preferences });

            return {
                success: true,
                message: "Kodiak preferences updated successfully"
            };
        } catch (error) {
            userLogger.error("Failed to update Kodiak preferences", error instanceof Error ? error : undefined, {
                userId,
                preferences
            });
            return {
                success: false,
                message: "Failed to update Kodiak preferences"
            };
        }
    }

    /**
     * Check if user has verified Kodiak connection
     */
    async hasVerifiedConnection(userId: string): Promise<boolean> {
        try {
            const status = await this.getKodiakConnectionStatus(userId);
            return status.connected === true && status.verified === true;
        } catch (error) {
            userLogger.error("Failed to check verified connection status", error instanceof Error ? error : undefined, {
                userId
            });
            return false;
        }
    }
}

// Export factory function for creating service instances
export function createUserKodiakService(deps: UserKodiakServiceDependencies): UserKodiakService {
    return new UserKodiakService(deps);
}

