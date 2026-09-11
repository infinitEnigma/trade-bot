/** @format */

import { RedisCacheManager, CacheResult } from '../../src/infrastructure/cache/redis/cache-manager';
import { RedisConnectionManager } from '../../src/infrastructure/cache/redis/connection-manager';
import { RedisTransactions } from '../../src/infrastructure/cache/redis/transactions';

// Mock dependencies
jest.mock('../../src/core/logging');

describe('RedisCacheManager', () => {
    let cacheManager: RedisCacheManager;
    let mockConnectionManager: jest.Mocked<RedisConnectionManager>;
    let mockTransactions: jest.Mocked<RedisTransactions>;
    let mockClient: any;

    beforeEach(() => {
        // Create mock connection manager
        mockClient = {
            set: jest.fn(),
            setEx: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
            mSet: jest.fn(),
            mGet: jest.fn(),
            exists: jest.fn(),
            ttl: jest.fn(),
            multi: jest.fn()
        };

        mockConnectionManager = {
            getClient: jest.fn().mockReturnValue(mockClient)
        } as unknown as jest.Mocked<RedisConnectionManager>;

        // Create mock transactions
        mockTransactions = {
            watchMultiExec: jest.fn()
        } as unknown as jest.Mocked<RedisTransactions>;

        cacheManager = new RedisCacheManager(mockConnectionManager, mockTransactions);
    });

    describe('instance creation', () => {
        it('should create an instance of RedisCacheManager', () => {
            expect(cacheManager).toBeInstanceOf(RedisCacheManager);
        });
    });

    describe('set', () => {
        it('should store data in cache without TTL', async () => {
            mockClient.set.mockResolvedValue('OK');

            const result = await cacheManager.set('test-key', { data: 'test' });

            expect(result).toEqual({ success: true });
            expect(mockClient.set).toHaveBeenCalledWith('test-key', JSON.stringify({ data: 'test' }));
        });

        it('should store data in cache with TTL', async () => {
            mockClient.setEx.mockResolvedValue('OK');

            const result = await cacheManager.set('test-key', { data: 'test' }, 3600);

            expect(result).toEqual({ success: true });
            expect(mockClient.setEx).toHaveBeenCalledWith('test-key', 3600, JSON.stringify({ data: 'test' }));
        });

        it('should handle cache set failure', async () => {
            mockClient.set.mockResolvedValue('ERROR');

            const result = await cacheManager.set('test-key', { data: 'test' });

            expect(result).toEqual({ success: false, error: 'Cache set failed' });
        });

        it('should handle cache set exception', async () => {
            const testError = new Error('Redis connection error');
            mockClient.set.mockRejectedValue(testError);

            const result = await cacheManager.set('test-key', { data: 'test' });

            expect(result).toEqual({ success: false, error: testError.message });
        });
    });

    describe('get', () => {
        it('should retrieve data from cache', async () => {
            const testData = { data: 'test' };
            mockClient.get.mockResolvedValue(JSON.stringify(testData));

            const result = await cacheManager.get('test-key');

            expect(result).toEqual({
                success: true,
                data: testData,
                fromCache: true
            });
        });

        it('should handle cache miss', async () => {
            mockClient.get.mockResolvedValue(null);

            const result = await cacheManager.get('test-key');

            expect(result).toEqual({
                success: true,
                data: null,
                fromCache: false
            });
        });

        it('should handle invalid JSON data', async () => {
            mockClient.get.mockResolvedValue('invalid-json');

            const result = await cacheManager.get('test-key');

            expect(result).toEqual({
                success: false,
                error: 'Failed to parse cached data'
            });
        });

        it('should handle get exception', async () => {
            const testError = new Error('Redis connection error');
            mockClient.get.mockRejectedValue(testError);

            const result = await cacheManager.get('test-key');

            expect(result).toEqual({
                success: false,
                error: testError.message
            });
        });
    });

    describe('atomicCacheUpdate', () => {
        it('should perform atomic cache update without versioning', async () => {
            const testData = { data: 'test' };
            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: 1
            });

            const result = await cacheManager.atomicCacheUpdate('test-key', testData);

            expect(result).toEqual({
                success: true,
                version: 1
            });
            expect(mockTransactions.watchMultiExec).toHaveBeenCalled();
        });

        it('should perform atomic cache update with versioning', async () => {
            const testData = { data: 'test' };
            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: 2
            });

            const result = await cacheManager.atomicCacheUpdate('test-key', testData, 'test-key-version');

            expect(result).toEqual({
                success: true,
                version: 2
            });
            expect(mockTransactions.watchMultiExec).toHaveBeenCalled();
        });

        it('should handle atomic cache update failure', async () => {
            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: 'Transaction failed'
            });

            const result = await cacheManager.atomicCacheUpdate('test-key', { data: 'test' });

            expect(result).toEqual({
                success: false,
                error: 'Transaction failed'
            });
        });
    });

    describe('getWithVersion', () => {
        it('should get cache entry without version', async () => {
            const testData = { data: 'test' };
            mockClient.get.mockResolvedValue(JSON.stringify(testData));

            const result = await cacheManager.getWithVersion('test-key');

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ ...testData, version: undefined });
            expect(result.version).toBeUndefined();
        });

        it('should get cache entry with version', async () => {
            const testData = { data: 'test' };
            mockClient.get.mockImplementation((key: string) => {
                if (key === 'test-key') {
                    return Promise.resolve(JSON.stringify(testData));
                } else if (key === 'test-key-version') {
                    return Promise.resolve('1');
                }
                return Promise.resolve(null);
            });

            const result = await cacheManager.getWithVersion('test-key', 'test-key-version');

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ ...testData, version: 1 });
            expect(result.version).toBe(1);
        });

        it('should handle cache miss in getWithVersion', async () => {
            mockClient.get.mockResolvedValue(null);

            const result = await cacheManager.getWithVersion('test-key');

            expect(result).toEqual({
                success: false,
                error: 'Cache miss or data not found'
            });
        });

        it('should handle getWithVersion exception', async () => {
            const testError = new Error('Redis connection error');
            // Make the first call (for version) reject
            mockClient.get.mockImplementationOnce(() => Promise.reject(testError));

            const result = await cacheManager.getWithVersion('test-key', 'test-key-version');

            expect(result).toEqual({
                success: false,
                error: testError.message
            });
        });
    });

    describe('atomicInvalidate', () => {
        it('should invalidate multiple keys', async () => {
            const mockMulti = {
                del: jest.fn().mockReturnThis(),
                setEx: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([])
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const result = await cacheManager.atomicInvalidate(['key1', 'key2'], 'test-reason');

            expect(result).toEqual({
                success: true,
                data: 2
            });
            expect(mockClient.multi).toHaveBeenCalled();
            expect(mockMulti.del).toHaveBeenCalledWith('key1');
            expect(mockMulti.del).toHaveBeenCalledWith('key2');
            expect(mockMulti.exec).toHaveBeenCalled();
        });

        it('should handle empty keys array', async () => {
            const result = await cacheManager.atomicInvalidate([], 'test-reason');

            expect(result).toEqual({
                success: true,
                data: 0
            });
        });

        it('should handle atomic invalidate exception', async () => {
            const testError = new Error('Redis connection error');
            mockClient.multi.mockImplementation(() => {
                throw testError;
            });

            const result = await cacheManager.atomicInvalidate(['key1', 'key2'], 'test-reason');

            expect(result).toEqual({
                success: false,
                error: testError.message,
                data: 0
            });
        });
    });

    describe('mset', () => {
        it('should set multiple key-value pairs without TTL', async () => {
            const testData = {
                'key1': { data: 'test1' },
                'key2': { data: 'test2' }
            };
            mockClient.mSet.mockResolvedValue('OK');

            const result = await cacheManager.mset(testData);

            expect(result).toEqual({ success: true });
            expect(mockClient.mSet).toHaveBeenCalledWith({
                'key1': JSON.stringify(testData['key1']),
                'key2': JSON.stringify(testData['key2'])
            });
        });

        it('should set multiple key-value pairs with TTL', async () => {
            const testData = {
                'key1': { data: 'test1' },
                'key2': { data: 'test2' }
            };
            mockClient.setEx.mockResolvedValue('OK');

            const result = await cacheManager.mset(testData, 3600);

            expect(result).toEqual({ success: true });
            expect(mockClient.setEx).toHaveBeenCalledWith('key1', 3600, JSON.stringify(testData['key1']));
            expect(mockClient.setEx).toHaveBeenCalledWith('key2', 3600, JSON.stringify(testData['key2']));
        });

        it('should handle mset exception', async () => {
            const testError = new Error('Redis connection error');
            mockClient.mSet.mockRejectedValue(testError);

            const result = await cacheManager.mset({ 'key1': { data: 'test' } });

            expect(result).toEqual({
                success: false,
                error: testError.message
            });
        });
    });

    describe('mget', () => {
        it('should get multiple cache entries', async () => {
            const testData = {
                'key1': { data: 'test1' },
                'key2': { data: 'test2' }
            };
            mockClient.mGet.mockResolvedValue([
                JSON.stringify(testData['key1']),
                JSON.stringify(testData['key2'])
            ]);

            const result = await cacheManager.mget(['key1', 'key2']);

            expect(result).toEqual({
                success: true,
                data: testData,
                fromCache: true
            });
        });

        it('should handle some keys not found in mget', async () => {
            mockClient.mGet.mockResolvedValue([JSON.stringify({ data: 'test1' }), null]);

            const result = await cacheManager.mget(['key1', 'key2']);

            expect(result).toEqual({
                success: true,
                data: { 'key1': { data: 'test1' } },
                fromCache: true
            });
        });

        it('should handle invalid JSON in mget', async () => {
            mockClient.mGet.mockResolvedValue(['invalid-json', JSON.stringify({ data: 'test2' })]);

            const result = await cacheManager.mget(['key1', 'key2']);

            expect(result).toEqual({
                success: true,
                data: { 'key2': { data: 'test2' } },
                fromCache: true
            });
        });

        it('should handle mget exception', async () => {
            const testError = new Error('Redis connection error');
            mockClient.mGet.mockRejectedValue(testError);

            const result = await cacheManager.mget(['key1', 'key2']);

            expect(result).toEqual({
                success: false,
                error: testError.message
            });
        });
    });

    describe('exists', () => {
        it('should check if key exists (key exists)', async () => {
            mockClient.exists.mockResolvedValue(1);

            const result = await cacheManager.exists('test-key');

            expect(result).toEqual({
                success: true,
                data: true
            });
        });

        it('should check if key exists (key does not exist)', async () => {
            mockClient.exists.mockResolvedValue(0);

            const result = await cacheManager.exists('test-key');

            expect(result).toEqual({
                success: true,
                data: false
            });
        });

        it('should handle exists exception', async () => {
            const testError = new Error('Redis connection error');
            mockClient.exists.mockRejectedValue(testError);

            const result = await cacheManager.exists('test-key');

            expect(result).toEqual({
                success: false,
                error: testError.message,
                data: false
            });
        });
    });

    describe('ttl', () => {
        it('should get TTL of key', async () => {
            mockClient.ttl.mockResolvedValue(3600);

            const result = await cacheManager.ttl('test-key');

            expect(result).toEqual({
                success: true,
                data: 3600
            });
        });

        it('should handle key without TTL', async () => {
            mockClient.ttl.mockResolvedValue(-1);

            const result = await cacheManager.ttl('test-key');

            expect(result).toEqual({
                success: true,
                data: -1
            });
        });

        it('should handle ttl exception', async () => {
            const testError = new Error('Redis connection error');
            mockClient.ttl.mockRejectedValue(testError);

            const result = await cacheManager.ttl('test-key');

            expect(result).toEqual({
                success: false,
                error: testError.message,
                data: -1
            });
        });
    });
});