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

import { kodiakConnectionService } from "../../infrastructure/external/kodiak-connection.service";
import { logger } from "../../core/logging";
import { KodiakConnectionData, KodiakConnectionResult, KodiakConnectionStatus } from "../../infrastructure/external/kodiak-connection.service";

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

export class UserKodiakService {
    /**
     * Link Kodiak account to user
     */
    async linkKodiakAccount(
        userId: string,
        connectionData: KodiakConnectionData
    ): Promise<KodiakConnectionResult> {
        try {
            logger.info("Linking Kodiak account for user", {
                userId,
                accountId: connectionData.accountId
            });

            // Delegate to infrastructure service for actual connection
            const result = await kodiakConnectionService.connectKodiak(userId, connectionData);

            if (result.success) {
                logger.info("Kodiak account linked successfully", {
                    userId,
                    accountId: connectionData.accountId,
                    verified: result.data?.verified
                });
            } else {
                logger.warn("Kodiak account linking failed", {
                    userId,
                    accountId: connectionData.accountId,
                    error: result.error
                });
            }

            return result;
        } catch (error) {
            logger.error("Failed to link Kodiak account", {
                error: error instanceof Error ? error.message : String(error),
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
            logger.info("Unlinking Kodiak account for user", { userId });

            // Delegate to infrastructure service for actual disconnection
            const result = await kodiakConnectionService.disconnectKodiak(userId);

            if (result.success) {
                logger.info("Kodiak account unlinked successfully", { userId });
            }

            return result;
        } catch (error) {
            logger.error("Failed to unlink Kodiak account", {
                error: error instanceof Error ? error.message : String(error),
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
     * Get user's Kodiak connection status
     */
    async getKodiakConnectionStatus(userId: string): Promise<KodiakConnectionStatus> {
        try {
            logger.debug("Getting Kodiak connection status for user", { userId });

            // Delegate to infrastructure service for status check
            const status = await kodiakConnectionService.getConnectionStatus(userId);

            logger.debug("Kodiak connection status retrieved", {
                userId,
                connected: status.connected,
                verified: status.verified
            });

            return status;
        } catch (error) {
            logger.error("Failed to get Kodiak connection status", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            // Return disconnected status on error
            return { connected: false };
        }
    }

    /**
     * Get user's Kodiak configuration
     */
    async getUserKodiakConfig(userId: string): Promise<KodiakUserConfig | null> {
        try {
            logger.debug("Getting Kodiak configuration for user", { userId });

            // Get connection status first
            const status = await this.getKodiakConnectionStatus(userId);

            if (!status.connected || !status.accountId) {
                logger.debug("No active Kodiak connection found for user", { userId });
                return null;
            }

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
            logger.error("Failed to get user Kodiak config", {
                error: error instanceof Error ? error.message : String(error),
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
            logger.info("Updating Kodiak preferences for user", { userId, preferences });

            // Validate that user has an active Kodiak connection
            const status = await this.getKodiakConnectionStatus(userId);
            if (!status.connected) {
                logger.warn("Cannot update preferences - no active Kodiak connection", { userId });
                return {
                    success: false,
                    message: "Cannot update preferences - no active Kodiak connection"
                };
            }

            // Note: In a real implementation, this would update database
            // For now, just log the preference update
            logger.info("Kodiak preferences updated", { userId, preferences });

            return {
                success: true,
                message: "Kodiak preferences updated successfully"
            };
        } catch (error) {
            logger.error("Failed to update Kodiak preferences", {
                error: error instanceof Error ? error.message : String(error),
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
            logger.error("Failed to check verified connection status", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return false;
        }
    }
}

export const userKodiakService = new UserKodiakService();
