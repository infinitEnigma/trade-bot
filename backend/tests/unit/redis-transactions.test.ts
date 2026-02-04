/** @format */

import { RedisTransactions, TransactionOptions, SmartRetryResult, RetryStrategy } from '../../src/infrastructure/cache/redis/transactions';

describe('RedisTransactions', () => {
    let transactions: RedisTransactions;
    let mockConnectionManager: any;
    let mockClient: any;

    beforeEach(() => {
        // Create mock client
        mockClient = {
            watch: jest.fn().mockResolvedValue(void 0),
            unwatch: jest.fn().mockResolvedValue(void 0),
            multi: jest.fn(),
        };

        // Create mock connection manager
        mockConnectionManager = {
            getClient: jest.fn().mockReturnValue(mockClient),
        };

        transactions = new RedisTransactions(mockConnectionManager);
    });

    describe('instance creation', () => {
        it('should create an instance of RedisTransactions', () => {
            expect(transactions).toBeInstanceOf(RedisTransactions);
        });
    });

    describe('watchMultiExec operation', () => {
        it('should execute transaction successfully on first attempt', async () => {
            const testKeys = ['key1', 'key2'];
            const testResult = 'transaction-result';
            const mockMulti = {
                exec: jest.fn().mockResolvedValue([testResult]),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue(testResult),
                5
            );

            expect(mockClient.watch).toHaveBeenCalledWith(testKeys);
            expect(mockClient.multi).toHaveBeenCalled();
            expect(mockMulti.exec).toHaveBeenCalled();
            expect(mockClient.unwatch).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.result).toBe(testResult);
            expect(result.attempts).toBe(1);
            expect(result.error).toBeUndefined();
        });

        it('should handle transaction abortion due to watched key changes', async () => {
            const testKeys = ['key1', 'key2'];
            const mockMulti = {
                exec: jest.fn().mockResolvedValue(null),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue('should-not-return'),
                1
            );

            expect(mockClient.watch).toHaveBeenCalledWith(testKeys);
            expect(mockClient.multi).toHaveBeenCalled();
            expect(mockMulti.exec).toHaveBeenCalled();
            expect(mockClient.unwatch).toHaveBeenCalled();
            expect(result.success).toBe(false);
            expect(result.result).toBeUndefined();
            expect(result.attempts).toBe(1);
            expect(result.error).toContain('Transaction aborted');
        });

        it('should retry failed transaction and succeed', async () => {
            const testKeys = ['key1', 'key2'];
            const testResult = 'transaction-result';
            const mockMulti1 = {
                exec: jest.fn().mockResolvedValue(null),
            };
            const mockMulti2 = {
                exec: jest.fn().mockResolvedValue([testResult]),
            };
            mockClient.multi.mockReturnValueOnce(mockMulti1).mockReturnValueOnce(mockMulti2);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue(testResult),
                2
            );

            expect(mockClient.watch).toHaveBeenCalledTimes(2);
            expect(mockClient.multi).toHaveBeenCalledTimes(2);
            expect(mockClient.unwatch).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
            expect(result.result).toBe(testResult);
            expect(result.attempts).toBe(2);
        });

        it('should fail after maximum retry attempts', async () => {
            const testKeys = ['key1', 'key2'];
            const mockMulti = {
                exec: jest.fn().mockResolvedValue(null),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue('should-not-return'),
                3
            );

            expect(mockClient.watch).toHaveBeenCalledTimes(3);
            expect(mockClient.multi).toHaveBeenCalledTimes(3);
            expect(mockClient.unwatch).toHaveBeenCalledTimes(3);
            expect(result.success).toBe(false);
            expect(result.attempts).toBe(3);
            expect(result.error).toContain('after 3 attempts');
        });

        it('should handle errors during transaction execution', async () => {
            const testKeys = ['key1', 'key2'];
            const testError = new Error('Connection timeout');
            mockClient.watch.mockRejectedValue(testError);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue('should-not-return'),
                1
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });

        it('should use immediate retry strategy for critical priority', async () => {
            const testKeys = ['key1', 'key2'];
            const testResult = 'transaction-result';
            const mockMulti1 = {
                exec: jest.fn().mockResolvedValue(null),
            };
            const mockMulti2 = {
                exec: jest.fn().mockResolvedValue([testResult]),
            };
            mockClient.multi.mockReturnValueOnce(mockMulti1).mockReturnValueOnce(mockMulti2);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue(testResult),
                2,
                { priority: 'critical', context: 'test-critical' }
            );

            expect(result.success).toBe(true);
            expect(result.strategy).toBe(RetryStrategy.IMMEDIATE_RETRY);
        });

        it('should handle circuit breaker open state', async () => {
            const testKeys = ['key1', 'key2'];

            // Make circuit breaker open
            // We need to access the transaction recovery manager which is private
            // For testing purposes, let's simulate multiple failures
            const mockMulti = {
                exec: jest.fn().mockRejectedValue(new Error('Connection error')),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            // Perform multiple failed attempts to open circuit breaker
            for (let i = 0; i < 10; i++) {
                await transactions.watchMultiExec(
                    testKeys,
                    jest.fn().mockResolvedValue('should-not-return'),
                    1
                );
            }

            // Now circuit breaker should be open
            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue('should-not-return'),
                1
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Circuit breaker open');
        });
    });

    describe('transaction options', () => {
        it('should respect custom timeout option', async () => {
            const testKeys = ['key1', 'key2'];
            const testResult = 'transaction-result';
            const mockMulti = {
                exec: jest.fn().mockResolvedValue([testResult]),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue(testResult),
                5,
                { timeout: 5000, context: 'test-with-timeout' }
            );

            expect(result.success).toBe(true);
            expect(result.result).toBe(testResult);
        });

        it('should handle different priority levels', async () => {
            const testKeys = ['key1', 'key2'];
            const testResult = 'transaction-result';
            const mockMulti = {
                exec: jest.fn().mockResolvedValue([testResult]),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const priorities: Array<'low' | 'normal' | 'high' | 'critical'> = ['low', 'normal', 'high', 'critical'];
            for (const priority of priorities) {
                const result = await transactions.watchMultiExec(
                    testKeys,
                    jest.fn().mockResolvedValue(testResult),
                    1,
                    { priority, context: `test-priority-${priority}` }
                );

                expect(result.success).toBe(true);
            }
        });

        it('should include context information in error', async () => {
            const testKeys = ['key1', 'key2'];
            const mockMulti = {
                exec: jest.fn().mockResolvedValue(null),
            };
            mockClient.multi.mockReturnValue(mockMulti);

            const testContext = 'user-withdrawal';
            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue('should-not-return'),
                1,
                { context: testContext }
            );

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('transaction recovery manager', () => {
        it('should select appropriate retry strategy based on conflict history', async () => {
            const testKeys = ['key1', 'key2'];
            const testResult = 'transaction-result';

            // First, create successful transaction
            const mockMultiSuccess = {
                exec: jest.fn().mockResolvedValue([testResult]),
            };
            mockClient.multi.mockReturnValue(mockMultiSuccess);

            // Perform multiple successful transactions
            for (let i = 0; i < 5; i++) {
                await transactions.watchMultiExec(
                    testKeys,
                    jest.fn().mockResolvedValue(testResult),
                    1,
                    { context: 'test-strategy-selection' }
                );
            }

            // Then create a transaction that fails
            const mockMultiFail = {
                exec: jest.fn().mockResolvedValue(null),
            };
            mockClient.multi.mockReturnValue(mockMultiFail);

            const result = await transactions.watchMultiExec(
                testKeys,
                jest.fn().mockResolvedValue('should-not-return'),
                2,
                { context: 'test-strategy-selection' }
            );

            expect(result.strategy).toBeDefined();
        });
    });
});