/** @format */

// Mock all Redis-related modules first to prevent circular dependency issues
jest.mock('../../src/infrastructure/cache/redis.service');
jest.mock('../../src/infrastructure/cache/redis/transactions');
jest.mock('../../src/infrastructure/cache/redis/connection-manager');
jest.mock('../../src/core/logging/context-aware-logger.service', () => ({
    redisLogger: {
        error: jest.fn(),
        warn: jest.fn()
    }
}));

// Import the classes after mocking
import { RedisAtomicOperations } from '../../src/infrastructure/cache/redis/atomic-operations';
import { RedisTransactions } from '../../src/infrastructure/cache/redis/transactions';
import { RedisConnectionManager } from '../../src/infrastructure/cache/redis/connection-manager';

describe('RedisAtomicOperations', () => {
    let atomicOperations: RedisAtomicOperations;
    let mockConnectionManager: jest.Mocked<RedisConnectionManager>;
    let mockTransactions: jest.Mocked<RedisTransactions>;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Create mock instances
        mockConnectionManager = new RedisConnectionManager() as jest.Mocked<RedisConnectionManager>;
        mockTransactions = new RedisTransactions(mockConnectionManager) as jest.Mocked<RedisTransactions>;

        // Initialize the class under test
        atomicOperations = new RedisAtomicOperations(mockConnectionManager, mockTransactions);

        // Setup mock client
        mockConnectionManager.getClient = jest.fn().mockReturnValue({
            get: jest.fn(),
            set: jest.fn(),
            incrBy: jest.fn(),
            decrBy: jest.fn(),
            eval: jest.fn()
        });
    });

    describe('instance creation', () => {
        it('should create an instance of RedisAtomicOperations', () => {
            expect(atomicOperations).toBeInstanceOf(RedisAtomicOperations);
        });
    });

    describe('atomicIncrementWithExpiry', () => {
        it('should perform atomic increment successfully without expiry', async () => {
            const mockKey = 'test-key';
            const mockIncrement = 5;
            const mockFinalValue = 10;

            // Mock transaction success
            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: mockIncrement
            });

            // Mock get final value
            (mockConnectionManager.getClient().get as jest.Mock).mockResolvedValue(mockFinalValue.toString());

            const result = await atomicOperations.atomicIncrementWithExpiry(mockKey, mockIncrement);

            expect(result.success).toBe(true);
            expect(result.data).toBe(mockFinalValue);
            expect(mockTransactions.watchMultiExec).toHaveBeenCalled();
        });

        it('should perform atomic increment successfully with expiry', async () => {
            const mockKey = 'test-key';
            const mockIncrement = 5;
            const mockFinalValue = 10;
            const mockTtlMs = 60000;

            // Mock transaction success
            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: mockIncrement
            });

            // Mock get final value
            (mockConnectionManager.getClient().get as jest.Mock).mockResolvedValue(mockFinalValue.toString());

            const result = await atomicOperations.atomicIncrementWithExpiry(mockKey, mockIncrement, mockTtlMs);

            expect(result.success).toBe(true);
            expect(result.data).toBe(mockFinalValue);
            expect(mockTransactions.watchMultiExec).toHaveBeenCalled();
        });

        it('should handle atomic increment failure', async () => {
            const mockKey = 'test-key';
            const mockError = 'Transaction failed';

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: mockError
            });

            const result = await atomicOperations.atomicIncrementWithExpiry(mockKey);

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });

    describe('atomic operations with specific scenarios', () => {
        it('should handle conditional update when value is null', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { foo: 'bar' };
            const mockExpectedValue = null;

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: { updated: true }
            });

            // Mock getting current value (null)
            (mockConnectionManager.getClient().get as jest.Mock).mockResolvedValue(null);

            const result = await atomicOperations.atomicConditionalUpdate(mockKey, mockNewValue, mockExpectedValue);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
        });

        it('should handle balance transfer with zero initial balances', async () => {
            const mockFromKey = 'account:1';
            const mockToKey = 'account:2';
            const mockAmount = 100;

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: {
                    transferred: true,
                    fromBalance: -100,
                    toBalance: 100
                }
            });

            // Mock getting current balances (both 0)
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce(null) // from balance
                .mockResolvedValueOnce(null); // to balance

            const result = await atomicOperations.atomicBalanceTransfer(mockFromKey, mockToKey, mockAmount, false);

            expect(result.success).toBe(true);
            expect(result.data?.transferred).toBe(true);
            expect(result.data?.fromBalance).toBe(-100);
            expect(result.data?.toBalance).toBe(100);
        });

        it('should handle versioned update without expected version', async () => {
            const mockDataKey = 'data:1';
            const mockNewData = { foo: 'bar' };

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: {
                    updated: true,
                    newVersion: 1
                }
            });

            // Mock getting current version (not set)
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce(null);

            const result = await atomicOperations.atomicVersionedUpdate(mockDataKey, mockNewData);

            expect(result.success).toBe(true);
            expect(result.data?.updated).toBe(true);
            expect(result.data?.newVersion).toBe(1);
        });
    });

    describe('atomicConditionalUpdate', () => {
        it('should perform conditional update successfully when values match', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { foo: 'bar' };
            const mockExpectedValue = { foo: 'baz' };

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: { updated: true }
            });

            // Mock getting current value
            (mockConnectionManager.getClient().get as jest.Mock).mockResolvedValue(JSON.stringify(mockExpectedValue));

            const result = await atomicOperations.atomicConditionalUpdate(mockKey, mockNewValue, mockExpectedValue);

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
        });

        it('should not update when values do not match', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { foo: 'bar' };
            const mockExpectedValue = { foo: 'baz' };

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: { updated: false, reason: 'value_mismatch' }
            });

            // Mock getting current value
            (mockConnectionManager.getClient().get as jest.Mock).mockResolvedValue(JSON.stringify({ foo: 'different' }));

            const result = await atomicOperations.atomicConditionalUpdate(mockKey, mockNewValue, mockExpectedValue);

            expect(result.success).toBe(true);
            expect(result.data).toBe(false);
            expect(result.error).toBe('value_mismatch');
        });

        it('should handle conditional update failure', async () => {
            const mockKey = 'test-key';
            const mockError = 'Transaction failed';

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: mockError
            });

            const result = await atomicOperations.atomicConditionalUpdate(mockKey, {}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });

    describe('atomicCompositeUpdate operations', () => {
        it('should handle composite update with set operation', async () => {
            const mockUpdates: Array<{ key: string; value: unknown; operation?: 'set' | 'incr' | 'decr' }> = [{
                key: 'test:key',
                value: { foo: 'bar' },
                operation: 'set'
            }];

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: mockUpdates
            });

            const result = await atomicOperations.atomicCompositeUpdate(mockUpdates);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockUpdates);
        });

        it('should handle composite update with incr operation', async () => {
            const mockUpdates: Array<{ key: string; value: unknown; operation?: 'set' | 'incr' | 'decr' }> = [{
                key: 'test:key',
                value: 5,
                operation: 'incr'
            }];

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: mockUpdates
            });

            const result = await atomicOperations.atomicCompositeUpdate(mockUpdates);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockUpdates);
        });

        it('should handle composite update with decr operation', async () => {
            const mockUpdates: Array<{ key: string; value: unknown; operation?: 'set' | 'incr' | 'decr' }> = [{
                key: 'test:key',
                value: 3,
                operation: 'decr'
            }];

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: mockUpdates
            });

            const result = await atomicOperations.atomicCompositeUpdate(mockUpdates);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockUpdates);
        });
    });

    describe('atomicBalanceTransfer', () => {
        it('should perform successful balance transfer with sufficient funds', async () => {
            const mockFromKey = 'account:1';
            const mockToKey = 'account:2';
            const mockAmount = 100;

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: {
                    transferred: true,
                    fromBalance: 900,
                    toBalance: 1100
                }
            });

            // Mock getting current balances
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce('1000') // from balance
                .mockResolvedValueOnce('1000'); // to balance

            const result = await atomicOperations.atomicBalanceTransfer(mockFromKey, mockToKey, mockAmount);

            expect(result.success).toBe(true);
            expect(result.data?.transferred).toBe(true);
            expect(result.data?.fromBalance).toBe(900);
            expect(result.data?.toBalance).toBe(1100);
        });

        it('should reject transfer with insufficient funds', async () => {
            const mockFromKey = 'account:1';
            const mockToKey = 'account:2';
            const mockAmount = 1000;

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: {
                    transferred: false,
                    reason: 'insufficient_funds'
                }
            });

            // Mock getting current balances
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce('500') // from balance (insufficient)
                .mockResolvedValueOnce('1000'); // to balance

            const result = await atomicOperations.atomicBalanceTransfer(mockFromKey, mockToKey, mockAmount);

            expect(result.success).toBe(true);
            expect(result.data?.transferred).toBe(false);
            expect(result.error).toBe('insufficient_funds');
        });

        it('should handle balance transfer failure', async () => {
            const mockFromKey = 'account:1';
            const mockToKey = 'account:2';
            const mockAmount = 100;
            const mockError = 'Connection failed';

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: mockError
            });

            const result = await atomicOperations.atomicBalanceTransfer(mockFromKey, mockToKey, mockAmount);

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
            expect(result.data?.transferred).toBe(false);
        });
    });

    describe('atomicVersionedUpdate', () => {
        it('should perform successful versioned update with matching version', async () => {
            const mockDataKey = 'data:1';
            const mockNewData = { foo: 'bar' };
            const mockExpectedVersion = 1;

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: {
                    updated: true,
                    newVersion: 2
                }
            });

            // Mock getting current version
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce('1'); // current version

            const result = await atomicOperations.atomicVersionedUpdate(mockDataKey, mockNewData, mockExpectedVersion);

            expect(result.success).toBe(true);
            expect(result.data?.updated).toBe(true);
            expect(result.data?.newVersion).toBe(2);
        });

        it('should reject update when version mismatch', async () => {
            const mockDataKey = 'data:1';
            const mockNewData = { foo: 'bar' };
            const mockExpectedVersion = 1;

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: {
                    updated: false,
                    reason: 'version_mismatch',
                    currentVersion: 2
                }
            });

            // Mock getting current version
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce('2'); // current version (mismatch)

            const result = await atomicOperations.atomicVersionedUpdate(mockDataKey, mockNewData, mockExpectedVersion);

            expect(result.success).toBe(true);
            expect(result.data?.updated).toBe(false);
            expect(result.error).toBe('version_mismatch');
            expect(result.data?.currentVersion).toBe(2);
        });

        it('should handle versioned update failure', async () => {
            const mockDataKey = 'data:1';
            const mockError = 'Transaction failed';

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: mockError
            });

            const result = await atomicOperations.atomicVersionedUpdate(mockDataKey, {}, 1);

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
            expect(result.data?.updated).toBe(false);
        });
    });

    describe('atomicReadModifyWrite', () => {
        it('should perform successful read-modify-write operation', async () => {
            const mockKey = 'test-key';
            const mockCurrentValue = { count: 5 };
            const mockNewValue = { count: 6 };
            const mockModifier = jest.fn().mockReturnValue(mockNewValue);

            // Make the watchMultiExec mock call the actual operation
            mockTransactions.watchMultiExec.mockImplementation(async (_, operation) => {
                const result = await operation({ set: jest.fn() }); // Pass mock multi object with set method
                return { success: true, result };
            });

            // Mock getting current value
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValue(JSON.stringify(mockCurrentValue));

            const result = await atomicOperations.atomicReadModifyWrite(mockKey, mockModifier);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockNewValue);
            expect(mockModifier).toHaveBeenCalledWith(mockCurrentValue);
        });

        it('should handle read-modify-write with null current value', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { count: 1 };
            const mockModifier = jest.fn().mockReturnValue(mockNewValue);

            // Make the watchMultiExec mock call the actual operation
            mockTransactions.watchMultiExec.mockImplementation(async (_, operation) => {
                const result = await operation({ set: jest.fn() }); // Pass mock multi object with set method
                return { success: true, result };
            });

            // Mock cache miss
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValue(null);

            const result = await atomicOperations.atomicReadModifyWrite(mockKey, mockModifier);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockNewValue);
            expect(mockModifier).toHaveBeenCalledWith(null);
        });

        it('should handle read-modify-write with invalid JSON', async () => {
            const mockKey = 'test-key';
            const mockNewValue = { count: 1 };
            const mockModifier = jest.fn().mockReturnValue(mockNewValue);

            // Make the watchMultiExec mock call the actual operation
            mockTransactions.watchMultiExec.mockImplementation(async (_, operation) => {
                const result = await operation({ set: jest.fn() }); // Pass mock multi object with set method
                return { success: true, result };
            });

            // Mock getting invalid JSON value
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValue('invalid-json');

            const result = await atomicOperations.atomicReadModifyWrite(mockKey, mockModifier);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockNewValue);
            expect(mockModifier).toHaveBeenCalledWith(null);
        });

        it('should handle read-modify-write failure', async () => {
            const mockKey = 'test-key';
            const mockError = 'Transaction failed';

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: mockError
            });

            const result = await atomicOperations.atomicReadModifyWrite(mockKey, jest.fn());

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });

    describe('atomicOptimisticUpdate', () => {
        it('should perform successful optimistic update', async () => {
            const mockKey = 'test-key';
            const mockCurrentData = { count: 5 };
            const mockNewData = { count: 6 };
            const mockUpdateFunction = jest.fn().mockReturnValue(mockNewData);

            // Make the watchMultiExec mock call the actual operation
            mockTransactions.watchMultiExec.mockImplementation(async (_, operation) => {
                const result = await operation({ set: jest.fn() }); // Pass mock multi object with set method
                return { success: true, result: { newData: mockNewData, version: 2 } };
            });

            // Mock getting current data and version
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce(JSON.stringify(mockCurrentData))
                .mockResolvedValueOnce('1');

            const result = await atomicOperations.atomicOptimisticUpdate(mockKey, mockUpdateFunction);

            expect(result.success).toBe(true);
            expect(result.data?.newData).toEqual(mockNewData);
            expect(result.data?.version).toBe(2);
            expect(mockUpdateFunction).toHaveBeenCalledWith(mockCurrentData);
        });

        it('should handle optimistic update with version key', async () => {
            const mockKey = 'test-key';
            const mockVersionKey = 'test-key:version';
            const mockCurrentData = { count: 5 };
            const mockNewData = { count: 6 };
            const mockUpdateFunction = jest.fn().mockReturnValue(mockNewData);

            // Make the watchMultiExec mock call the actual operation
            mockTransactions.watchMultiExec.mockImplementation(async (_, operation) => {
                const result = await operation({ set: jest.fn() }); // Pass mock multi object with set method
                return { success: true, result: { newData: mockNewData, version: 2 } };
            });

            // Mock getting current data and version
            (mockConnectionManager.getClient().get as jest.Mock)
                .mockResolvedValueOnce(JSON.stringify(mockCurrentData))
                .mockResolvedValueOnce('1');

            const result = await atomicOperations.atomicOptimisticUpdate(mockKey, mockUpdateFunction, 3, mockVersionKey);

            expect(result.success).toBe(true);
            expect(result.data?.newData).toEqual(mockNewData);
            expect(result.data?.version).toBe(2);
            expect(mockUpdateFunction).toHaveBeenCalledWith(mockCurrentData);
        });

        it('should handle optimistic update with max retries exceeded', async () => {
            const mockKey = 'test-key';
            const mockError = 'Max retries exceeded';

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: 'Conflict'
            });

            const result = await atomicOperations.atomicOptimisticUpdate(mockKey, jest.fn(), 2);

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });

        it('should handle optimistic update with exception', async () => {
            const mockKey = 'test-key';
            const mockError = 'Network error';

            mockTransactions.watchMultiExec.mockRejectedValue(new Error(mockError));

            const result = await atomicOperations.atomicOptimisticUpdate(mockKey, jest.fn());

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });

    describe('atomicCompositeUpdate', () => {
        it('should perform successful composite update with multiple operations', async () => {
            const mockUpdates: Array<{ key: string; value: unknown; operation?: 'set' | 'incr' | 'decr' }> = [
                { key: 'key1', value: { foo: 'bar' }, operation: 'set' },
                { key: 'key2', value: 5, operation: 'incr' },
                { key: 'key3', value: 2, operation: 'decr' }
            ];

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: true,
                result: mockUpdates
            });

            const result = await atomicOperations.atomicCompositeUpdate(mockUpdates);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockUpdates);
        });

        it('should handle composite update failure', async () => {
            const mockUpdates = [{ key: 'key1', value: 'value' }];
            const mockError = 'Transaction failed';

            mockTransactions.watchMultiExec.mockResolvedValue({
                success: false,
                error: mockError
            });

            const result = await atomicOperations.atomicCompositeUpdate(mockUpdates);

            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });
});