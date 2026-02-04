/** @format */

describe('RedisService', () => {
    let mockClient: any;
    let redisService: any;

    beforeEach(() => {
        // Reset all modules to ensure fresh singleton instance
        jest.resetModules();
        // Reimport the service to get a fresh instance
        const module = require('../../src/infrastructure/cache/redis.service');
        redisService = module.redisService;
        // Get the client instance and create mocks
        mockClient = redisService.getClient();

        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    describe('instance creation', () => {
        it('should create a singleton instance', () => {
            const instance1 = redisService;
            const instance2 = require('../../src/infrastructure/cache/redis.service').redisService;
            expect(instance1).toBe(instance2);
        });
    });

    describe('connection management', () => {
        it('should check if Redis is healthy', async () => {
            const mockPing = jest.spyOn(mockClient, 'ping').mockResolvedValue('PONG');

            const result = await redisService.isHealthy();

            expect(mockPing).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('should return false when Redis is unhealthy', async () => {
            const mockPing = jest.spyOn(mockClient, 'ping').mockRejectedValue(new Error('Connection error'));

            const result = await redisService.isHealthy();

            expect(mockPing).toHaveBeenCalled();
            expect(result).toBe(false);
        });
    });

    describe('basic operations', () => {
        describe('get operation', () => {
            it('should return value when key exists', async () => {
                const testKey = 'test-key';
                const testValue = 'test-value';
                const mockGet = jest.spyOn(mockClient, 'get').mockResolvedValue(testValue);

                const result = await redisService.get(testKey);

                expect(mockGet).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(true);
                expect(result.data).toBe(testValue);
                expect(result.error).toBeUndefined();
            });

            it('should return null when key does not exist', async () => {
                const testKey = 'non-existent-key';
                const mockGet = jest.spyOn(mockClient, 'get').mockResolvedValue(null);

                const result = await redisService.get(testKey);

                expect(mockGet).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(true);
                expect(result.data).toBeNull();
                expect(result.error).toBeUndefined();
            });

            it('should handle errors when getting key', async () => {
                const testKey = 'test-key';
                const testError = new Error('Connection error');
                const mockGet = jest.spyOn(mockClient, 'get').mockRejectedValue(testError);

                const result = await redisService.get(testKey);

                expect(mockGet).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(false);
                expect(result.data).toBeNull();
                expect(result.error).toBe(testError.message);
            });
        });

        describe('set operation', () => {
            it('should set value for key', async () => {
                const testKey = 'test-key';
                const testValue = 'test-value';
                const mockSet = jest.spyOn(mockClient, 'set').mockResolvedValue('OK');

                const result = await redisService.set(testKey, testValue);

                expect(mockSet).toHaveBeenCalledWith(testKey, testValue);
                expect(result.success).toBe(true);
                expect(result.error).toBeUndefined();
            });

            it('should handle errors when setting key', async () => {
                const testKey = 'test-key';
                const testValue = 'test-value';
                const testError = new Error('Connection error');
                const mockSet = jest.spyOn(mockClient, 'set').mockRejectedValue(testError);

                const result = await redisService.set(testKey, testValue);

                expect(mockSet).toHaveBeenCalledWith(testKey, testValue);
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
                const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

                const result = await redisService.setex(testKey, testTtl, testValue);

                expect(mockClientMulti).toHaveBeenCalled();
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
                const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);
                const mockSet = jest.spyOn(mockClient, 'set').mockResolvedValue('OK');
                const mockPExpire = jest.spyOn(mockClient, 'pExpire').mockResolvedValue(1);

                const result = await redisService.setex(testKey, testTtl, testValue);

                expect(mockClientMulti).toHaveBeenCalled();
                expect(mockSet).toHaveBeenCalledWith(testKey, testValue);
                expect(mockPExpire).toHaveBeenCalledWith(testKey, testTtl * 1000);
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
                const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);
                const mockSet = jest.spyOn(mockClient, 'set').mockRejectedValue(fallbackError);

                const result = await redisService.setex(testKey, testTtl, testValue);

                expect(mockClientMulti).toHaveBeenCalled();
                expect(mockSet).toHaveBeenCalledWith(testKey, testValue);
                expect(result.success).toBe(false);
                expect(result.error).toBe(fallbackError.message);
            });
        });

        describe('del operation', () => {
            it('should delete key', async () => {
                const testKey = 'test-key';
                const deletedCount = 1;
                const mockDel = jest.spyOn(mockClient, 'del').mockResolvedValue(deletedCount);

                const result = await redisService.del(testKey);

                expect(mockDel).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(true);
                expect(result.error).toBeUndefined();
            });

            it('should handle errors when deleting key', async () => {
                const testKey = 'test-key';
                const testError = new Error('Connection error');
                const mockDel = jest.spyOn(mockClient, 'del').mockRejectedValue(testError);

                const result = await redisService.del(testKey);

                expect(mockDel).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(false);
                expect(result.error).toBe(testError.message);
            });
        });

        describe('exists operation', () => {
            it('should return true when key exists', async () => {
                const testKey = 'test-key';
                const mockExists = jest.spyOn(mockClient, 'exists').mockResolvedValue(1);

                const result = await redisService.exists(testKey);

                expect(mockExists).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(true);
                expect(result.data).toBe(true);
                expect(result.error).toBeUndefined();
            });

            it('should return false when key does not exist', async () => {
                const testKey = 'non-existent-key';
                const mockExists = jest.spyOn(mockClient, 'exists').mockResolvedValue(0);

                const result = await redisService.exists(testKey);

                expect(mockExists).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(true);
                expect(result.data).toBe(false);
                expect(result.error).toBeUndefined();
            });

            it('should handle errors when checking existence', async () => {
                const testKey = 'test-key';
                const testError = new Error('Connection error');
                const mockExists = jest.spyOn(mockClient, 'exists').mockRejectedValue(testError);

                const result = await redisService.exists(testKey);

                expect(mockExists).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(false);
                expect(result.data).toBe(false);
                expect(result.error).toBe(testError.message);
            });
        });

        describe('ttl operation', () => {
            it('should get time to live in seconds', async () => {
                const testKey = 'test-key';
                const ttlSeconds = 60;
                const mockTtl = jest.spyOn(mockClient, 'ttl').mockResolvedValue(ttlSeconds);

                const result = await redisService.ttl(testKey);

                expect(mockTtl).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(true);
                expect(result.ttl).toBe(ttlSeconds);
                expect(result.error).toBeUndefined();
            });

            it('should return -1 when key has no expiry', async () => {
                const testKey = 'test-key';
                const mockTtl = jest.spyOn(mockClient, 'ttl').mockResolvedValue(-1);

                const result = await redisService.ttl(testKey);

                expect(mockTtl).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(true);
                expect(result.ttl).toBe(-1);
                expect(result.error).toBeUndefined();
            });

            it('should handle errors when getting ttl', async () => {
                const testKey = 'test-key';
                const testError = new Error('Connection error');
                const mockTtl = jest.spyOn(mockClient, 'ttl').mockRejectedValue(testError);

                const result = await redisService.ttl(testKey);

                expect(mockTtl).toHaveBeenCalledWith(testKey);
                expect(result.success).toBe(false);
                expect(result.ttl).toBe(-1);
                expect(result.error).toBe(testError.message);
            });
        });
    });

    describe('cache operations with versioning', () => {
        describe('getWithVersion', () => {
            it('should get cache value without version', async () => {
                const testKey = 'test-key';
                const testData = { foo: 'bar' };
                const mockGet = jest.spyOn(mockClient, 'get').mockResolvedValue(JSON.stringify(testData));

                const result = await redisService.getWithVersion(testKey);

                expect(result.success).toBe(true);
                expect(result.data).toEqual(testData);
                expect(result.version).toBeUndefined();
            });

            it('should get cache value with version', async () => {
                const testKey = 'test-key';
                const testVersionKey = 'test-key:version';
                const testData = { foo: 'bar' };
                const mockGet = jest.spyOn(mockClient, 'get')
                    .mockResolvedValueOnce('2') // version
                    .mockResolvedValueOnce(JSON.stringify(testData)); // data

                const result = await redisService.getWithVersion(testKey, testVersionKey);

                expect(result.success).toBe(true);
                expect(result.data).toEqual(testData);
                expect(result.version).toEqual(2);
            });
        });
    });

    describe('cache statistics', () => {
        describe('getCacheStats', () => {
            it('should get cache statistics when connected', async () => {
                const mockPing = jest.spyOn(mockClient, 'ping').mockResolvedValue('PONG');
                const mockDbSize = jest.spyOn(mockClient, 'dbSize').mockResolvedValue(100);
                const mockInfo = jest.spyOn(mockClient, 'info')
                    .mockResolvedValueOnce('used_memory:1048576') // memory info
                    .mockResolvedValueOnce('uptime_in_seconds:3600'); // server info

                const result = await redisService.getCacheStats();

                expect(mockPing).toHaveBeenCalled();
                expect(mockDbSize).toHaveBeenCalled();
                expect(mockInfo).toHaveBeenCalledTimes(2);
                expect(result.connected).toBe(true);
                expect(result.dbSize).toEqual(100);
                expect(result.memoryUsage).toEqual(1048576);
                expect(result.uptime).toEqual(3600);
            });

            it('should return error when not connected', async () => {
                const mockPing = jest.spyOn(mockClient, 'ping').mockRejectedValue(new Error('Connection error'));

                const result = await redisService.getCacheStats();

                expect(mockPing).toHaveBeenCalled();
                expect(result.connected).toBe(false);
                expect(result.error).toBeDefined();
            });
        });
    });

    describe('advanced atomic operations', () => {
        describe('atomicIncrementWithExpiry', () => {
            it('should increment counter with expiry', async () => {
                const testKey = 'counter';
                const increment = 5;
                const ttlMs = 60000;

                const mockMulti = {
                    incrBy: jest.fn().mockReturnThis(),
                    eval: jest.fn().mockReturnThis(),
                    exec: jest.fn().mockResolvedValue([6, 6]),
                };
                const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

                const result = await redisService.atomicIncrementWithExpiry(testKey, increment, ttlMs);

                expect(result.success).toBe(true);
                expect(result.newValue).toEqual(6);
            });
        });
    });

    describe('transaction statistics', () => {
        describe('getTransactionStats', () => {
            it('should return transaction statistics', () => {
                const stats = redisService.getTransactionStats();

                expect(stats).toEqual({
                    transactionsAttempted: 0,
                    transactionsSuccessful: 0,
                    transactionsFailed: 0,
                    averageRetryCount: 0,
                });
            });
        });
    });
});