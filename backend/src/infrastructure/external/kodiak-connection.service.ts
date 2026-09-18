/**
 * Kodiak Connection Service
 *
 * Manages Kodiak exchange connection lifecycle including credential management,
 * connection setup, verification, and disconnection. Handles user onboarding
 * to the Kodiak exchange platform.
 */

import { query } from "../../database/pool";
import type { AuthService } from "../../core/auth/auth.service.pure";
import { kodiakIntegrationService } from "./kodiak-integration.service";
import { encryptionService } from "../../infrastructure/security";
import { contextLogger } from "../../core/logging/context-aware-logger.service";
import { UserLevel, KodiakConnectionRequest } from "@trade-bot/shared";

// Get authService when needed to support proper mocking in tests.
// Lazy import (not top-level) to dodge the circular DI import.
async function getAuthService(): Promise<AuthService> {
    const { diContainer } = await import('../../infrastructure/dependency-injection.container');
    return diContainer.authService;
}

export type KodiakConnectionData = KodiakConnectionRequest;

export interface KodiakConnectionResult {
    success: boolean;
    message: string;
    data?: {
        accountId: string;
        verified: boolean;
        userLevel?: UserLevel;
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
     * (REGISTERED -> VERIFIED upgrade step)
     */
    async connectKodiak(userId: string, connectionData: KodiakConnectionData): Promise<KodiakConnectionResult> {
        try {
            contextLogger.info("Starting Kodiak connection process", { userId, accountId: connectionData.accountId });

            // Wallet-first flow: only REGISTERED users (wallet linked) may
            // submit Kodiak credentials
            const requestingUser = await (await getAuthService()).getUserById(userId);
            if (!requestingUser) {
                return {
                    success: false,
                    message: "User not found",
                    error: "User not found",
                };
            }
            if (requestingUser.userLevel === UserLevel.BASIC) {
                contextLogger.warn("Kodiak connection rejected - wallet not linked", { userId });
                return {
                    success: false,
                    message: "Please connect and verify your wallet on the Dashboard first.",
                    error: "Wallet verification required",
                };
            }

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
                contextLogger.warn("Kodiak credential verification failed", {
                    userId,
                    accountId: connectionData.accountId,
                    reason: verificationResult.error,
                });

                // Roll back the stored credentials - verification failed, so
                // the connection must not appear as "connected" in status
                // checks (all-or-nothing connect semantics).
                try {
                    await query("DELETE FROM kodiak_credentials WHERE user_id = $1", [userId]);
                } catch (rollbackError) {
                    contextLogger.error("Failed to roll back unverified Kodiak credentials", rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)), {
                        userId,
                    });
                }

                return {
                    success: false,
                    message: "Kodiak credential verification failed. Please check your credentials.",
                    data: {
                        accountId: connectionData.accountId,
                        verified: false,
                    },
                    error: verificationResult.error,
                };
            }

            // Fetch and store wallet address from Kodiak account info
            // (informational only — the linked wallet in wallet_addresses
            // remains the source of truth for REGISTERED status)
            await this.fetchAndStoreWalletAddress(userId, connectionData);

            // Update user level to VERIFIED (after Kodiak connection)
            await this.updateUserLevel(userId, UserLevel.VERIFIED);

            // Invalidate cached user data so frontend gets updated level immediately
            await (await getAuthService()).invalidateUserDataCache(userId);

            // Log successful connection
            await this.logConnectionEvent(userId, connectionData.accountId, true);

