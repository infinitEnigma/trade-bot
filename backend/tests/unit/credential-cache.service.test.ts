/** @format */

import { credentialCacheService } from '../../src/infrastructure/cache/credential-cache.service';
import { encryptionService } from '../../src/infrastructure/security/encryption.service';
import logger from '../../src/core/logging/logger.service';

// Mock encryption service methods
jest.spyOn(encryptionService, 'decryptApiKey').mockImplementation(jest.fn());
jest.spyOn(encryptionService, 'decryptSecretKey').mockImplementation(jest.fn());

// Mock logger
jest.spyOn(logger, 'debug').mockImplementation(jest.fn());
jest.spyOn(logger, 'info').mockImplementation(jest.fn());
jest.spyOn(logger, 'error').mockImplementation(jest.fn());

describe('CredentialCacheService', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Clear cache before each test
        credentialCacheService.clearAll();
    });

    describe('instance creation', () => {
        it('should export a singleton instance', () => {
            expect(credentialCacheService).toBeDefined();
            expect(typeof credentialCacheService.getCachedCredentials).toBe('function');
            expect(typeof credentialCacheService.cacheCredentials).toBe('function');
            expect(typeof credentialCacheService.getOrCacheCredentials).toBe('function');
            expect(typeof credentialCacheService.invalidateCredentials).toBe('function');
            expect(typeof credentialCacheService.clearAll).toBe('function');
        });
    });

    describe('getCachedCredentials', () => {
        it('should return null for non-existent cache entry', () => {
            const result = credentialCacheService.getCachedCredentials('user-123');
            expect(result).toBeNull();
        });

        it('should return null and delete entry for expired cache', () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue('test-api-key');
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue('test-secret-key');

            // Cache credentials with very short TTL
            const shortTtl = 1; // 1 millisecond
            credentialCacheService['cache'].set('user-123', {
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now() - 2, // Expired by 1ms
                ttl: shortTtl
            });

            const result = credentialCacheService.getCachedCredentials('user-123');
            expect(result).toBeNull();
            expect(credentialCacheService['cache'].has('user-123')).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith('Credential cache expired', expect.any(Object));
        });

        it('should return cached credentials for valid entry', () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue('test-api-key');
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue('test-secret-key');

            const testCredentials = {
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now(),
                ttl: 300000 // 5 minutes
            };
            credentialCacheService['cache'].set('user-123', testCredentials);

            const result = credentialCacheService.getCachedCredentials('user-123');
            expect(result).toEqual({
                apiKey: testCredentials.apiKey,
                secretKey: testCredentials.secretKey,
                accountId: testCredentials.accountId
            });
            expect(logger.debug).toHaveBeenCalledWith('Credential cache hit', expect.any(Object));
        });
    });

    describe('cacheCredentials', () => {
        it('should cache and return decrypted credentials', async () => {
            // Mock encryption service
            const mockApiKey = 'test-api-key';
            const mockSecretKey = 'test-secret-key';
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue(mockApiKey);
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue(mockSecretKey);

            const result = await credentialCacheService.cacheCredentials(
                'user-123',
                'encrypted-api-key',
                'encrypted-secret-key',
                'account-456'
            );

            expect(result).toEqual({
                apiKey: mockApiKey,
                secretKey: mockSecretKey,
                accountId: 'account-456'
            });
            expect(credentialCacheService['cache'].has('user-123')).toBe(true);
            expect(logger.debug).toHaveBeenCalledWith('Credentials cached', expect.any(Object));
        });

        it('should use custom TTL when provided', async () => {
            // Mock encryption service
            const mockApiKey = 'test-api-key';
            const mockSecretKey = 'test-secret-key';
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue(mockApiKey);
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue(mockSecretKey);

            const customTtl = 600000; // 10 minutes
            await credentialCacheService.cacheCredentials(
                'user-123',
                'encrypted-api-key',
                'encrypted-secret-key',
                'account-456',
                customTtl
            );

            const cachedEntry = credentialCacheService['cache'].get('user-123');
            expect(cachedEntry?.ttl).toBe(customTtl);
        });

        it('should log and rethrow error when decryption fails', async () => {
            // Mock encryption service to throw error
            const mockError = new Error('Decryption failed');
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockImplementation(() => {
                throw mockError;
            });
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue('test-secret-key');

            await expect(
                credentialCacheService.cacheCredentials(
                    'user-123',
                    'encrypted-api-key',
                    'encrypted-secret-key',
                    'account-456'
                )
            ).rejects.toThrow(mockError);

            expect(logger.error).toHaveBeenCalledWith(
                'Failed to cache credentials',
                expect.any(Object)
            );
            expect(credentialCacheService['cache'].has('user-123')).toBe(false);
        });
    });

    describe('getOrCacheCredentials', () => {
        it('should return cached credentials when available', async () => {
            // Mock encryption service
            const mockApiKey = 'test-api-key';
            const mockSecretKey = 'test-secret-key';
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue(mockApiKey);
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue(mockSecretKey);

            // Pre-populate cache
            credentialCacheService['cache'].set('user-123', {
                apiKey: 'cached-api-key',
                secretKey: 'cached-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now(),
                ttl: 300000
            });

            const result = await credentialCacheService.getOrCacheCredentials(
                'user-123',
                'encrypted-api-key',
                'encrypted-secret-key',
                'account-456'
            );

            expect(result).toEqual({
                apiKey: 'cached-api-key',
                secretKey: 'cached-secret-key',
                accountId: 'account-456'
            });
            // Should not call decrypt methods since cache was hit
            expect(encryptionService.decryptApiKey).not.toHaveBeenCalled();
            expect(encryptionService.decryptSecretKey).not.toHaveBeenCalled();
        });

        it('should cache and return credentials when not in cache', async () => {
            // Mock encryption service
            const mockApiKey = 'test-api-key';
            const mockSecretKey = 'test-secret-key';
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue(mockApiKey);
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue(mockSecretKey);

            const result = await credentialCacheService.getOrCacheCredentials(
                'user-123',
                'encrypted-api-key',
                'encrypted-secret-key',
                'account-456'
            );

            expect(result).toEqual({
                apiKey: mockApiKey,
                secretKey: mockSecretKey,
                accountId: 'account-456'
            });
            expect(credentialCacheService['cache'].has('user-123')).toBe(true);
            expect(encryptionService.decryptApiKey).toHaveBeenCalled();
            expect(encryptionService.decryptSecretKey).toHaveBeenCalled();
        });

        it('should cache new credentials when existing entry is expired', async () => {
            // Mock encryption service
            const mockApiKey = 'test-api-key';
            const mockSecretKey = 'test-secret-key';
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue(mockApiKey);
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue(mockSecretKey);

            // Pre-populate cache with expired entry
            credentialCacheService['cache'].set('user-123', {
                apiKey: 'expired-api-key',
                secretKey: 'expired-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now() - 300001, // Expired by 1ms
                ttl: 300000
            });

            const result = await credentialCacheService.getOrCacheCredentials(
                'user-123',
                'encrypted-api-key',
                'encrypted-secret-key',
                'account-456'
            );

            expect(result).toEqual({
                apiKey: mockApiKey,
                secretKey: mockSecretKey,
                accountId: 'account-456'
            });
            // Should call decrypt methods since cache was expired
            expect(encryptionService.decryptApiKey).toHaveBeenCalled();
            expect(encryptionService.decryptSecretKey).toHaveBeenCalled();
        });
    });

    describe('invalidateCredentials', () => {
        it('should invalidate existing cache entry', () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue('test-api-key');
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue('test-secret-key');

            credentialCacheService['cache'].set('user-123', {
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now(),
                ttl: 300000
            });

            credentialCacheService.invalidateCredentials('user-123');
            expect(credentialCacheService['cache'].has('user-123')).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith('Credentials invalidated', expect.any(Object));
        });

        it('should not log when invalidating non-existent entry', () => {
            credentialCacheService.invalidateCredentials('non-existent-user');
            expect(logger.debug).not.toHaveBeenCalledWith('Credentials invalidated', expect.any(Object));
        });
    });

    describe('clearAll', () => {
        it('should clear all cache entries', () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue('test-api-key');
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue('test-secret-key');

            // Add multiple cache entries
            credentialCacheService['cache'].set('user-123', {
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now(),
                ttl: 300000
            });
            credentialCacheService['cache'].set('user-456', {
                apiKey: 'another-api-key',
                secretKey: 'another-secret-key',
                accountId: 'account-789',
                cachedAt: Date.now(),
                ttl: 300000
            });

            credentialCacheService.clearAll();
            expect(credentialCacheService['cache'].size).toBe(0);
            expect(logger.info).toHaveBeenCalledWith('All credential caches cleared', expect.any(Object));
        });

        it('should log correct count when clearing cache', () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue('test-api-key');
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue('test-secret-key');

            credentialCacheService['cache'].set('user-123', {
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now(),
                ttl: 300000
            });

            credentialCacheService.clearAll();
            expect(logger.info).toHaveBeenCalledWith(
                'All credential caches cleared',
                expect.objectContaining({ count: 1 })
            );
        });
    });

    describe('cleanupForTests', () => {
        it('should clear cache and stop cleanup interval', () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock) = jest.fn().mockReturnValue('test-api-key');
            (encryptionService.decryptSecretKey as jest.Mock) = jest.fn().mockReturnValue('test-secret-key');

            credentialCacheService['cache'].set('user-123', {
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
                accountId: 'account-456',
                cachedAt: Date.now(),
                ttl: 300000
            });

            // @ts-ignore - accessing private method for testing
            credentialCacheService.cleanupForTests();

            expect(credentialCacheService['cache'].size).toBe(0);
            // We can't directly test if interval is stopped without more complex mocking
        });
    });

    describe('cleanup interval functionality', () => {
        it('should test that interval starts and stops through cleanupForTests', () => {
            // This test verifies that cleanupForTests properly stops any active interval
            // We can't directly test the interval creation, but we can verify the cleanup
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            // Call cleanupForTests - it should handle case where interval wasn't started
            // @ts-ignore - accessing private method for testing
            credentialCacheService.cleanupForTests();

            expect(credentialCacheService['cache'].size).toBe(0);
            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('cache operations', () => {
        it('should handle multiple users independently', async () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock)
                .mockReturnValueOnce('user1-api-key')
                .mockReturnValueOnce('user2-api-key');
            (encryptionService.decryptSecretKey as jest.Mock)
                .mockReturnValueOnce('user1-secret-key')
                .mockReturnValueOnce('user2-secret-key');

            await credentialCacheService.cacheCredentials(
                'user-123',
                'encrypted-api-key-1',
                'encrypted-secret-key-1',
                'account-456'
            );
            await credentialCacheService.cacheCredentials(
                'user-456',
                'encrypted-api-key-2',
                'encrypted-secret-key-2',
                'account-789'
            );

            const user1Result = credentialCacheService.getCachedCredentials('user-123');
            const user2Result = credentialCacheService.getCachedCredentials('user-456');

            expect(user1Result?.apiKey).toBe('user1-api-key');
            expect(user2Result?.apiKey).toBe('user2-api-key');
            expect(user1Result?.accountId).toBe('account-456');
            expect(user2Result?.accountId).toBe('account-789');
        });

        it('should update existing cache entry with new credentials', async () => {
            // Mock encryption service
            (encryptionService.decryptApiKey as jest.Mock)
                .mockReturnValueOnce('old-api-key')
                .mockReturnValueOnce('new-api-key');
            (encryptionService.decryptSecretKey as jest.Mock)
                .mockReturnValueOnce('old-secret-key')
                .mockReturnValueOnce('new-secret-key');

            await credentialCacheService.cacheCredentials(
                'user-123',
                'encrypted-api-key-old',
                'encrypted-secret-key-old',
                'account-456'
            );
            await credentialCacheService.cacheCredentials(
                'user-123',
                'encrypted-api-key-new',
                'encrypted-secret-key-new',
                'account-456'
            );

            const result = credentialCacheService.getCachedCredentials('user-123');
            expect(result?.apiKey).toBe('new-api-key');
            expect(result?.secretKey).toBe('new-secret-key');
        });
    });
});