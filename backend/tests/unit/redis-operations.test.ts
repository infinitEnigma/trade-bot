/** @format */

import { RedisOperations } from '../../src/infrastructure/cache/redis/operations';

describe('RedisOperations', () => {
    let operations: RedisOperations;
    let mockConnectionManager: any;
    let mockClient: any;

    beforeEach(() => {
        // Create mock client
        mockClient = {
            get: jest.fn(),
            set: jest.fn(),
            multi: jest.fn(),
            del: jest.fn(),
            exists: jest.fn(),
            mGet: jest.fn(),
            mSet: jest.fn(),
            incr: jest.fn(),
            incrBy: jest.fn(),
            decrBy: jest.fn(),
            expire: jest.fn(),
            pExpire: jest.fn(),
            ttl: jest.fn(),
            keys: jest.fn(),
        };

        // Create mock connection manager
        mockConnectionManager = {
            getClient: jest.fn().mockReturnValue(mockClient),
        };

        operations = new RedisOperations(mockConnectionManager);
    });

    describe('instance creation', () => {
        it('should create an instance of RedisOperations', () => {
            expect(operations).toBeInstanceOf(RedisOperations);
        });
    });

    describe('get operation', () => {
        it('should return value when key exists', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';
            mockClient.get.mockResolvedValue(testValue);

            const result = await operations.get(testKey);

            expect(mockClient.get).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBe(testValue);
            expect(result.error).toBeUndefined();
        });

        it('should return null when key does not exist', async () => {
            const testKey = 'non-existent-key';
            mockClient.get.mockResolvedValue(null);

            const result = await operations.get(testKey);

            expect(mockClient.get).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBeNull();
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when getting key', async () => {
            const testKey = 'test-key';
            const testError = new Error('Connection error');
            mockClient.get.mockRejectedValue(testError);

            const result = await operations.get(testKey);

            expect(mockClient.get).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(false);
            expect(result.data).toBeUndefined();
            expect(result.error).toBe(testError.message);
        });
    });

    describe('set operation', () => {
        it('should set value for key', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';
            mockClient.set.mockResolvedValue('OK');

            const result = await operations.set(testKey, testValue);

            expect(mockClient.set).toHaveBeenCalledWith(testKey, testValue);
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when setting key', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';
            const testError = new Error('Connection error');
            mockClient.set.mockRejectedValue(testError);

            const result = await operations.set(testKey, testValue);

            expect(mockClient.set).toHaveBeenCalledWith(testKey, testValue);
            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('setex operation', () => {
        it('should set value with expiry using multi', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';
            const testTtl = 60;
            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                pExpire: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([['OK'], [1]]),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const result = await operations.setex(testKey, testTtl, testValue);

            expect(mockClient.multi).toHaveBeenCalled();
            expect(mockMulti.set).toHaveBeenCalledWith(testKey, testValue);
            expect(mockMulti.pExpire).toHaveBeenCalledWith(testKey, testTtl * 1000);
            expect(mockMulti.exec).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should fallback to individual commands when multi fails', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';
            const testTtl = 60;
            const testError = new Error('Multi command failed');
            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                pExpire: jest.fn().mockReturnThis(),
                exec: jest.fn().mockRejectedValue(testError),
            };
            mockClient.multi.mockReturnValue(mockMulti);
            mockClient.set.mockResolvedValue('OK');
            mockClient.pExpire.mockResolvedValue(1);

            const result = await operations.setex(testKey, testTtl, testValue);

            expect(mockClient.multi).toHaveBeenCalled();
            expect(mockClient.set).toHaveBeenCalledWith(testKey, testValue);
            expect(mockClient.pExpire).toHaveBeenCalledWith(testKey, testTtl * 1000);
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when fallback also fails', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';
            const testTtl = 60;
            const multiError = new Error('Multi command failed');
            const fallbackError = new Error('Fallback command failed');
            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                pExpire: jest.fn().mockReturnThis(),
                exec: jest.fn().mockRejectedValue(multiError),
            };
            mockClient.multi.mockReturnValue(mockMulti);
            mockClient.set.mockRejectedValue(fallbackError);

            const result = await operations.setex(testKey, testTtl, testValue);

            expect(mockClient.multi).toHaveBeenCalled();
            expect(mockClient.set).toHaveBeenCalledWith(testKey, testValue);
            expect(result.success).toBe(false);
            expect(result.error).toBe(fallbackError.message);
        });
    });

    describe('del operation', () => {
        it('should delete single key', async () => {
            const testKey = 'test-key';
            const deletedCount = 1;
            mockClient.del.mockResolvedValue(deletedCount);

            const result = await operations.del(testKey);

            expect(mockClient.del).toHaveBeenCalledWith([testKey]);
            expect(result.success).toBe(true);
            expect(result.data).toBe(deletedCount);
            expect(result.error).toBeUndefined();
        });

        it('should delete multiple keys', async () => {
            const testKeys = ['key1', 'key2', 'key3'];
            const deletedCount = 3;
            mockClient.del.mockResolvedValue(deletedCount);

            const result = await operations.del(testKeys);

            expect(mockClient.del).toHaveBeenCalledWith(testKeys);
            expect(result.success).toBe(true);
            expect(result.data).toBe(deletedCount);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when deleting keys', async () => {
            const testKey = 'test-key';
            const testError = new Error('Connection error');
            mockClient.del.mockRejectedValue(testError);

            const result = await operations.del(testKey);

            expect(mockClient.del).toHaveBeenCalledWith([testKey]);
            expect(result.success).toBe(false);
            expect(result.data).toBe(0);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('exists operation', () => {
        it('should return true when key exists', async () => {
            const testKey = 'test-key';
            mockClient.exists.mockResolvedValue(1);

            const result = await operations.exists(testKey);

            expect(mockClient.exists).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should return false when key does not exist', async () => {
            const testKey = 'non-existent-key';
            mockClient.exists.mockResolvedValue(0);

            const result = await operations.exists(testKey);

            expect(mockClient.exists).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBe(false);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when checking existence', async () => {
            const testKey = 'test-key';
            const testError = new Error('Connection error');
            mockClient.exists.mockRejectedValue(testError);

            const result = await operations.exists(testKey);

            expect(mockClient.exists).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(false);
            expect(result.data).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('mget operation', () => {
        it('should get multiple values', async () => {
            const testKeys = ['key1', 'key2', 'key3'];
            const testValues = ['value1', 'value2', null];
            mockClient.mGet.mockResolvedValue(testValues);

            const result = await operations.mget(testKeys);

            expect(mockClient.mGet).toHaveBeenCalledWith(testKeys);
            expect(result.success).toBe(true);
            expect(result.data).toEqual(['value1', 'value2', '']);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when getting multiple keys', async () => {
            const testKeys = ['key1', 'key2'];
            const testError = new Error('Connection error');
            mockClient.mGet.mockRejectedValue(testError);

            const result = await operations.mget(testKeys);

            expect(mockClient.mGet).toHaveBeenCalledWith(testKeys);
            expect(result.success).toBe(false);
            expect(result.data).toBeUndefined();
            expect(result.error).toBe(testError.message);
        });
    });

    describe('mset operation', () => {
        it('should set multiple key-value pairs', async () => {
            const keyValues = {
                key1: 'value1',
                key2: 'value2',
                key3: 'value3',
            };
            mockClient.mSet.mockResolvedValue('OK');

            const result = await operations.mset(keyValues);

            expect(mockClient.mSet).toHaveBeenCalledWith(keyValues);
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when setting multiple keys', async () => {
            const keyValues = {
                key1: 'value1',
                key2: 'value2',
            };
            const testError = new Error('Connection error');
            mockClient.mSet.mockRejectedValue(testError);

            const result = await operations.mset(keyValues);

            expect(mockClient.mSet).toHaveBeenCalledWith(keyValues);
            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('incr operation', () => {
        it('should increment value by 1', async () => {
            const testKey = 'counter';
            const newValue = 5;
            mockClient.incr.mockResolvedValue(newValue);

            const result = await operations.incr(testKey);

            expect(mockClient.incr).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBe(newValue);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when incrementing', async () => {
            const testKey = 'counter';
            const testError = new Error('Connection error');
            mockClient.incr.mockRejectedValue(testError);

            const result = await operations.incr(testKey);

            expect(mockClient.incr).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(false);
            expect(result.data).toBe(0);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('incrBy operation', () => {
        it('should increment value by specific amount', async () => {
            const testKey = 'counter';
            const increment = 10;
            const newValue = 15;
            mockClient.incrBy.mockResolvedValue(newValue);

            const result = await operations.incrBy(testKey, increment);

            expect(mockClient.incrBy).toHaveBeenCalledWith(testKey, increment);
            expect(result.success).toBe(true);
            expect(result.data).toBe(newValue);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when incrementing by amount', async () => {
            const testKey = 'counter';
            const increment = 10;
            const testError = new Error('Connection error');
            mockClient.incrBy.mockRejectedValue(testError);

            const result = await operations.incrBy(testKey, increment);

            expect(mockClient.incrBy).toHaveBeenCalledWith(testKey, increment);
            expect(result.success).toBe(false);
            expect(result.data).toBe(0);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('decrBy operation', () => {
        it('should decrement value by specific amount', async () => {
            const testKey = 'counter';
            const decrement = 5;
            const newValue = 10;
            mockClient.decrBy.mockResolvedValue(newValue);

            const result = await operations.decrBy(testKey, decrement);

            expect(mockClient.decrBy).toHaveBeenCalledWith(testKey, decrement);
            expect(result.success).toBe(true);
            expect(result.data).toBe(newValue);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when decrementing by amount', async () => {
            const testKey = 'counter';
            const decrement = 5;
            const testError = new Error('Connection error');
            mockClient.decrBy.mockRejectedValue(testError);

            const result = await operations.decrBy(testKey, decrement);

            expect(mockClient.decrBy).toHaveBeenCalledWith(testKey, decrement);
            expect(result.success).toBe(false);
            expect(result.data).toBe(0);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('expire operation', () => {
        it('should set expiry in seconds', async () => {
            const testKey = 'test-key';
            const ttlSeconds = 60;
            mockClient.expire.mockResolvedValue(1);

            const result = await operations.expire(testKey, ttlSeconds);

            expect(mockClient.expire).toHaveBeenCalledWith(testKey, ttlSeconds);
            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should return false when key does not exist for expire', async () => {
            const testKey = 'non-existent-key';
            const ttlSeconds = 60;
            mockClient.expire.mockResolvedValue(0);

            const result = await operations.expire(testKey, ttlSeconds);

            expect(mockClient.expire).toHaveBeenCalledWith(testKey, ttlSeconds);
            expect(result.success).toBe(true);
            expect(result.data).toBe(false);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when setting expiry', async () => {
            const testKey = 'test-key';
            const ttlSeconds = 60;
            const testError = new Error('Connection error');
            mockClient.expire.mockRejectedValue(testError);

            const result = await operations.expire(testKey, ttlSeconds);

            expect(mockClient.expire).toHaveBeenCalledWith(testKey, ttlSeconds);
            expect(result.success).toBe(false);
            expect(result.data).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('pExpire operation', () => {
        it('should set expiry in milliseconds', async () => {
            const testKey = 'test-key';
            const ttlMs = 60000;
            mockClient.pExpire.mockResolvedValue(1);

            const result = await operations.pExpire(testKey, ttlMs);

            expect(mockClient.pExpire).toHaveBeenCalledWith(testKey, ttlMs);
            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should return false when key does not exist for pExpire', async () => {
            const testKey = 'non-existent-key';
            const ttlMs = 60000;
            mockClient.pExpire.mockResolvedValue(0);

            const result = await operations.pExpire(testKey, ttlMs);

            expect(mockClient.pExpire).toHaveBeenCalledWith(testKey, ttlMs);
            expect(result.success).toBe(true);
            expect(result.data).toBe(false);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when setting pExpire', async () => {
            const testKey = 'test-key';
            const ttlMs = 60000;
            const testError = new Error('Connection error');
            mockClient.pExpire.mockRejectedValue(testError);

            const result = await operations.pExpire(testKey, ttlMs);

            expect(mockClient.pExpire).toHaveBeenCalledWith(testKey, ttlMs);
            expect(result.success).toBe(false);
            expect(result.data).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('ttl operation', () => {
        it('should get time to live in seconds', async () => {
            const testKey = 'test-key';
            const ttlSeconds = 60;
            mockClient.ttl.mockResolvedValue(ttlSeconds);

            const result = await operations.ttl(testKey);

            expect(mockClient.ttl).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBe(ttlSeconds);
            expect(result.error).toBeUndefined();
        });

        it('should return -1 when key has no expiry', async () => {
            const testKey = 'test-key';
            mockClient.ttl.mockResolvedValue(-1);

            const result = await operations.ttl(testKey);

            expect(mockClient.ttl).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBe(-1);
            expect(result.error).toBeUndefined();
        });

        it('should return -2 when key does not exist', async () => {
            const testKey = 'non-existent-key';
            mockClient.ttl.mockResolvedValue(-2);

            const result = await operations.ttl(testKey);

            expect(mockClient.ttl).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(true);
            expect(result.data).toBe(-2);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when getting ttl', async () => {
            const testKey = 'test-key';
            const testError = new Error('Connection error');
            mockClient.ttl.mockRejectedValue(testError);

            const result = await operations.ttl(testKey);

            expect(mockClient.ttl).toHaveBeenCalledWith(testKey);
            expect(result.success).toBe(false);
            expect(result.data).toBe(-1);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('keys operation', () => {
        it('should get keys matching pattern', async () => {
            const testPattern = 'test:*';
            const matchingKeys = ['test:1', 'test:2', 'test:3'];
            mockClient.keys.mockResolvedValue(matchingKeys);

            const result = await operations.keys(testPattern);

            expect(mockClient.keys).toHaveBeenCalledWith(testPattern);
            expect(result.success).toBe(true);
            expect(result.data).toEqual(matchingKeys);
            expect(result.error).toBeUndefined();
        });

        it('should return empty array when no keys match pattern', async () => {
            const testPattern = 'nonexistent:*';
            mockClient.keys.mockResolvedValue([]);

            const result = await operations.keys(testPattern);

            expect(mockClient.keys).toHaveBeenCalledWith(testPattern);
            expect(result.success).toBe(true);
            expect(result.data).toEqual([]);
            expect(result.error).toBeUndefined();
        });

        it('should handle errors when getting keys', async () => {
            const testPattern = 'test:*';
            const testError = new Error('Connection error');
            mockClient.keys.mockRejectedValue(testError);

            const result = await operations.keys(testPattern);

            expect(mockClient.keys).toHaveBeenCalledWith(testPattern);
            expect(result.success).toBe(false);
            expect(result.data).toBeUndefined();
            expect(result.error).toBe(testError.message);
        });
    });
});