            contextLogger.info("Kodiak connection successful", {
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
                    userLevel: UserLevel.VERIFIED, // Return the actual level that was set
                },
            };

        } catch (error) {
            contextLogger.error("Kodiak connection error", error instanceof Error ? error : new Error(String(error)), {
                userId,
                accountId: connectionData.accountId,
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

            // Downgrade user level back to BASIC (always downgrade on disconnect)
            await this.updateUserLevelForDisconnect(userId);

            // Invalidate cached user data so frontend gets updated level immediately
            await (await getAuthService()).invalidateUserDataCache(userId);

            // Log disconnection
            await this.logConnectionEvent(userId, null, false);

            contextLogger.info("Kodiak disconnection successful", { userId });

            return {
                success: true,
                message: "Kodiak credentials disconnected",
            };

        } catch (error) {
            contextLogger.error("Kodiak disconnection error", error instanceof Error ? error : new Error(String(error)), {
                userId,
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

            const row = result.rows[0] as {
                account_id: string;
                verified: boolean;
                created_at: string;
            };

            return {
                connected: true,
                accountId: row.account_id,
                verified: row.verified,
                connectedAt: row.created_at,
            };

        } catch (error) {
            contextLogger.error("Failed to get Kodiak connection status", error instanceof Error ? error : new Error(String(error)), {
                userId,
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

        // API key format validation (should be ed25519:public_key format)
        if (!data.apiKey.includes(':') || !data.apiKey.startsWith('ed25519:')) {
            return {
                valid: false,
                error: "API key appears to be invalid",
            };
        }

        // Secret key should be a valid base58 string (Orderly format)
        // Real Orderly secret keys are typically 32-44 characters
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
            contextLogger.warn("Credential verification error", {
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
    private async updateUserLevel(userId: string, newLevel: UserLevel): Promise<void> {
        try {
            // Get current user level first
            const user = await (await getAuthService()).getUserById(userId);
            if (!user) {
                throw new Error("User not found");
            }

            // Only update if the level is actually changing
            if (user.userLevel === newLevel) {
                contextLogger.info(`User level already ${newLevel}, no update needed`, { userId });
                return;
            }

            // Validate the transition is allowed
            if (!this.isValidLevelTransition(user.userLevel, newLevel)) {
                throw new Error(`Invalid user level transition from ${user.userLevel} to ${newLevel}`);
            }

            await (await getAuthService()).updateUserLevel(userId, newLevel);
            contextLogger.info(`User level updated from ${user.userLevel} to ${newLevel}`, { userId });
        } catch (error) {
            contextLogger.error("Failed to update user level", error instanceof Error ? error : new Error(String(error)), {
                userId,
                newLevel,
            });
            throw error;
        }
    }

    /**
     * Update user level for disconnection.
     * VERIFIED -> REGISTERED (wallet link remains, Kodiak gone).
     * REGISTERED with no wallet -> BASIC; otherwise stays REGISTERED.
     */
    private async updateUserLevelForDisconnect(userId: string): Promise<void> {
        try {
            const user = await (await getAuthService()).getUserById(userId);
            if (!user) {
                throw new Error("User not found");
            }

            if (user.userLevel === UserLevel.VERIFIED) {
                await (await getAuthService()).updateUserLevel(userId, UserLevel.REGISTERED);
                contextLogger.info("User level downgraded to REGISTERED after Kodiak disconnection", { userId });
                return;
            }

            if (user.userLevel === UserLevel.REGISTERED) {
                const walletAddress = await this.getLinkedWalletAddress(userId);
                const targetLevel = walletAddress ? UserLevel.REGISTERED : UserLevel.BASIC;
                await (await getAuthService()).updateUserLevel(userId, targetLevel);
                contextLogger.info(`User level ${targetLevel} after Kodiak disconnection`, { userId });
            }
        } catch (error) {
            contextLogger.error("Failed to update user level during disconnection", error instanceof Error ? error : new Error(String(error)), {
                userId,
            });
            throw error;
        }
    }

    /**
     * Get the linked wallet address (wallet_addresses table first,
     * kodiak_credentials as legacy fallback)
     */
    private async getLinkedWalletAddress(userId: string): Promise<string | null> {
        try {
            const result = await query<{ wallet_address: string }>(
                "SELECT wallet_address FROM wallet_addresses WHERE user_id = $1",
                [userId]
            );
            if (result.rows.length > 0 && result.rows[0].wallet_address) {
                return result.rows[0].wallet_address;
            }
            const legacy = await query<{ wallet_address: string }>(
                "SELECT wallet_address FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );
            if (legacy.rows.length === 0) {
                return null;
            }
            return legacy.rows[0].wallet_address;
        } catch {
            return null;
        }
    }

    /**
     * Fetch wallet address from Kodiak account info and store it
     */
    private async fetchAndStoreWalletAddress(userId: string, connectionData: KodiakConnectionData): Promise<void> {
        try {
            // Get account info from Kodiak API (wallet address) - try authenticated first
            const credentials = {
                accountId: connectionData.accountId,
                apiKey: connectionData.apiKey,
                secretKey: connectionData.secretKey,
            };
            const accountInfoResult = await kodiakIntegrationService.getPublicAccountInfo(connectionData.accountId, credentials);

            if (!accountInfoResult.success || !accountInfoResult.data) {
                contextLogger.warn("Failed to fetch Kodiak public account info for wallet address", {
                    userId,
                    accountId: connectionData.accountId,
                });
                return;
            }

            // Extract wallet address from public account info
            const accountInfo = accountInfoResult.data as { address?: string;[key: string]: unknown };
            const walletAddress = accountInfo.address;

            if (!walletAddress) {
                contextLogger.warn("No wallet address found in Kodiak public account info", {
                    userId,
                    accountId: connectionData.accountId,
                    accountInfoKeys: Object.keys(accountInfo),
                });
                return;
            }

            // Validate wallet address format (should be Ethereum address)
            if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
                contextLogger.warn("Invalid wallet address format from Kodiak API", {
                    userId,
                    accountId: connectionData.accountId,
                    walletAddress,
                });
                return;
            }

            // Store wallet address in database
            await query(
                "UPDATE kodiak_credentials SET wallet_address = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
                [walletAddress, userId]
            );

            contextLogger.info("Wallet address fetched and stored from Kodiak public API", {
                userId,
                accountId: connectionData.accountId,
                walletAddress,
            });

        } catch (error) {
            contextLogger.error("Failed to fetch and store wallet address", error instanceof Error ? error : new Error(String(error)), {
                userId,
                accountId: connectionData.accountId,
            });
            // Don't throw - wallet address is optional for basic functionality
        }
    }

    /**
     * Validate if a user level transition is allowed
     */
    private isValidLevelTransition(fromLevel: string, toLevel: string): boolean {
        const validTransitions: Record<string, string[]> = {
            'BASIC': ['REGISTERED'],
            'REGISTERED': ['VERIFIED'],
            'VERIFIED': ['PREMIUM'],
            'PREMIUM': ['ADMIN'],
            'ADMIN': [] // No transitions from admin
        };

        return validTransitions[fromLevel]?.includes(toLevel) ?? false;
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
            contextLogger.warn("Failed to log Kodiak connection event", {
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
            contextLogger.error("Failed to check Kodiak connection status", error instanceof Error ? error : new Error(String(error)), {
                userId,
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
                totalConnections: parseInt((totalResult.rows[0] as { count: string }).count),
                verifiedConnections: parseInt((verifiedResult.rows[0] as { count: string }).count),
                pendingConnections: parseInt((pendingResult.rows[0] as { count: string }).count),
            };

        } catch (error) {
            contextLogger.error("Failed to get connection stats", error instanceof Error ? error : new Error(String(error)));

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
                contextLogger.info("Cleaned up invalid Kodiak connections", {
                    cleanedCount,
                    olderThan: thirtyDaysAgo.toISOString(),
                });
            }

            return { cleaned: cleanedCount };

        } catch (error) {
            contextLogger.error("Failed to cleanup invalid connections", error instanceof Error ? error : new Error(String(error)));

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

            for (const connection of connections.rows as Array<{ user_id: string; account_id: string }>) {
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
                    contextLogger.warn("Failed to re-verify connection", {
                        userId: connection.user_id,
                        accountId: connection.account_id,
                        errorMessage: error instanceof Error ? error.message : String(error),
                    });
                    failed++;
                }
            }

            contextLogger.info("Connection re-verification completed", {
                totalChecked: connections.rows.length,
                reVerified,
                failed,
            });

            return { reVerified, failed };

        } catch (error) {
            contextLogger.error("Failed to re-verify connections", error instanceof Error ? error : new Error(String(error)), {
                totalChecked: 0,
                reVerified: 0,
                failed: 0,
            });

            return { reVerified: 0, failed: 0 };
        }
    }
}

// Export singleton instance
export const kodiakConnectionService = new KodiakConnectionService();
