/** @format */

import { RedisCacheAdapter, redisCacheAdapter } from '../../src/infrastructure/adapters/cache/redis-cache.adapter';

// Mock dependencies
jest.mock('../../src/infrastructure/cache/redis.service');

describe('RedisCacheAdapter', () => {
    let adapter: RedisCacheAdapter;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        adapter = new RedisCacheAdapter();
    });

    describe('instance creation', () => {
        it('should create an instance of RedisCacheAdapter', () => {
            expect(adapter).toBeInstanceOf(RedisCacheAdapter);
        });

        it('should export a singleton instance', () => {
            expect(redisCacheAdapter).toBeInstanceOf(RedisCacheAdapter);
            expect(redisCacheAdapter).toBeDefined();
        });
    });

    describe('get', () => {
        it('should get a value from cache successfully with JSON parsing', async () => {
            const mockKey = 'test-key';
            const mockValue = { foo: 'bar' };
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(mockValue)
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await adapter.get(mockKey);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockValue);
            expect(mockGet).toHaveBeenCalledWith(mockKey);
        });

        it('should get a value from cache successfully as string if JSON parsing fails', async () => {
            const mockKey = 'test-key';
            const mockValue = 'invalid-json';
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: mockValue
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await adapter.get(mockKey);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockValue);
            expect(mockGet).toHaveBeenCalledWith(mockKey);
        });

        it('should handle cache miss', async () => {
            const mockKey = 'test-key';
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: null
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await adapter.get(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockGet).toHaveBeenCalledWith(mockKey);
        });

        it('should handle redis service failure', async () => {
            const mockKey = 'test-key';
            const mockGet = jest.fn().mockResolvedValue({
                success: false,
                error: 'Redis connection error'
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await adapter.get(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockGet).toHaveBeenCalledWith(mockKey);
        });

        it('should handle exception when getting from cache', async () => {
            const mockKey = 'test-key';
            const mockGet = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await adapter.get(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockGet).toHaveBeenCalledWith(mockKey);
        });
    });

    describe('set', () => {
        it('should set a value in cache successfully without TTL', async () => {
            const mockKey = 'test-key';
            const mockValue = { foo: 'bar' };
            const mockSet = jest.fn().mockResolvedValue({
                success: true
            });
            require('../../src/infrastructure/cache/redis.service').redisService.set = mockSet;

            const result = await adapter.set(mockKey, mockValue);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(mockSet).toHaveBeenCalledWith(mockKey, JSON.stringify(mockValue));
        });

        it('should set a value in cache successfully with TTL', async () => {
            const mockKey = 'test-key';
            const mockValue = { foo: 'bar' };
            const mockTtl = 3600;
            const mockSetex = jest.fn().mockResolvedValue({
                success: true
            });
            require('../../src/infrastructure/cache/redis.service').redisService.setex = mockSetex;

            const result = await adapter.set(mockKey, mockValue, mockTtl);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(mockSetex).toHaveBeenCalledWith(mockKey, mockTtl, JSON.stringify(mockValue));
        });

        it('should handle redis service failure when setting', async () => {
            const mockKey = 'test-key';
            const mockValue = { foo: 'bar' };
            const mockSet = jest.fn().mockResolvedValue({
                success: false,
                error: 'Redis connection error'
            });
            require('../../src/infrastructure/cache/redis.service').redisService.set = mockSet;

            const result = await adapter.set(mockKey, mockValue);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockSet).toHaveBeenCalledWith(mockKey, JSON.stringify(mockValue));
        });

        it('should handle exception when setting in cache', async () => {
            const mockKey = 'test-key';
            const mockValue = { foo: 'bar' };
            const mockSet = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.set = mockSet;

            const result = await adapter.set(mockKey, mockValue);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockSet).toHaveBeenCalledWith(mockKey, JSON.stringify(mockValue));
        });
    });

    describe('delete', () => {
        it('should delete a value from cache successfully', async () => {
            const mockKey = 'test-key';
            const mockDel = jest.fn().mockResolvedValue({
                success: true
            });
            require('../../src/infrastructure/cache/redis.service').redisService.del = mockDel;

            const result = await adapter.delete(mockKey);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(mockDel).toHaveBeenCalledWith(mockKey);
        });

        it('should handle redis service failure when deleting', async () => {
            const mockKey = 'test-key';
            const mockDel = jest.fn().mockResolvedValue({
                success: false,
                error: 'Redis connection error'
            });
            require('../../src/infrastructure/cache/redis.service').redisService.del = mockDel;

            const result = await adapter.delete(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockDel).toHaveBeenCalledWith(mockKey);
        });

        it('should handle exception when deleting from cache', async () => {
            const mockKey = 'test-key';
            const mockDel = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.del = mockDel;

            const result = await adapter.delete(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockDel).toHaveBeenCalledWith(mockKey);
        });
    });

    describe('exists', () => {
        it('should check if a key exists in cache successfully (exists)', async () => {
            const mockKey = 'test-key';
            const mockExists = jest.fn().mockResolvedValue({
                success: true,
                data: true
            });
            require('../../src/infrastructure/cache/redis.service').redisService.exists = mockExists;

            const result = await adapter.exists(mockKey);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(mockExists).toHaveBeenCalledWith(mockKey);
        });

        it('should check if a key exists in cache successfully (does not exist)', async () => {
            const mockKey = 'test-key';
            const mockExists = jest.fn().mockResolvedValue({
                success: true,
                data: false
            });
            require('../../src/infrastructure/cache/redis.service').redisService.exists = mockExists;

            const result = await adapter.exists(mockKey);

            expect(result.success).toBe(true);
            expect(result.data).toBe(false);
            expect(mockExists).toHaveBeenCalledWith(mockKey);
        });

        it('should handle redis service failure when checking exists', async () => {
            const mockKey = 'test-key';
            const mockExists = jest.fn().mockResolvedValue({
                success: false,
                error: 'Redis connection error'
            });
            require('../../src/infrastructure/cache/redis.service').redisService.exists = mockExists;

            const result = await adapter.exists(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockExists).toHaveBeenCalledWith(mockKey);
        });

        it('should handle exception when checking exists', async () => {
            const mockKey = 'test-key';
            const mockExists = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.exists = mockExists;

            const result = await adapter.exists(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockExists).toHaveBeenCalledWith(mockKey);
        });
    });

    describe('setex', () => {
        it('should set a value with TTL using setex method', async () => {
            const mockKey = 'test-key';
            const mockValue = { foo: 'bar' };
            const mockTtl = 3600;
            const mockSetex = jest.fn().mockResolvedValue({
                success: true
            });
            require('../../src/infrastructure/cache/redis.service').redisService.setex = mockSetex;

            const result = await adapter.setex(mockKey, mockTtl, mockValue);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(mockSetex).toHaveBeenCalledWith(mockKey, mockTtl, JSON.stringify(mockValue));
        });
    });

    describe('mget', () => {
        it('should get multiple values from cache successfully', async () => {
            const mockKeys = ['key1', 'key2', 'key3'];
            const mockValues = [
                { success: true, data: JSON.stringify({ value: 1 }) },
                { success: true, data: JSON.stringify({ value: 2 }) },
                { success: false, error: 'Cache miss' }
            ];

            const mockGet = jest.fn()
                .mockResolvedValueOnce(mockValues[0])
                .mockResolvedValueOnce(mockValues[1])
                .mockResolvedValueOnce(mockValues[2]);

            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await adapter.mget(mockKeys);

            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                'key1': { value: 1 },
                'key2': { value: 2 }
            });
            expect(mockGet).toHaveBeenCalledTimes(3);
            mockKeys.forEach(key => {
                expect(mockGet).toHaveBeenCalledWith(key);
            });
        });

        it('should handle exception when getting multiple values', async () => {
            const mockKeys = ['key1', 'key2'];
            const mockGet = jest.fn().mockImplementation(() => {
                throw new Error('Unexpected error');
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await adapter.mget(mockKeys);

            // The individual get calls catch their exceptions and return failure status, so mget continues processing
            expect(result.success).toBe(true);
            expect(result.data).toEqual({});
            expect(mockGet).toHaveBeenCalled();
        });
    });

    describe('mset', () => {
        it('should set multiple values in cache successfully', async () => {
            const mockKeyValues = {
                'key1': { value: 1 },
                'key2': { value: 2 }
            };
            const mockTtl = 3600;

            const mockSetex = jest.fn().mockResolvedValue({ success: true });
            require('../../src/infrastructure/cache/redis.service').redisService.setex = mockSetex;

            const result = await adapter.mset(mockKeyValues, mockTtl);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(mockSetex).toHaveBeenCalledTimes(2);
            Object.entries(mockKeyValues).forEach(([key, value]) => {
                expect(mockSetex).toHaveBeenCalledWith(key, mockTtl, JSON.stringify(value));
            });
        });

        it('should handle partial failure when setting multiple values', async () => {
            const mockKeyValues = {
                'key1': { value: 1 },
                'key2': { value: 2 }
            };

            const mockSet = jest.fn()
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: false, error: 'Redis connection error' });

            require('../../src/infrastructure/cache/redis.service').redisService.set = mockSet;

            const result = await adapter.mset(mockKeyValues);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockSet).toHaveBeenCalledTimes(2);
        });

        it('should handle exception when setting multiple values', async () => {
            const mockKeyValues = {
                'key1': { value: 1 },
                'key2': { value: 2 }
            };

            const mockSet = jest.fn().mockImplementation(() => {
                throw new Error('Unexpected error');
            });
            require('../../src/infrastructure/cache/redis.service').redisService.set = mockSet;

            const result = await adapter.mset(mockKeyValues);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toContain('Some cache sets failed');
            expect(mockSet).toHaveBeenCalled();
        });
    });

    describe('atomicConditionalUpdate', () => {
        it('should perform atomic conditional update successfully', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { foo: 'bar' };
            const mockExpectedValue = { foo: 'baz' };

            const mockAtomicConditionalUpdate = jest.fn().mockResolvedValue({
                success: true,
                updated: true
            });

            require('../../src/infrastructure/cache/redis.service').redisService.atomicConditionalUpdate = mockAtomicConditionalUpdate;

            const result = await adapter.atomicConditionalUpdate(mockKey, mockNewValue, mockExpectedValue);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(mockAtomicConditionalUpdate).toHaveBeenCalledWith(
                mockKey,
                mockNewValue,
                mockExpectedValue
            );
        });

        it('should handle atomic conditional update failure', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { foo: 'bar' };
            const mockExpectedValue = { foo: 'baz' };

            const mockAtomicConditionalUpdate = jest.fn().mockResolvedValue({
                success: false,
                error: 'Atomic operation failed'
            });

            require('../../src/infrastructure/cache/redis.service').redisService.atomicConditionalUpdate = mockAtomicConditionalUpdate;

            const result = await adapter.atomicConditionalUpdate(mockKey, mockNewValue, mockExpectedValue);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockAtomicConditionalUpdate).toHaveBeenCalledWith(
                mockKey,
                mockNewValue,
                mockExpectedValue
            );
        });

        it('should handle exception when performing atomic conditional update', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { foo: 'bar' };
            const mockExpectedValue = { foo: 'baz' };

            const mockAtomicConditionalUpdate = jest.fn().mockRejectedValue(new Error('Unexpected error'));

            require('../../src/infrastructure/cache/redis.service').redisService.atomicConditionalUpdate = mockAtomicConditionalUpdate;

            const result = await adapter.atomicConditionalUpdate(mockKey, mockNewValue, mockExpectedValue);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockAtomicConditionalUpdate).toHaveBeenCalledWith(
                mockKey,
                mockNewValue,
                mockExpectedValue
            );
        });
    });
});