/**
 * Kodiak Credentials Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IKodiakCredentialsRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for Kodiak credentials data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    IKodiakCredentialsRepository,
    KodiakCredentials
} from '../../../shared/src';
import { query } from '../../../database/pool';

/**
 * Database row interface for Kodiak credentials
 */
interface KodiakCredentialsRow {
    id: string;
    user_id: string;
    account_id: string;
    api_key_encrypted: string;
    secret_key_encrypted: string;
    verified: boolean;
    created_at: string;
    updated_at: string;
}

/**
 * Kodiak Credentials Repository Adapter
 *
 * Implements the IKodiakCredentialsRepository interface using PostgreSQL database operations.
 * Provides Kodiak credentials data access with proper error handling and type safety.
 */
export class KodiakCredentialsRepositoryAdapter implements IKodiakCredentialsRepository {

    /**
     * Get Kodiak credentials for a user
     */
    async getCredentials(userId: string): Promise<KodiakCredentials | null> {
        try {
            const result = await query<KodiakCredentialsRow>(
                'SELECT id, user_id, account_id, api_key_encrypted, secret_key_encrypted, verified, created_at, updated_at FROM kodiak_credentials WHERE user_id = $1 AND verified = true',
                [userId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0];
            return this.mapRowToCredentials(row);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get Kodiak credentials: ${errorMessage}`);
        }
    }

    /**
     * Save Kodiak credentials for a user
     */
    async saveCredentials(credentials: Omit<KodiakCredentials, 'id' | 'createdAt' | 'updatedAt'>): Promise<KodiakCredentials> {
        try {
            const result = await query<{ id: string, created_at: string, updated_at: string }>(
                'INSERT INTO kodiak_credentials (user_id, account_id, api_key_encrypted, secret_key_encrypted, verified, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id, created_at, updated_at',
                [credentials.userId, credentials.accountId, credentials.apiKey, credentials.secretKey, credentials.verified]
            );

            if (result.rows.length === 0) {
                throw new Error('Credentials creation failed - no rows returned');
            }

            const row = result.rows[0];
            return {
                id: row.id,
                userId: credentials.userId,
                accountId: credentials.accountId,
                apiKey: credentials.apiKey,
                secretKey: credentials.secretKey,
                verified: credentials.verified,
                createdAt: new Date(row.created_at),
                updatedAt: new Date(row.updated_at)
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to save Kodiak credentials: ${errorMessage}`);
        }
    }

    /**
     * Update credentials verification status
     */
    async updateVerificationStatus(userId: string, verified: boolean): Promise<void> {
        try {
            const result = await query(
                'UPDATE kodiak_credentials SET verified = $1, updated_at = NOW() WHERE user_id = $2',
                [verified, userId]
            );

            if (result.rowCount === 0) {
                throw new Error('Credentials not found');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update verification status: ${errorMessage}`);
        }
    }

    /**
     * Update wallet address for credentials
     */
    async updateWalletAddress(userId: string, walletAddress: string): Promise<void> {
        try {
            const result = await query(
                'UPDATE kodiak_credentials SET account_id = $1, updated_at = NOW() WHERE user_id = $2',
                [walletAddress, userId]
            );

            if (result.rowCount === 0) {
                throw new Error('Credentials not found');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update wallet address: ${errorMessage}`);
        }
    }

    /**
     * Delete credentials for a user
     */
    async deleteCredentials(userId: string): Promise<void> {
        try {
            const result = await query('DELETE FROM kodiak_credentials WHERE user_id = $1', [userId]);
            if (result.rowCount === 0) {
                throw new Error('Credentials not found');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to delete credentials: ${errorMessage}`);
        }
    }

    /**
     * Map database row to KodiakCredentials object
     */
    private mapRowToCredentials(row: KodiakCredentialsRow): KodiakCredentials {
        return {
            id: row.id,
            userId: row.user_id,
            accountId: row.account_id,
            apiKey: row.api_key_encrypted, // Note: This contains encrypted data
            secretKey: row.secret_key_encrypted, // Note: This contains encrypted data
            verified: row.verified,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }
}

// Export singleton instance
export const kodiakCredentialsRepositoryAdapter = new KodiakCredentialsRepositoryAdapter();