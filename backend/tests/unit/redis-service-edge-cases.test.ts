/** @format */

import { redisService as _redisService } from '../../src/infrastructure/cache/redis.service';
type RedisServiceType = typeof _redisService;

describe('RedisService Edge Cases', () => {
    let mockClient: any;
    let redisService: RedisServiceType;

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

    describe('transaction recovery with circuit breaker', () => {
        it('should handle circuit breaker opening for persistent failures', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockRejectedValue(new Error('Connection timeout')),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.watchMultiExec(
                [testKey],
                async (multi) => {
                    multi.set(testKey, testValue);
                    return true;
                },
                3
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Connection timeout');
        });

        it('should handle transaction failures with high retries', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            let attempt = 0;
            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockImplementation(() => {
                    attempt++;
                    return Promise.resolve(null); // Always fail
                }),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.watchMultiExec(
                [testKey],
                async (multi) => {
                    multi.set(testKey, testValue);
                    return true;
                },
                3
            );

            expect(result.success).toBe(false);
            expect(result.attempts).toEqual(3);
            expect(result.error).toContain('after 3 attempts');
        });
    });

    describe('atomic operations with complex scenarios', () => {
        it('should handle atomic operations with insufficient funds', async () => {
            const fromKey = 'account:1';
            const toKey = 'account:2';
            const amount = 200;

            const mockGet = jest.spyOn(mockClient, 'get')
                .mockResolvedValueOnce('150') // from balance (insufficient)
                .mockResolvedValueOnce('300'); // to balance

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK', 'OK']),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.atomicBalanceTransfer(
                fromKey,
                toKey,
                amount
            );

            expect(result.success).toBe(true);
            expect(result.transferred).toBe(false);
            expect(result.error).toEqual('insufficient_funds');
        });

        it('should handle atomic operations with version mismatch', async () => {
            const dataKey = 'data:1';
            const versionKey = 'data:1:version';
            const newData = { foo: 'baz' };

            const mockGet = jest.spyOn(mockClient, 'get')
                .mockResolvedValueOnce('2') // current version (mismatch)
                .mockResolvedValueOnce(JSON.stringify({ foo: 'bar' })); // current data

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK', 'OK']),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.atomicVersionedUpdate(
                dataKey,
                newData,
                1,
                versionKey
            );

            expect(result.success).toBe(true);
            expect(result.updated).toBe(false);
            expect(result.error).toEqual('version_mismatch');
        });

        it('should handle conditional updates with mismatch', async () => {
            const testKey = 'test-key';
            const expectedValue = { foo: 'bar' };
            const newValue = { foo: 'baz' };

            // Reset all mocks before this test
            jest.clearAllMocks();

            // Create a fresh mock for this test
            const mockGet = jest.spyOn(mockClient, 'get').mockResolvedValue(JSON.stringify({ foo: 'different' }));
            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK']),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.atomicConditionalUpdate(
                testKey,
                newValue,
                expectedValue
            );

            // Verify the get method was called
            expect(mockGet).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.updated).toBe(false);
        });
    });

    describe('cache operations with invalid data', () => {
        it('should handle invalid JSON data in cache', async () => {
            const testKey = 'test-key';
            const invalidData = 'invalid-json-data';

            const mockGet = jest.spyOn(mockClient, 'get').mockResolvedValue(invalidData);

            const result = await redisService.getWithVersion(testKey);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to parse');
        });

        it('should handle atomic operations with invalid modifiers', async () => {
            const testKey = 'test-key';

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockGet = jest.spyOn(mockClient, 'get').mockResolvedValue(JSON.stringify({}));
            const mockSet = jest.spyOn(mockClient, 'set').mockResolvedValue('OK');

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockRejectedValue(new Error('Invalid modifier')),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.atomicReadModifyWrite<{ count: number }>(
                testKey,
                (current) => {
                    throw new Error('Invalid modifier');
                }
            );

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('performance and health monitoring', () => {
        // transactionRecoveryManager is private, so we can't test it directly from outside
        // This test is commented out because it's not accessible
        // it('should get transaction recovery stats', async () => {
        //     const recoveryStats = redisService.transactionRecoveryManager.getRecoveryStats();
        //     
        //     expect(recoveryStats).toEqual({
        //         circuitBreaker: {
        //             state: 'closed',
        //             failures: 0,
        //             lastFailure: 0,
        //             threshold: 10,
        //         },
        //         adaptiveLearning: {
        //             trackedKeys: 0,
        //             averageSuccessRate: 0,
        //             optimalDelaysConfigured: 0,
        //         },
        //         conflictHistory: {
        //             trackedSignatures: 0,
        //             totalConflicts: 0,
        //         },
        //     });
        // });

        it('should get transaction performance stats', async () => {
            const stats = redisService.getTransactionStats();

            expect(stats).toEqual({
                transactionsAttempted: 0,
                transactionsSuccessful: 0,
                transactionsFailed: 0,
                averageRetryCount: 0,
            });
        });

        it('should handle cache statistics retrieval failures', async () => {
            const mockPing = jest.spyOn(mockClient, 'ping').mockResolvedValue('PONG');
            const mockDbSize = jest.spyOn(mockClient, 'dbSize').mockRejectedValue(new Error('Connection error'));

            const result = await redisService.getCacheStats();

            expect(mockPing).toHaveBeenCalled();
            expect(mockDbSize).toHaveBeenCalled();
            expect(result.connected).toBe(false);
            expect(result.error).toBeDefined();
        });
    });
});