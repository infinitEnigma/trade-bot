/**
 * Kodiak Connection Service
 *
 * Manages Kodiak exchange connection lifecycle including credential management,
 * connection setup, verification, and disconnection. Handles user onboarding
 * to the Kodiak exchange platform.
 */

import { query } from "../database/pool";
import { authService } from "./auth";
import { kodiakIntegrationService } from "./kodiak-integration";
import logger from "./logger";

export interface KodiakConnectionData {
    accountId: string;
    apiKey: string;
    secretKey: string;
    walletSignature?: string;
}

export interface KodiakConnectionResult {
    success: boolean;
    message: string;
    data?: {
        accountId: string;
        verified: boolean;
        userLevel?: string;
    };
    error?: string;
}

export interface KodiakConnectionStatus {
    connected: boolean;
    accountId?: string;
    verified?: boolean;
    connectedAt?: string;
}

/**
 * Kodiak Connection Service
 */
export class KodiakConnectionService {
    /**
     * Connect user to Kodiak exchange with credential validation
     */
    async connectKodiak(userId: string, connectionData: KodiakConnectionData): Promise<KodiakConnectionResult> {
        try {
            logger.info("Starting Kodiak connection process", { userId, accountId: connectionData.accountId });

            // Validate input data
            const validation = this.validateConnectionData(connectionData);
            if (!validation.valid) {
                return {
                    success: false,
                    message: validation.error || "Invalid connection data",
                    error: validation.error,
                };
            }

            // Store credentials (encrypted)
            await this.storeCredentials(userId, connectionData);

            // Test API connectivity and verify credentials
            const verificationResult = await this.verifyCredentials(userId, connectionData);

            if (!verificationResult.verified) {
                logger.warn("Kodiak credential verification failed", {
                    userId,
                    accountId: connectionData.accountId,
                    reason: verificationResult.error,
                });

                return {
                    success: false,
                    message: "Kodiak credentials stored but verification failed. Please check your credentials.",
                    data: {
                        accountId: connectionData.accountId,
                        verified: false,
                    },
                    error: verificationResult.error,
                };
            }

            // Update user level to REGISTERED
            await this.updateUserLevel(userId, "REGISTERED");

            // Log successful connection
            await this.logConnectionEvent(userId, connectionData.accountId, true);

            logger.info("Kodiak connection successful", {
                userId,
                accountId: connectionData.accountId,
                verified: true,
            });

            return {
                success: true,
                message: "Kodiak credentials connected and verified successfully",
                data: {
                    accountId: connectionData.accountId,
                    verified: true,
                    userLevel: "REGISTERED",
                },
            };

        } catch (error) {
            logger.error("Kodiak connection error", {
                userId,
                accountId: connectionData.accountId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                message: "Failed to connect Kodiak credentials",
                error: "Internal server error during connection",
            };
        }
    }

    /**
     * Disconnect user from Kodiak exchange
     */
    async disconnectKodiak(userId: string): Promise<{ success: boolean; message: string; error?: string }> {
        try {
            // Remove credentials
            await query("DELETE FROM kodiak_credentials WHERE user_id = $1", [userId]);

            // Log disconnection
            await this.logConnectionEvent(userId, null, false);

            logger.info("Kodiak disconnection successful", { userId });

            return {
                success: true,
                message: "Kodiak credentials disconnected",
            };

        } catch (error) {
            logger.error("Kodiak disconnection error", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                message: "Failed to disconnect Kodiak credentials",
                error: "Internal server error during disconnection",
            };
        }
    }

    /**
     * Get Kodiak connection status for a user
     */
    async getConnectionStatus(userId: string): Promise<KodiakConnectionStatus> {
        try {
            const result = await query(
                "SELECT account_id, verified, created_at FROM kodiak_credentials WHERE user_id = $1",
                [userId]
            );

            if (result.rows.length === 0) {
                return { connected: false };
            }

            const row = result.rows[0];

            return {
                connected: true,
                accountId: row.account_id,
                verified: row.verified,
                connectedAt: row.created_at,
            };

        } catch (error) {
            logger.error("Failed to get Kodiak connection status", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            // Return disconnected status on error
            return { connected: false };
        }
    }

    /**
     * Validate connection data before processing
     */
    private validateConnectionData(data: KodiakConnectionData): { valid: boolean; error?: string } {
        if (!data.accountId || !data.apiKey || !data.secretKey) {
            return {
                valid: false,
                error: "Account ID, API key, and secret key are required",
            };
        }

        // Basic format validation
        if (data.accountId.length < 10) {
            return {
                valid: false,
                error: "Account ID appears to be invalid",
            };
        }

        if (data.apiKey.length < 20) {
            return {
                valid: false,
                error: "API key appears to be invalid",
            };
        }

        if (data.secretKey.length < 30) {
            return {
                valid: false,
                error: "Secret key appears to be invalid",
            };
        }

        return { valid: true };
    }

    /**
     * Store encrypted credentials in database
     */
    private async storeCredentials(userId: string, data: KodiakConnectionData): Promise<void> {
        const { encryptionService } = await import("./encryption.js");

        const encryptedApiKey = encryptionService.encryptApiKey(data.apiKey);
        const encryptedSecretKey = encryptionService.encryptSecretKey(data.secretKey);

        await query(
            `INSERT INTO kodiak_credentials (user_id, account_id, api_key_encrypted, secret_key_encrypted, wallet_signature, verified)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         account_id = EXCLUDED.account_id,
         api_key_encrypted = EXCLUDED.api_key_encrypted,
         secret_key_encrypted = EXCLUDED.secret_key_encrypted,
         wallet_signature = EXCLUDED.wallet_signature,
         verified = EXCLUDED.verified,
         updated_at = CURRENT_TIMESTAMP`,
            [
                userId,
                data.accountId,
                encryptedApiKey,
                encryptedSecretKey,
                data.walletSignature || null,
                false, // Initially not verified
            ]
        );
    }

    /**
     * Verify credentials by testing API connectivity
     */
    private async verifyCredentials(userId: string, data: KodiakConnectionData): Promise<{ verified: boolean; error?: string }> {
        try {
            // Test connectivity with provided credentials
            const testResult = await kodiakIntegrationService.testConnectivity({
                accountId: data.accountId,
                apiKey: data.apiKey,
                secretKey: data.secretKey,
            });

            if (testResult.success) {
                // Update verification status in database
                await query(
                    "UPDATE kodiak_credentials SET verified = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
                    [true, userId]
                );

                return { verified: true };
            } else {
                return {
                    verified: false,
                    error: testResult.error || "Credential verification failed",
                };
            }

        } catch (error) {
            logger.warn("Credential verification error", {
                userId,
                accountId: data.accountId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                verified: false,
                error: "Unable to verify credentials - please check your API keys",
            };
        }
    }

    /**
     * Update user level after successful connection
     */
    private async updateUserLevel(userId: string, newLevel: string): Promise<void> {
        try {
            await authService.updateUserLevel(userId, newLevel as any);
            logger.info(`User level updated to ${newLevel}`, { userId });
        } catch (error) {
            logger.error("Failed to update user level", {
                userId,
                newLevel,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Log connection/disconnection events
     */
    private async logConnectionEvent(userId: string, accountId: string | null, connected: boolean): Promise<void> {
        try {
            await query(
                "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                [
                    userId,
                    connected ? "KODIAK_CONNECTED" : "KODIAK_DISCONNECTED",
                    connected ? { accountId, verified: true } : {},
                ]
            );
        } catch (error) {
            logger.warn("Failed to log Kodiak connection event", {
                userId,
                accountId,
                connected,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Check if user has verified Kodiak connection
     */
    async hasVerifiedConnection(userId: string): Promise<boolean> {
        try {
            const result = await query(
                "SELECT verified FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );

            return result.rows.length > 0;
        } catch (error) {
            logger.error("Failed to check Kodiak connection status", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            return false;
        }
    }

    /**
     * Get connection statistics for monitoring
     */
    async getConnectionStats(): Promise<{
        totalConnections: number;
        verifiedConnections: number;
        pendingConnections: number;
    }> {
        try {
            const totalResult = await query("SELECT COUNT(*) as count FROM kodiak_credentials");
            const verifiedResult = await query("SELECT COUNT(*) as count FROM kodiak_credentials WHERE verified = true");
            const pendingResult = await query("SELECT COUNT(*) as count FROM kodiak_credentials WHERE verified = false");

            return {
                totalConnections: parseInt(totalResult.rows[0].count),
                verifiedConnections: parseInt(verifiedResult.rows[0].count),
                pendingConnections: parseInt(pendingResult.rows[0].count),
            };

        } catch (error) {
            logger.error("Failed to get connection stats", {
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                totalConnections: 0,
                verifiedConnections: 0,
                pendingConnections: 0,
            };
        }
    }

    /**
     * Clean up expired or invalid connections
     */
    async cleanupInvalidConnections(): Promise<{ cleaned: number }> {
        try {
            // Find connections older than 30 days that are still unverified
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const result = await query(
                "DELETE FROM kodiak_credentials WHERE verified = false AND created_at < $1",
                [thirtyDaysAgo]
            );

            const cleanedCount = result.rowCount || 0;

            if (cleanedCount > 0) {
                logger.info("Cleaned up invalid Kodiak connections", {
                    cleanedCount,
                    olderThan: thirtyDaysAgo.toISOString(),
                });
            }

            return { cleaned: cleanedCount };

        } catch (error) {
            logger.error("Failed to cleanup invalid connections", {
                error: error instanceof Error ? error.message : String(error),
            });

            return { cleaned: 0 };
        }
    }

    /**
     * Re-verify existing connections (useful for maintenance)
     */
    async reverifyConnections(): Promise<{ reVerified: number; failed: number }> {
        try {
            const connections = await query(
                "SELECT user_id, account_id FROM kodiak_credentials WHERE verified = true"
            );

            let reVerified = 0;
            let failed = 0;

            for (const connection of connections.rows) {
                try {
                    const credentials = await kodiakIntegrationService.getUserCredentials(connection.user_id);

                    if (credentials) {
                        const testResult = await kodiakIntegrationService.testConnectivity(credentials);

                        if (testResult.success) {
                            reVerified++;
                        } else {
                            // Mark as unverified if test fails
                            await query(
                                "UPDATE kodiak_credentials SET verified = false WHERE user_id = $1",
                                [connection.user_id]
                            );
                            failed++;
                        }
                    }
                } catch (error) {
                    logger.warn("Failed to re-verify connection", {
                        userId: connection.user_id,
                        accountId: connection.account_id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    failed++;
                }
            }

            logger.info("Connection re-verification completed", {
                totalChecked: connections.rows.length,
                reVerified,
                failed,
            });

            return { reVerified, failed };

        } catch (error) {
            logger.error("Failed to re-verify connections", {
                error: error instanceof Error ? error.message : String(error),
            });

            return { reVerified: 0, failed: 0 };
        }
    }
}

// Export singleton instance
export const kodiakConnectionService = new KodiakConnectionService();
