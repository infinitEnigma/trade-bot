/** @format */

import { KodiakConnectionService } from '../../src/infrastructure/external/kodiak-connection.service';
import { query } from '../../src/database/pool';
import { selectAuthService } from '../../src/core/service-selector';
import { kodiakIntegrationService } from '../../src/infrastructure/external/kodiak-integration.service';
import { encryptionService } from '../../src/infrastructure/security/encryption.service';
import { logger } from '../../src/core/logging';
import { UserLevel } from '../../../shared/src';

// Define missing UserLevel values for testing
const TestUserLevel = {
    ...UserLevel,
    PREMIUM: 'PREMIUM' as const,
    ADMIN: 'ADMIN' as const,
};

// Mock dependencies
jest.mock('../../src/database/pool');
jest.mock('../../src/core/service-selector');
jest.mock('../../src/infrastructure/external/kodiak-integration.service');
jest.mock('../../src/infrastructure/security/encryption.service');
jest.mock('../../src/core/logging');

describe('KodiakConnectionService', () => {
    let service: KodiakConnectionService;

    beforeEach(() => {
        service = new KodiakConnectionService();
        jest.clearAllMocks();
    });

    describe('connectKodiak', () => {
        const mockConnectionData = {
            accountId: 'test-account-id',
            apiKey: 'test-api-key',
            secretKey: 'test-secret-key',
            walletSignature: 'test-signature',
        };

        it('should successfully connect and verify Kodiak credentials', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.BASIC,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
                invalidateUserDataCache: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);
            (kodiakIntegrationService.testConnectivity as jest.Mock).mockResolvedValue({
                success: true,
            });
            (encryptionService.encryptApiKey as jest.Mock).mockReturnValue('encrypted-api-key');
            (encryptionService.encryptSecretKey as jest.Mock).mockReturnValue('encrypted-secret-key');
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            const result = await service.connectKodiak('test-user-id', mockConnectionData);

            expect(result.success).toBe(true);
            expect(result.message).toBe('Kodiak credentials connected and verified successfully');
            expect(result.data?.verified).toBe(true);
            expect(result.data?.userLevel).toBe('REGISTERED');

            // Verify database operations
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO kodiak_credentials'),
                expect.arrayContaining([
                    'test-user-id',
                    'test-account-id',
                    'encrypted-api-key',
                    'encrypted-secret-key',
                    'test-signature',
                    true, // verified
                ])
            );

            // Verify user level update
            expect(mockAuthService.updateUserLevel).toHaveBeenCalledWith(
                'test-user-id',
                UserLevel.REGISTERED
            );
            expect(mockAuthService.invalidateUserDataCache).toHaveBeenCalledWith('test-user-id');
        });

        it('should store credentials but mark as unverified when verification fails', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.BASIC,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
                invalidateUserDataCache: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);
            (kodiakIntegrationService.testConnectivity as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Invalid API key',
            });
            (encryptionService.encryptApiKey as jest.Mock).mockReturnValue('encrypted-api-key');
            (encryptionService.encryptSecretKey as jest.Mock).mockReturnValue('encrypted-secret-key');
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            const result = await service.connectKodiak('test-user-id', mockConnectionData);

            expect(result.success).toBe(false);
            expect(result.message).toBe('Kodiak credentials stored but verification failed. Please check your credentials.');
            expect(result.data?.verified).toBe(false);
            expect(result.error).toBe('Invalid API key');

            // Verify credentials were stored but marked as unverified
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO kodiak_credentials'),
                expect.arrayContaining([
                    'test-user-id',
                    'test-account-id',
                    'encrypted-api-key',
                    'encrypted-secret-key',
                    'test-signature',
                    false, // verified = false
                ])
            );

            // User level should not be updated
            expect(mockAuthService.updateUserLevel).not.toHaveBeenCalled();
        });

        it('should validate input data before processing', async () => {
            const invalidConnectionData = {
                accountId: '',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await service.connectKodiak('test-user-id', invalidConnectionData);

            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid connection data');
            expect(result.error).toBe('Account ID, API key, and secret key are required');
            expect(query).not.toHaveBeenCalled();
        });

        it('should handle database errors gracefully', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.BASIC,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
                invalidateUserDataCache: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);
            (kodiakIntegrationService.testConnectivity as jest.Mock).mockResolvedValue({
                success: true,
            });
            (encryptionService.encryptApiKey as jest.Mock).mockReturnValue('encrypted-api-key');
            (encryptionService.encryptSecretKey as jest.Mock).mockReturnValue('encrypted-secret-key');
            (query as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

            const result = await service.connectKodiak('test-user-id', mockConnectionData);

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to connect Kodiak credentials');
            expect(result.error).toBe('Internal server error during connection');
            expect(logger.error).toHaveBeenCalledWith('Kodiak connection error', {
                userId: 'test-user-id',
                accountId: 'test-account-id',
                error: 'Database connection failed',
            });
        });

        it('should fetch and store wallet address from Kodiak API', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.BASIC,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
                invalidateUserDataCache: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);
            (kodiakIntegrationService.testConnectivity as jest.Mock).mockResolvedValue({
                success: true,
            });
            (kodiakIntegrationService.getPublicAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: {
                    address: '0x1234567890abcdef1234567890abcdef12345678',
                    account_id: 'test-account-id',
                },
            });
            (encryptionService.encryptApiKey as jest.Mock).mockReturnValue('encrypted-api-key');
            (encryptionService.encryptSecretKey as jest.Mock).mockReturnValue('encrypted-secret-key');
            (query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] }) // Initial insert
                .mockResolvedValueOnce({ rows: [] }); // Wallet address update

            const result = await service.connectKodiak('test-user-id', mockConnectionData);

            expect(result.success).toBe(true);
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE kodiak_credentials SET wallet_address'),
                expect.arrayContaining([
                    '0x1234567890abcdef1234567890abcdef12345678',
                    'test-user-id',
                ])
            );
        });

        it('should handle wallet address fetching errors gracefully', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.BASIC,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
                invalidateUserDataCache: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);
            (kodiakIntegrationService.testConnectivity as jest.Mock).mockResolvedValue({
                success: true,
            });
            (kodiakIntegrationService.getPublicAccountInfo as jest.Mock).mockResolvedValue({
                success: false,
                error: 'API error',
            });
            (encryptionService.encryptApiKey as jest.Mock).mockReturnValue('encrypted-api-key');
            (encryptionService.encryptSecretKey as jest.Mock).mockReturnValue('encrypted-secret-key');
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            const result = await service.connectKodiak('test-user-id', mockConnectionData);

            expect(result.success).toBe(true);
            expect(logger.error).toHaveBeenCalledWith('Failed to fetch and store wallet address', {
                userId: 'test-user-id',
                accountId: 'test-account-id',
                error: 'API error',
            });
        });
    });

    describe('disconnectKodiak', () => {
        it('should successfully disconnect Kodiak and downgrade user level', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.REGISTERED,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
                invalidateUserDataCache: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            const result = await service.disconnectKodiak('test-user-id');

            expect(result.success).toBe(true);
            expect(result.message).toBe('Kodiak credentials disconnected');

            // Verify credentials deletion
            expect(query).toHaveBeenCalledWith(
                'DELETE FROM kodiak_credentials WHERE user_id = $1',
                ['test-user-id']
            );

            // Verify user level downgrade
            expect(mockAuthService.updateUserLevel).toHaveBeenCalledWith(
                'test-user-id',
                UserLevel.BASIC
            );
            expect(mockAuthService.invalidateUserDataCache).toHaveBeenCalledWith('test-user-id');
        });

        it('should handle database errors during disconnection', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.REGISTERED,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
                invalidateUserDataCache: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.disconnectKodiak('test-user-id');

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to disconnect Kodiak credentials');
            expect(result.error).toBe('Internal server error during disconnection');
            expect(logger.error).toHaveBeenCalledWith('Kodiak disconnection error', {
                userId: 'test-user-id',
                error: 'Database error',
            });
        });
    });

    describe('getConnectionStatus', () => {
        it('should return connected status with verified credentials', async () => {
            const mockRow = {
                account_id: 'test-account-id',
                verified: true,
                created_at: '2023-01-01T00:00:00Z',
            };

            (query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

            const result = await service.getConnectionStatus('test-user-id');

            expect(result).toEqual({
                connected: true,
                accountId: 'test-account-id',
                verified: true,
                connectedAt: '2023-01-01T00:00:00Z',
            });
        });

        it('should return disconnected status when no credentials found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            const result = await service.getConnectionStatus('test-user-id');

            expect(result).toEqual({ connected: false });
        });

        it('should handle database errors gracefully', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.getConnectionStatus('test-user-id');

            expect(result).toEqual({ connected: false });
            expect(logger.error).toHaveBeenCalledWith('Failed to get Kodiak connection status', {
                userId: 'test-user-id',
                error: 'Database error',
            });
        });
    });

    describe('hasVerifiedConnection', () => {
        it('should return true when user has verified connection', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [{ verified: true }] });

            const result = await service.hasVerifiedConnection('test-user-id');

            expect(result).toBe(true);
        });

        it('should return false when user has no verified connection', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            const result = await service.hasVerifiedConnection('test-user-id');

            expect(result).toBe(false);
        });

        it('should handle database errors gracefully', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.hasVerifiedConnection('test-user-id');

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalledWith('Failed to check Kodiak connection status', {
                userId: 'test-user-id',
                error: 'Database error',
            });
        });
    });

    describe('getConnectionStats', () => {
        it('should return connection statistics', async () => {
            (query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ count: '10' }] }) // totalConnections
                .mockResolvedValueOnce({ rows: [{ count: '8' }] }) // verifiedConnections
                .mockResolvedValueOnce({ rows: [{ count: '2' }] }); // pendingConnections

            const result = await service.getConnectionStats();

            expect(result).toEqual({
                totalConnections: 10,
                verifiedConnections: 8,
                pendingConnections: 2,
            });
        });

        it('should handle database errors gracefully', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.getConnectionStats();

            expect(result).toEqual({
                totalConnections: 0,
                verifiedConnections: 0,
                pendingConnections: 0,
            });
            expect(logger.error).toHaveBeenCalledWith('Failed to get connection stats', {
                error: 'Database error',
            });
        });
    });

    describe('cleanupInvalidConnections', () => {
        it('should clean up unverified connections older than 30 days', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 5 });

            const result = await service.cleanupInvalidConnections();

            expect(result).toEqual({ cleaned: 5 });
            expect(logger.info).toHaveBeenCalledWith('Cleaned up invalid Kodiak connections', {
                cleanedCount: 5,
                olderThan: expect.any(String),
            });
        });

        it('should handle database errors gracefully', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.cleanupInvalidConnections();

            expect(result).toEqual({ cleaned: 0 });
            expect(logger.error).toHaveBeenCalledWith('Failed to cleanup invalid connections', {
                error: 'Database error',
            });
        });
    });

    describe('reverifyConnections', () => {
        it('should re-verify existing connections', async () => {
            const mockConnections = {
                rows: [
                    { user_id: 'user1', account_id: 'account1' },
                    { user_id: 'user2', account_id: 'account2' },
                ],
            };

            (query as jest.Mock)
                .mockResolvedValueOnce(mockConnections) // Get connections
                .mockResolvedValueOnce({ rows: [{ account_id: 'user1', api_key_encrypted: 'key1', secret_key_encrypted: 'secret1' }] }) // getUserCredentials for user1
                .mockResolvedValueOnce({ rows: [{ account_id: 'user2', api_key_encrypted: 'key2', secret_key_encrypted: 'secret2' }] }) // getUserCredentials for user2
                .mockResolvedValueOnce({ rows: [] }) // Update user1 (success)
                .mockResolvedValueOnce({ rows: [] }); // Update user2 (fail)

            (kodiakIntegrationService.getUserCredentials as jest.Mock)
                .mockResolvedValueOnce({
                    accountId: 'account1',
                    apiKey: 'decrypted-key1',
                    secretKey: 'decrypted-secret1',
                })
                .mockResolvedValueOnce({
                    accountId: 'account2',
                    apiKey: 'decrypted-key2',
                    secretKey: 'decrypted-secret2',
                });

            (kodiakIntegrationService.testConnectivity as jest.Mock)
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: false });

            const result = await service.reverifyConnections();

            expect(result).toEqual({ reVerified: 1, failed: 1 });
            expect(logger.info).toHaveBeenCalledWith('Connection re-verification completed', {
                totalChecked: 2,
                reVerified: 1,
                failed: 1,
            });
        });

        it('should handle database errors gracefully', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.reverifyConnections();

            expect(result).toEqual({ reVerified: 0, failed: 0 });
            expect(logger.error).toHaveBeenCalledWith('Failed to re-verify connections', {
                error: 'Database error',
            });
        });
    });

    describe('validateConnectionData', () => {
        it('should validate valid connection data', () => {
            const result = (service as any).validateConnectionData({
                accountId: 'test-account-id',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            });

            expect(result).toEqual({ valid: true });
        });

        it('should reject connection data with missing fields', () => {
            const result = (service as any).validateConnectionData({
                accountId: '',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            });

            expect(result).toEqual({
                valid: false,
                error: 'Account ID, API key, and secret key are required',
            });
        });

        it('should reject connection data with invalid format', () => {
            const result = (service as any).validateConnectionData({
                accountId: 'short',
                apiKey: 'short',
                secretKey: 'short',
            });

            expect(result).toEqual({
                valid: false,
                error: 'Account ID appears to be invalid',
            });
        });
    });

    describe('updateUserLevel', () => {
        it('should update user level successfully', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.BASIC,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);

            await (service as any).updateUserLevel('test-user-id', UserLevel.REGISTERED);

            expect(mockAuthService.updateUserLevel).toHaveBeenCalledWith(
                'test-user-id',
                UserLevel.REGISTERED
            );
            expect(logger.info).toHaveBeenCalledWith('User level updated from BASIC to REGISTERED', {
                userId: 'test-user-id',
            });
        });

        it('should not update if level is already the same', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.REGISTERED,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);

            await (service as any).updateUserLevel('test-user-id', UserLevel.REGISTERED);

            expect(mockAuthService.updateUserLevel).not.toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith('User level already REGISTERED, no update needed', {
                userId: 'test-user-id',
            });
        });

        it('should handle invalid level transitions', async () => {
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({
                    userLevel: UserLevel.REGISTERED,
                }),
                updateUserLevel: jest.fn().mockResolvedValue(undefined),
            };

            (selectAuthService as jest.Mock).mockReturnValue(mockAuthService);

            await expect(
                (service as any).updateUserLevel('test-user-id', UserLevel.BASIC)
            ).rejects.toThrow('Invalid user level transition from REGISTERED to BASIC');

            expect(mockAuthService.updateUserLevel).not.toHaveBeenCalled();
        });
    });

    describe('isValidLevelTransition', () => {
        it('should validate valid level transitions', () => {
            expect((service as any).isValidLevelTransition(UserLevel.BASIC, UserLevel.REGISTERED)).toBe(true);
            expect((service as any).isValidLevelTransition(UserLevel.REGISTERED, UserLevel.VERIFIED)).toBe(true);
            expect((service as any).isValidLevelTransition(UserLevel.VERIFIED, TestUserLevel.PREMIUM)).toBe(true);
        });

        it('should reject invalid level transitions', () => {
            expect((service as any).isValidLevelTransition(UserLevel.REGISTERED, UserLevel.BASIC)).toBe(false);
            expect((service as any).isValidLevelTransition(TestUserLevel.PREMIUM, UserLevel.VERIFIED)).toBe(false);
            expect((service as any).isValidLevelTransition(UserLevel.BASIC, TestUserLevel.PREMIUM)).toBe(false);
        });
    });

    describe('fetchAndStoreWalletAddress', () => {
        it('should fetch and store wallet address successfully', async () => {
            const mockCredentials = {
                accountId: 'test-account-id',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            (kodiakIntegrationService.getPublicAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: {
                    address: '0x1234567890abcdef1234567890abcdef12345678',
                    account_id: 'test-account-id',
                },
            });
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            await (service as any).fetchAndStoreWalletAddress('test-user-id', mockCredentials);

            expect(query).toHaveBeenCalledWith(
                'UPDATE kodiak_credentials SET wallet_address = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                ['0x1234567890abcdef1234567890abcdef12345678', 'test-user-id']
            );
            expect(logger.info).toHaveBeenCalledWith('Wallet address fetched and stored from Kodiak public API', {
                userId: 'test-user-id',
                accountId: 'test-account-id',
                walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
            });
        });

        it('should handle invalid wallet address format', async () => {
            const mockCredentials = {
                accountId: 'test-account-id',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            (kodiakIntegrationService.getPublicAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: {
                    address: 'invalid-address',
                    account_id: 'test-account-id',
                },
            });

            await (service as any).fetchAndStoreWalletAddress('test-user-id', mockCredentials);

            expect(query).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith('Invalid wallet address format from Kodiak API', {
                userId: 'test-user-id',
                accountId: 'test-account-id',
                walletAddress: 'invalid-address',
            });
        });

        it('should handle API errors gracefully', async () => {
            const mockCredentials = {
                accountId: 'test-account-id',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            (kodiakIntegrationService.getPublicAccountInfo as jest.Mock).mockResolvedValue({
                success: false,
                error: 'API error',
            });

            await (service as any).fetchAndStoreWalletAddress('test-user-id', mockCredentials);

            expect(logger.error).toHaveBeenCalledWith('Failed to fetch and store wallet address', {
                userId: 'test-user-id',
                accountId: 'test-account-id',
                error: 'API error',
            });
        });
    });
});