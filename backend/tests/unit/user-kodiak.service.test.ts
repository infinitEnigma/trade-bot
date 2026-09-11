/** @format */

import { UserKodiakService, createUserKodiakService, KodiakUserConfig, KodiakCredentials } from '../../src/core/user/user-kodiak.service';
import { KodiakConnectionStatus, KodiakConnectionResult } from '../../src/infrastructure/external/kodiak-connection.service';

// Mock dependencies
jest.mock('../../src/core/logging', () => ({
    userLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        startOperation: jest.fn().mockReturnValue({
            success: jest.fn(),
            failure: jest.fn()
        })
    }
}));

describe('UserKodiakService', () => {
    let service: UserKodiakService;
    let mockKodiakConnectionService: any;
    let mockCache: any;

    beforeEach(() => {
        // Create mock dependencies
        mockKodiakConnectionService = {
            connectKodiak: jest.fn(),
            disconnectKodiak: jest.fn(),
            getConnectionStatus: jest.fn()
        };

        mockCache = {
            getCachedResult: jest.fn(),
            setCachedResult: jest.fn()
        };

        // Clear any existing cache entries before each test
        jest.clearAllMocks();

        // Create new service instance for each test to ensure fresh cache
        service = createUserKodiakService({
            kodiakConnectionService: mockKodiakConnectionService,
            cache: mockCache
        });
    });

    describe('linkKodiakAccount', () => {
        const mockUserId = 'test-user-id';
        const mockConnectionData = {
            accountId: 'test-account-id',
            apiKey: 'test-api-key',
            secretKey: 'test-secret-key',
            walletSignature: 'test-signature'
        };

        it('should link Kodiak account successfully', async () => {
            const mockResult: KodiakConnectionResult = {
                success: true,
                message: 'Connection successful',
                data: {
                    accountId: mockConnectionData.accountId,
                    verified: true
                }
            };

            mockCache.getCachedResult.mockResolvedValue(null);
            mockKodiakConnectionService.connectKodiak.mockResolvedValue(mockResult);

            const result = await service.linkKodiakAccount(mockUserId, mockConnectionData);

            expect(result).toEqual(mockResult);
            expect(mockCache.getCachedResult).toHaveBeenCalledWith(mockUserId, mockConnectionData.accountId);
            expect(mockKodiakConnectionService.connectKodiak).toHaveBeenCalledWith(mockUserId, mockConnectionData);
            expect(mockCache.setCachedResult).toHaveBeenCalledWith(
                mockUserId,
                mockConnectionData.accountId,
                true,
                undefined
            );
        });

        it('should return cached result if available', async () => {
            const mockCachedResult = {
                success: true,
                error: undefined
            };

            mockCache.getCachedResult.mockResolvedValue(mockCachedResult);

            const result = await service.linkKodiakAccount(mockUserId, mockConnectionData);

            expect(result.success).toBe(true);
            expect(mockKodiakConnectionService.connectKodiak).not.toHaveBeenCalled();
            expect(mockCache.setCachedResult).not.toHaveBeenCalled();
        });

        it('should handle failed Kodiak connection', async () => {
            const mockResult: KodiakConnectionResult = {
                success: false,
                message: 'Connection failed',
                error: 'Invalid credentials'
            };

            mockCache.getCachedResult.mockResolvedValue(null);
            mockKodiakConnectionService.connectKodiak.mockResolvedValue(mockResult);

            const result = await service.linkKodiakAccount(mockUserId, mockConnectionData);

            expect(result).toEqual(mockResult);
            expect(mockCache.setCachedResult).toHaveBeenCalledWith(
                mockUserId,
                mockConnectionData.accountId,
                false,
                'Invalid credentials'
            );
        });

        it('should handle errors during linking process', async () => {
            const testError = new Error('Connection timeout');

            mockCache.getCachedResult.mockRejectedValue(testError);

            const result = await service.linkKodiakAccount(mockUserId, mockConnectionData);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Internal server error during connection');
        });
    });

    describe('unlinkKodiakAccount', () => {
        const mockUserId = 'test-user-id';

        it('should unlink Kodiak account successfully', async () => {
            const mockResult = {
                success: true,
                message: 'Disconnected successfully'
            };

            mockKodiakConnectionService.disconnectKodiak.mockResolvedValue(mockResult);

            const result = await service.unlinkKodiakAccount(mockUserId);

            expect(result).toEqual(mockResult);
            expect(mockKodiakConnectionService.disconnectKodiak).toHaveBeenCalledWith(mockUserId);
        });

        it('should handle failed unlink operation', async () => {
            const mockResult = {
                success: false,
                message: 'Disconnection failed',
                error: 'Connection not found'
            };

            mockKodiakConnectionService.disconnectKodiak.mockResolvedValue(mockResult);

            const result = await service.unlinkKodiakAccount(mockUserId);

            expect(result).toEqual(mockResult);
        });

        it('should handle errors during unlink process', async () => {
            const testError = new Error('Server error');

            mockKodiakConnectionService.disconnectKodiak.mockRejectedValue(testError);

            const result = await service.unlinkKodiakAccount(mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Internal server error during disconnection');
        });
    });

    describe('getKodiakConnectionStatus', () => {
        const mockUserId = 'test-user-id';

        it('should return connection status from cache if valid', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: true,
                verified: true,
                accountId: 'test-account-id'
            };

            // Call the method first to populate cache
            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);
            await service.getKodiakConnectionStatus(mockUserId);

            // Call again should hit cache
            const result = await service.getKodiakConnectionStatus(mockUserId);

            expect(result).toEqual(mockStatus);
            expect(mockKodiakConnectionService.getConnectionStatus).toHaveBeenCalledTimes(1);
        });

        it('should fetch and cache connection status when cache is expired', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: true,
                verified: true,
                accountId: 'test-account-id'
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const result = await service.getKodiakConnectionStatus(mockUserId);

            expect(result).toEqual(mockStatus);
            expect(mockKodiakConnectionService.getConnectionStatus).toHaveBeenCalledWith(mockUserId);
        });

        it('should throw error when getting connection status fails', async () => {
            const testError = new Error('API error');

            mockKodiakConnectionService.getConnectionStatus.mockRejectedValue(testError);

            await expect(service.getKodiakConnectionStatus(mockUserId)).rejects.toThrow(testError);
        });
    });

    describe('getUserKodiakConfig', () => {
        const mockUserId = 'test-user-id';

        it('should return user Kodiak config when connected', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: true,
                verified: true,
                accountId: 'test-account-id'
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const config = await service.getUserKodiakConfig(mockUserId);

            expect(config).not.toBeNull();
            expect(config?.userId).toBe(mockUserId);
            expect(config?.kodiakAccountId).toBe('test-account-id');
            expect(config?.isActive).toBe(true);
            expect(config?.preferences).toEqual({
                defaultLeverage: 5,
                riskLevel: 'medium',
                autoSync: true
            });
        });

        it('should return null when not connected', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: false
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const config = await service.getUserKodiakConfig(mockUserId);

            expect(config).toBeNull();
        });

        it('should return null when no accountId is available', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: true,
                verified: true
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const config = await service.getUserKodiakConfig(mockUserId);

            expect(config).toBeNull();
        });

        it('should handle errors when getting config', async () => {
            const testError = new Error('Database error');

            mockKodiakConnectionService.getConnectionStatus.mockRejectedValue(testError);

            const config = await service.getUserKodiakConfig(mockUserId);

            expect(config).toBeNull();
        });
    });

    describe('updateKodiakPreferences', () => {
        const mockUserId = 'test-user-id';

        it('should update Kodiak preferences successfully', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: true,
                verified: true,
                accountId: 'test-account-id'
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const result = await service.updateKodiakPreferences(mockUserId, {
                defaultLeverage: 10,
                riskLevel: 'high'
            });

            expect(result.success).toBe(true);
            expect(result.message).toBe('Kodiak preferences updated successfully');
        });

        it('should fail to update preferences when not connected', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: false
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const result = await service.updateKodiakPreferences(mockUserId, {
                defaultLeverage: 10
            });

            expect(result.success).toBe(false);
            expect(result.message).toBe('Cannot update preferences - no active Kodiak connection');
        });

        it('should handle errors when updating preferences', async () => {
            const testError = new Error('Update failed');

            mockKodiakConnectionService.getConnectionStatus.mockRejectedValue(testError);

            const result = await service.updateKodiakPreferences(mockUserId, {
                autoSync: false
            });

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to update Kodiak preferences');
        });
    });

    describe('hasVerifiedConnection', () => {
        const mockUserId = 'test-user-id';

        it('should return true for verified connection', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: true,
                verified: true,
                accountId: 'test-account-id'
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const result = await service.hasVerifiedConnection(mockUserId);

            expect(result).toBe(true);
        });

        it('should return false for unverified connection', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: true,
                verified: false,
                accountId: 'test-account-id'
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const result = await service.hasVerifiedConnection(mockUserId);

            expect(result).toBe(false);
        });

        it('should return false for disconnected user', async () => {
            const mockStatus: KodiakConnectionStatus = {
                connected: false
            };

            mockKodiakConnectionService.getConnectionStatus.mockResolvedValue(mockStatus);

            const result = await service.hasVerifiedConnection(mockUserId);

            expect(result).toBe(false);
        });

        it('should handle errors when checking verified connection', async () => {
            const testError = new Error('Check failed');

            mockKodiakConnectionService.getConnectionStatus.mockRejectedValue(testError);

            const result = await service.hasVerifiedConnection(mockUserId);

            expect(result).toBe(false);
        });
    });
});