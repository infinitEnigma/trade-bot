/** @format */

import { redisService as _redisService } from '../../src/infrastructure/cache/redis.service';
type RedisServiceType = typeof _redisService;

describe('RedisService Transactions', () => {
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

    describe('transaction recovery manager', () => {
        it('should execute transactions with watch and exec', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';

            // Mock WATCH and transaction execution
            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK']),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            // Execute a simple transaction
            const result = await redisService.watchMultiExec(
                [testKey],
                async (multi) => {
                    multi.set(testKey, testValue);
                    return true;
                }
            );

            expect(mockWatch).toHaveBeenCalled();
            expect(mockUnwatch).toHaveBeenCalled();
            expect(result.success).toBe(true);
        });

        it('should handle transaction retries', async () => {
            const testKey = 'test-key';
            const testValue = 'test-value';

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            let attempt = 0;
            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockImplementation(() => {
                    attempt++;
                    return Promise.resolve(attempt === 2 ? ['OK'] : null); // Fail first attempt
                }),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.watchMultiExec(
                [testKey],
                async (multi) => {
                    multi.set(testKey, testValue);
                    return true;
                },
                2
            );

            expect(result.success).toBe(true);
            expect(result.attempts).toEqual(2);
        });
    });

    describe('atomic operations with versioning', () => {
        it('should handle atomic cache updates with retries', async () => {
            const testKey = 'test-key';
            const testVersionKey = 'test-key:version';
            const testData = { foo: 'bar' };

            const mockGet = jest.spyOn(mockClient, 'get')
                .mockResolvedValueOnce('1') // First get fails (watch conflict)
                .mockResolvedValueOnce('1'); // Second get succeeds

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            let attempt = 0;
            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockImplementation(() => {
                    attempt++;
                    return Promise.resolve(attempt === 2 ? ['OK', 'OK'] : null);
                }),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.atomicCacheUpdate(
                testKey,
                testData,
                testVersionKey,
                2
            );

            expect(result.success).toBe(true);
        });
    });

    describe('advanced transaction scenarios', () => {
        it('should handle atomic balance transfers with conflict resolution', async () => {
            const fromKey = 'account:1';
            const toKey = 'account:2';
            const amount = 100;

            const mockGet = jest.spyOn(mockClient, 'get')
                .mockResolvedValueOnce('500') // from balance
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
            expect(result.transferred).toBe(true);
        });

        it('should handle conditional updates with version checking', async () => {
            const dataKey = 'data:1';
            const versionKey = 'data:1:version';
            const newData = { foo: 'baz' };

            const mockGet = jest.spyOn(mockClient, 'get')
                .mockResolvedValueOnce('1') // current version
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
            expect(result.updated).toBe(true);
            expect(result.newVersion).toEqual(2);
        });

        it('should perform atomic composite updates', async () => {
            const updates: Array<{ key: string; value: unknown; operation?: 'set' | 'incr' | 'decr' }> = [
                { key: 'key1', value: 'value1' },
                { key: 'key2', value: 10, operation: 'incr' },
                { key: 'key3', value: 5, operation: 'decr' }
            ];

            const mockWatch = jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            const mockUnwatch = jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                incrBy: jest.fn().mockReturnThis(),
                decrBy: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK', 15, 3]),
            };
            const mockClientMulti = jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisService.atomicCompositeUpdate(updates);

            expect(result.success).toBe(true);
            expect(result.results).toBeDefined();
            expect(result.results!.length).toEqual(3);
        });
    });
});