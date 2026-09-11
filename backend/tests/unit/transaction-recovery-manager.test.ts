/** @format */

import { redisService } from '../../src/infrastructure/cache/redis.service';
import { RedisTransactions } from '../../src/infrastructure/cache/redis/transactions';
import { RedisConnectionManager } from '../../src/infrastructure/cache/redis/connection-manager';

describe('TransactionRecoveryManager Uncovered Scenarios', () => {
    let mockClient: any;
    let redisTransactions: RedisTransactions;
    let connectionManager: RedisConnectionManager;

    beforeEach(() => {
        // Reset modules and create fresh instances
        jest.resetModules();
        const module = require('../../src/infrastructure/cache/redis.service');
        mockClient = module.redisService.getClient();

        // Create RedisTransactions instance with mock connection manager
        connectionManager = new RedisConnectionManager();
        const getClientSpy = jest.spyOn(connectionManager, 'getClient').mockReturnValue(mockClient);
        redisTransactions = new RedisTransactions(connectionManager);

        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('circuit breaker functionality', () => {
        it('should return error when circuit breaker is open and not ready to reset', async () => {
            // Need to access transactionRecoveryManager - let's use private access
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Directly set circuit breaker to open state
            recoveryManager.circuitBreakerState = 'open';
            recoveryManager.circuitBreakerLastFailure = Date.now();

            // Mock the transaction methods to prevent real Redis calls
            jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK']),
            };
            jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisTransactions.watchMultiExec(
                ['test-key'],
                async (multi: any) => {
                    multi.set('test-key', 'test-value');
                    return 'success';
                },
                1
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Circuit breaker open');
            expect(result.strategy).toBeDefined();
        });

        it('should transition to half-open when circuit breaker timeout passed', async () => {
            // Need to access transactionRecoveryManager - let's use private access
            const transactionsModule = require('../../src/infrastructure/cache/redis/transactions');
            const RedisTransactionsInstance = transactionsModule.RedisTransactions;

            // Create a spy to track circuit breaker state
            const originalConstructor = RedisTransactionsInstance.prototype.constructor;
            jest.spyOn(RedisTransactionsInstance.prototype, 'constructor').mockImplementation(function (this: any) {
                originalConstructor.apply(this, arguments);
                // Directly set circuit breaker to open state with old failure time
                (this as any).transactionRecoveryManager.circuitBreakerState = 'open';
                (this as any).transactionRecoveryManager.circuitBreakerLastFailure = Date.now() - 70000; // 70 seconds ago
            });

            const mockConnectionManager = new RedisConnectionManager();
            jest.spyOn(mockConnectionManager, 'getClient').mockReturnValue(mockClient);

            const testTransactions = new RedisTransactions(mockConnectionManager);

            // Mock successful transaction
            jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK']),
            };
            jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await testTransactions.watchMultiExec(
                ['test-key'],
                async (multi: any) => {
                    multi.set('test-key', 'test-value');
                    return 'success';
                },
                1
            );

            expect(result.success).toBe(true);
        });

        it('should open circuit breaker after repeated errors', async () => {
            const transactionsModule = require('../../src/infrastructure/cache/redis/transactions');
            const RedisTransactionsInstance = transactionsModule.RedisTransactions;

            const mockConnectionManager = new RedisConnectionManager();
            jest.spyOn(mockConnectionManager, 'getClient').mockReturnValue(mockClient);

            const testTransactions = new RedisTransactions(mockConnectionManager);

            // Get access to transactionRecoveryManager
            const recoveryManager = (testTransactions as any).transactionRecoveryManager;
            recoveryManager.circuitBreakerFailures = 9; // Just below threshold

            // Mock transaction that throws error
            jest.spyOn(mockClient, 'watch').mockRejectedValue(new Error('Connection error'));
            jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const result = await testTransactions.watchMultiExec(
                ['test-key'],
                async (multi: any) => {
                    multi.set('test-key', 'test-value');
                    return 'success';
                },
                1
            );

            expect(result.success).toBe(false);
            expect(recoveryManager.circuitBreakerState).toBe('open');
        });
    });

    describe('retry strategy selection', () => {
        it('should select immediate retry for critical priority', async () => {
            // Setup transaction to succeed immediately
            jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(['OK']),
            };
            jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisTransactions.watchMultiExec(
                ['test-key'],
                async (multi: any) => {
                    multi.set('test-key', 'test-value');
                    return 'success';
                },
                1,
                { priority: 'critical' }
            );

            expect(result.success).toBe(true);
            expect(result.strategy).toBe('immediate');
        });

        it('should select circuit breaker strategy for high recent conflicts', async () => {
            // Need to access transactionRecoveryManager directly for this test
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Test the strategy selection method directly
            const strategy = recoveryManager.selectRetryStrategy({
                totalConflicts: 6,
                recentConflicts: 6, // > 5
                successRate: 0.2,
                averageDelay: 100,
                lastConflictTime: Date.now()
            }, {
                maxRetries: 5,
                context: 'test',
                priority: 'normal'
            });

            expect(strategy).toBe('circuit');
        });

        it('should select adaptive delay for low success rate', async () => {
            // Need to access transactionRecoveryManager directly for this test
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Test the strategy selection method directly
            const strategy = recoveryManager.selectRetryStrategy({
                totalConflicts: 4, // > 3
                recentConflicts: 1,
                successRate: 0.4, // < 0.5
                averageDelay: 100,
                lastConflictTime: Date.now()
            }, {
                maxRetries: 5,
                context: 'test',
                priority: 'normal'
            });

            expect(strategy).toBe('adaptive');
        });

        it('should default to exponential backoff', async () => {
            // Setup transaction to fail repeatedly to build conflict history
            jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            let attemptCount = 0;
            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockImplementation(() => {
                    attemptCount++;
                    return Promise.resolve(null); // Transaction aborted
                }),
            };
            jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            // Need to access transactionRecoveryManager
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;
            // Set normal conflict stats
            recoveryManager.conflictHistory.set('test-key', {
                totalConflicts: 2,
                recentConflicts: 1,
                successRate: 0.6,
                averageDelay: 100,
                lastConflictTime: Date.now()
            });

            const result = await redisTransactions.watchMultiExec(
                ['test-key'],
                async (multi: any) => {
                    multi.set('test-key', 'test-value');
                    return 'success';
                },
                1
            );

            expect(result.success).toBe(false);
            expect(result.strategy).toBe('backoff');
        });
    });

    describe('calculate delay methods', () => {
        it('should calculate immediate retry delay correctly', async () => {
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Test various attempts
            expect(recoveryManager.calculateDelay('immediate', 'test-key', 1, { maxRetries: 5, context: 'test', priority: 'critical' }))
                .toBeLessThanOrEqual(50);
            expect(recoveryManager.calculateDelay('immediate', 'test-key', 5, { maxRetries: 5, context: 'test', priority: 'critical' }))
                .toEqual(50);
        });

        it('should calculate exponential backoff delay correctly', async () => {
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Test various attempts
            const delay1 = recoveryManager.calculateDelay('backoff', 'test-key', 1, { maxRetries: 5, context: 'test', priority: 'normal' });
            const delay2 = recoveryManager.calculateDelay('backoff', 'test-key', 2, { maxRetries: 5, context: 'test', priority: 'normal' });

            expect(delay1).toBeGreaterThan(0);
            expect(delay2).toBeGreaterThan(delay1);
        });

        it('should calculate circuit breaker delay correctly', async () => {
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Test various attempts
            const delay1 = recoveryManager.calculateDelay('circuit', 'test-key', 1, { maxRetries: 5, context: 'test', priority: 'normal' });
            const delay2 = recoveryManager.calculateDelay('circuit', 'test-key', 2, { maxRetries: 5, context: 'test', priority: 'normal' });

            expect(delay1).toBeGreaterThan(0);
            expect(delay2).toBeGreaterThan(delay1);
        });

        it('should calculate adaptive delay based on success rate', async () => {
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Set different success rates
            recoveryManager.successRates.set('test-key-low', 0.2); // < 0.3
            recoveryManager.successRates.set('test-key-medium', 0.5); // < 0.7
            recoveryManager.successRates.set('test-key-high', 0.8); // >= 0.7

            const delayLow = recoveryManager.calculateDelay('adaptive', 'test-key-low', 1, { maxRetries: 5, context: 'test', priority: 'normal' });
            const delayMedium = recoveryManager.calculateDelay('adaptive', 'test-key-medium', 1, { maxRetries: 5, context: 'test', priority: 'normal' });
            const delayHigh = recoveryManager.calculateDelay('adaptive', 'test-key-high', 1, { maxRetries: 5, context: 'test', priority: 'normal' });

            expect(delayLow).toBeGreaterThan(delayMedium);
            expect(delayMedium).toBeGreaterThan(delayHigh);
        });
    });

    describe('getRecoveryStats method', () => {
        it('should return recovery statistics', async () => {
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Get initial stats
            const initialStats = recoveryManager.getRecoveryStats();
            expect(initialStats.circuitBreaker).toBeDefined();
            expect(initialStats.adaptiveLearning).toBeDefined();
            expect(initialStats.conflictHistory).toBeDefined();

            expect(initialStats.circuitBreaker.state).toEqual('closed');
            expect(initialStats.circuitBreaker.failures).toEqual(0);
            expect(initialStats.adaptiveLearning.trackedKeys).toEqual(0);
            expect(initialStats.conflictHistory.trackedSignatures).toEqual(0);
        });

        it('should include adaptive learning data in recovery stats', async () => {
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Set some learning data
            recoveryManager.successRates.set('test-key-1', 0.75);
            recoveryManager.successRates.set('test-key-2', 0.45);
            recoveryManager.optimalDelays.set('test-key-1', 200);
            recoveryManager.optimalDelays.set('test-key-2', 500);
            recoveryManager.optimalDelays.set('test-key-3', 800);

            const stats = recoveryManager.getRecoveryStats();

            expect(stats.adaptiveLearning.trackedKeys).toEqual(2);
            expect(stats.adaptiveLearning.optimalDelaysConfigured).toEqual(3);
            expect(stats.adaptiveLearning.averageSuccessRate).toBeCloseTo((0.75 + 0.45) / 2);
        });

        it('should include conflict history in recovery stats', async () => {
            const recoveryManager = (redisTransactions as any).transactionRecoveryManager;

            // Set conflict history
            recoveryManager.conflictHistory.set('test-key-1', {
                totalConflicts: 3,
                recentConflicts: 1,
                successRate: 0.666,
                averageDelay: 100,
                lastConflictTime: Date.now()
            });
            recoveryManager.conflictHistory.set('test-key-2', {
                totalConflicts: 5,
                recentConflicts: 2,
                successRate: 0.6,
                averageDelay: 150,
                lastConflictTime: Date.now()
            });

            const stats = recoveryManager.getRecoveryStats();

            expect(stats.conflictHistory.trackedSignatures).toEqual(2);
            expect(stats.conflictHistory.totalConflicts).toEqual(8);
        });
    });

    describe('max retries scenario', () => {
        it('should return max retries error when all attempts fail', async () => {
            // Setup transaction to fail all attempts
            jest.spyOn(mockClient, 'watch').mockResolvedValue(undefined);
            jest.spyOn(mockClient, 'unwatch').mockResolvedValue(undefined);

            const mockMulti = {
                set: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null), // Transaction aborted
            };
            jest.spyOn(mockClient, 'multi').mockReturnValue(mockMulti);

            const result = await redisTransactions.watchMultiExec(
                ['test-key'],
                async (multi: any) => {
                    multi.set('test-key', 'test-value');
                    return 'success';
                },
                2
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Transaction aborted after');
            expect(result.attempts).toEqual(2);
            expect(result.totalDelay).toBeGreaterThan(0);
        });
    });
});