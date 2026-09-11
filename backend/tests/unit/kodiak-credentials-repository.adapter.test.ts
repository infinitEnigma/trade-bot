/** @format */

import { KodiakCredentialsRepositoryAdapter, kodiakCredentialsRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/kodiak-credentials-repository.adapter';
import { KodiakCredentials } from '@trade-bot/shared';
import { query } from '../../src/database/pool';

// Mock dependencies
jest.mock('../../src/database/pool', () => ({
    query: jest.fn()
}));

describe('KodiakCredentialsRepositoryAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should create a KodiakCredentialsRepositoryAdapter instance', () => {
            const adapter = new KodiakCredentialsRepositoryAdapter();
            expect(adapter).toBeInstanceOf(KodiakCredentialsRepositoryAdapter);
        });

        it('should export a singleton instance', () => {
            expect(kodiakCredentialsRepositoryAdapter).toBeInstanceOf(KodiakCredentialsRepositoryAdapter);
        });
    });

    describe('getCredentials', () => {
        it('should return null when no credentials found for user', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';

            const credentials = await adapter.getCredentials(userId);

            expect(credentials).toBeNull();
            expect(query).toHaveBeenCalled();
        });

        it('should return Kodiak credentials when found', async () => {
            const mockCredentialsRow = {
                id: 'credentials-1',
                user_id: 'test-user-id',
                account_id: 'test-wallet-address',
                api_key_encrypted: 'encrypted-api-key',
                secret_key_encrypted: 'encrypted-secret-key',
                verified: true,
                created_at: '2026-02-04T11:00:00Z',
                updated_at: '2026-02-04T11:00:00Z'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockCredentialsRow] });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';

            const credentials = await adapter.getCredentials(userId);

            expect(credentials).toEqual({
                id: 'credentials-1',
                userId: 'test-user-id',
                accountId: 'test-wallet-address',
                apiKey: 'encrypted-api-key',
                secretKey: 'encrypted-secret-key',
                verified: true,
                createdAt: new Date('2026-02-04T11:00:00Z'),
                updatedAt: new Date('2026-02-04T11:00:00Z')
            });
            expect(credentials).toBeInstanceOf(Object);
            expect(credentials!.id).toBe('credentials-1');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database connection error'));
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';

            await expect(adapter.getCredentials(userId)).rejects.toThrow('Failed to get Kodiak credentials');
        });
    });

    describe('saveCredentials', () => {
        it('should save new Kodiak credentials', async () => {
            const mockCredentials = {
                userId: 'test-user-id',
                accountId: 'test-wallet-address',
                apiKey: 'encrypted-api-key',
                secretKey: 'encrypted-secret-key',
                verified: true
            };
            const savedCredentials = {
                id: 'new-credentials',
                created_at: '2026-02-04T11:00:00Z',
                updated_at: '2026-02-04T11:00:00Z'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [savedCredentials] });
            const adapter = new KodiakCredentialsRepositoryAdapter();

            const result = await adapter.saveCredentials(mockCredentials);

            expect(result).toEqual({
                id: 'new-credentials',
                ...mockCredentials,
                createdAt: new Date('2026-02-04T11:00:00Z'),
                updatedAt: new Date('2026-02-04T11:00:00Z')
            });
            expect(query).toHaveBeenCalled();
        });

        it('should throw error when creation fails', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const mockCredentials = {
                userId: 'test-user-id',
                accountId: 'test-wallet-address',
                apiKey: 'encrypted-api-key',
                secretKey: 'encrypted-secret-key',
                verified: true
            };

            await expect(adapter.saveCredentials(mockCredentials)).rejects.toThrow('Credentials creation failed');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Save failed'));
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const mockCredentials = {
                userId: 'test-user-id',
                accountId: 'test-wallet-address',
                apiKey: 'encrypted-api-key',
                secretKey: 'encrypted-secret-key',
                verified: true
            };

            await expect(adapter.saveCredentials(mockCredentials)).rejects.toThrow('Failed to save Kodiak credentials');
        });
    });

    describe('updateVerificationStatus', () => {
        it('should update verification status to true', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';
            const verified = true;

            await adapter.updateVerificationStatus(userId, verified);

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE kodiak_credentials'),
                expect.arrayContaining([verified, userId])
            );
        });

        it('should update verification status to false', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';
            const verified = false;

            await adapter.updateVerificationStatus(userId, verified);

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE kodiak_credentials'),
                expect.arrayContaining([verified, userId])
            );
        });

        it('should throw error when credentials not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';
            const verified = true;

            await expect(adapter.updateVerificationStatus(userId, verified)).rejects.toThrow('Credentials not found');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Update failed'));
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';
            const verified = true;

            await expect(adapter.updateVerificationStatus(userId, verified)).rejects.toThrow('Failed to update verification status');
        });
    });

    describe('updateWalletAddress', () => {
        it('should update wallet address', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';
            const walletAddress = 'new-wallet-address';

            await adapter.updateWalletAddress(userId, walletAddress);

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE kodiak_credentials'),
                expect.arrayContaining([walletAddress, userId])
            );
        });

        it('should throw error when credentials not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';
            const walletAddress = 'new-wallet-address';

            await expect(adapter.updateWalletAddress(userId, walletAddress)).rejects.toThrow('Credentials not found');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Update failed'));
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';
            const walletAddress = 'new-wallet-address';

            await expect(adapter.updateWalletAddress(userId, walletAddress)).rejects.toThrow('Failed to update wallet address');
        });
    });

    describe('deleteCredentials', () => {
        it('should delete credentials', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';

            await adapter.deleteCredentials(userId);

            expect(query).toHaveBeenCalledWith(
                'DELETE FROM kodiak_credentials WHERE user_id = $1',
                [userId]
            );
        });

        it('should throw error when credentials not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';

            await expect(adapter.deleteCredentials(userId)).rejects.toThrow('Credentials not found');
        });

        it('should throw error when deletion fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Deletion failed'));
            const adapter = new KodiakCredentialsRepositoryAdapter();
            const userId = 'test-user-id';

            await expect(adapter.deleteCredentials(userId)).rejects.toThrow('Failed to delete credentials');
        });
    });
});