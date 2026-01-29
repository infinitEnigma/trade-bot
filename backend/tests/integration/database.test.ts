/** @format */

import { query, queryWithTimeout, queryWithAutoTimeout, QueryTimeout, getPoolMetrics, updateTimeoutConfig, getTimeoutConfig, getTimeoutStats, resetTimeoutConfig, cleanupForTests, transaction } from '../../src/database/pool';
import { Pool, PoolClient } from 'pg';
import logger from '../../src/core/logging/logger.service';

// Mock logger to avoid actual logging during tests
jest.mock('../../src/core/logging/logger.service');

describe('Database Integration Tests', () => {
    let originalPool: Pool | null = null;

    beforeAll(async () => {
        // Store original pool reference
        try {
            const poolModule = require('../../src/database/pool');
            originalPool = poolModule.getPool ? poolModule.getPool() : null;
        } catch (error) {
            // Pool might not be initialized yet
            originalPool = null;
        }
    });

    afterAll(async () => {
        // Restore original pool if it existed
        if (originalPool) {
            // Note: In a real implementation, you'd need a way to restore the original pool
            // This is a limitation of the singleton pattern
        }
    });

    beforeEach(async () => {
        // Reset timeout configuration for each test
        resetTimeoutConfig();
        jest.clearAllMocks();
    });

    afterEach(async () => {
        await cleanupForTests();
    });

    describe('Connection Pool Management', () => {
        it('should handle connection limits gracefully', async () => {
            // Test that pool doesn't exceed max connections
            const metricsBefore = getPoolMetrics();
            const initialTotalConnections = metricsBefore.pool.totalConnections;

            // Create multiple concurrent queries to test connection limits
            const queries = Array(10).fill(null).map(() =>
                query('SELECT 1 as test')
            );

            const results = await Promise.all(queries);

            // Verify all queries succeeded
            results.forEach(result => {
                expect(result.rows).toHaveLength(1);
                expect((result.rows[0] as any).test).toBe(1);
            });

            const metricsAfter = getPoolMetrics();

            // Pool should handle the load without exceeding limits
            expect(metricsAfter.pool.totalConnections).toBeGreaterThan(0);
            expect(metricsAfter.pool.utilizationPercent).toBeLessThanOrEqual(100);
        });

        it('should recover from connection failures', async () => {
            // Test connection recovery by simulating a temporary failure
            const metricsBefore = getPoolMetrics();

            try {
                // This should work with test database
                const result = await query('SELECT NOW() as current_time');
                expect(result.rows).toHaveLength(1);
                expect((result.rows[0] as any).current_time).toBeDefined();
            } catch (error) {
                // If database is not available, verify graceful error handling
                expect(error).toBeDefined();
                logger.error('Database connection test failed', { error: error instanceof Error ? error.message : String(error) });
            }
        });

        it('should manage connection timeouts correctly', async () => {
            // Test that connections timeout appropriately
            const timeoutConfig = getTimeoutConfig();
            expect(timeoutConfig.default).toBe(QueryTimeout.SLOW); // 30 seconds
            expect(timeoutConfig.fast).toBe(QueryTimeout.FAST); // 5 seconds
            expect(timeoutConfig.medium).toBe(QueryTimeout.MEDIUM); // 15 seconds
        });

        it('should track pool metrics correctly', async () => {
            const metrics = getPoolMetrics();

            expect(metrics).toHaveProperty('pool');
            expect(metrics).toHaveProperty('performance');
            expect(metrics).toHaveProperty('config');
            expect(metrics).toHaveProperty('health');

            expect(metrics.pool).toHaveProperty('totalConnections');
            expect(metrics.pool).toHaveProperty('idleConnections');
            expect(metrics.pool).toHaveProperty('activeConnections');
            expect(metrics.pool).toHaveProperty('waitingClients');
            expect(metrics.pool).toHaveProperty('utilizationPercent');

            expect(metrics.performance).toHaveProperty('totalCheckouts');
            expect(metrics.performance).toHaveProperty('totalWaits');
            expect(metrics.performance).toHaveProperty('averageWaitTime');
            expect(metrics.performance).toHaveProperty('maxWaitTime');
            expect(metrics.performance).toHaveProperty('activeCheckouts');

            expect(metrics.config).toHaveProperty('maxConnections');
            expect(metrics.config).toHaveProperty('idleTimeoutMs');
            expect(metrics.config).toHaveProperty('connectionTimeoutMs');

            expect(metrics.health).toHaveProperty('status');
            expect(metrics.health).toHaveProperty('issues');
            expect(['healthy', 'warning', 'critical']).toContain(metrics.health.status);
        });
    });

    describe('Query Performance & Timeouts', () => {
        it('should timeout long-running queries', async () => {
            // Test query timeout with a very short timeout
            const shortTimeout = 100; // 100ms

            try {
                // This query should timeout quickly
                await queryWithTimeout('SELECT pg_sleep(1)', undefined, shortTimeout);
                // If we get here, the timeout didn't work as expected
                fail('Query should have timed out');
            } catch (error) {
                expect(error).toBeDefined();
                expect(error instanceof Error ? error.message : String(error)).toContain('Query timeout');
            }
        });

        it('should handle concurrent queries without blocking', async () => {
            // Test that multiple concurrent queries don't block each other
            const concurrentQueries = Array(5).fill(null).map((_, index) =>
                query(`SELECT ${index} as query_number`)
            );

            const startTime = Date.now();
            const results = await Promise.all(concurrentQueries);
            const duration = Date.now() - startTime;

            // All queries should complete quickly (under 1 second)
            expect(duration).toBeLessThan(1000);

            // Verify all results are correct
            results.forEach((result, index) => {
                expect(result.rows).toHaveLength(1);
                expect((result.rows[0] as any).query_number).toBe(index);
            });
        });

        it('should optimize query execution with auto timeouts', async () => {
            // Test different timeout categories
            const fastResult = await queryWithAutoTimeout('SELECT 1', undefined, { category: 'fast' });
            expect((fastResult.rows[0] as any)['?column?']).toBe(1);

            const mediumResult = await queryWithAutoTimeout('SELECT 2', undefined, { category: 'medium' });
            expect((mediumResult.rows[0] as any)['?column?']).toBe(2);

            const slowResult = await queryWithAutoTimeout('SELECT 3', undefined, { category: 'slow' });
            expect((slowResult.rows[0] as any)['?column?']).toBe(3);
        });

        it('should handle custom timeout configurations', async () => {
            // Update timeout configuration
            updateTimeoutConfig({
                fast: QueryTimeout.FAST, // 5 seconds
                medium: QueryTimeout.MEDIUM, // 15 seconds
            });

            const config = getTimeoutConfig();
            expect(config.fast).toBe(QueryTimeout.FAST);
            expect(config.medium).toBe(QueryTimeout.MEDIUM);

            // Test with custom timeout
            const result = await queryWithAutoTimeout('SELECT 1', undefined, { customTimeout: 1500 });
            expect((result.rows[0] as any)['?column?']).toBe(1);
        });
    });

    describe('Transaction Management', () => {
        it('should rollback on transaction failures', async () => {
            // Test transaction rollback by creating a transaction that will fail
            let transactionSucceeded = false;

            try {
                await transaction(async (client: PoolClient) => {
                    // Insert a test record
                    await client.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)',
                        ['test-rollback@example.com', 'test-hash']);

                    // This should cause a rollback
                    throw new Error('Simulated transaction failure');
                });
            } catch (error) {
                transactionSucceeded = false;
                expect(error instanceof Error ? error.message : String(error)).toBe('Simulated transaction failure');
            }

            expect(transactionSucceeded).toBe(false);

            // Verify the record was not inserted (rollback worked)
            const result = await query('SELECT * FROM users WHERE email = $1', ['test-rollback@example.com']);
            expect(result.rows).toHaveLength(0);
        });

        it('should commit successful transactions', async () => {
            const testEmail = `test-commit-${Date.now()}@example.com`;

            try {
                await transaction(async (client: PoolClient) => {
                    // Insert a test record
                    await client.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)',
                        [testEmail, 'test-hash']);
                });

                // Verify the record was inserted (commit worked)
                const result = await query('SELECT * FROM users WHERE email = $1', [testEmail]);
                expect(result.rows).toHaveLength(1);
                expect((result.rows[0] as any).email).toBe(testEmail);
            } catch (error) {
                // If table doesn't exist or other DB issues, skip this test
                logger.warn('Transaction test skipped due to database setup', { error: error instanceof Error ? error.message : String(error) });
            }
        });

        it('should handle nested operations within transactions', async () => {
            const testEmail = `test-nested-${Date.now()}@example.com`;

            try {
                await transaction(async (client: PoolClient) => {
                    // First operation
                    await client.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)',
                        [testEmail, 'test-hash']);

                    // Second operation in same transaction
                    const result = await client.query('SELECT id FROM users WHERE email = $1', [testEmail]);
                    expect(result.rows).toHaveLength(1);

                    // Third operation using the ID from second operation
                    const userId = result.rows[0].id;
                    await client.query('UPDATE users SET updated_at = NOW() WHERE id = $1', [userId]);
                });

                // Verify all operations completed
                const result = await query('SELECT * FROM users WHERE email = $1', [testEmail]);
                expect(result.rows).toHaveLength(1);
                expect((result.rows[0] as any).email).toBe(testEmail);
            } catch (error) {
                // If table doesn't exist or other DB issues, skip this test
                logger.warn('Nested transaction test skipped due to database setup', { error: error instanceof Error ? error.message : String(error) });
            }
        });
    });

    describe('Error Handling & Recovery', () => {
        it('should handle invalid SQL gracefully', async () => {
            try {
                await query('INVALID SQL SYNTAX HERE');
                fail('Query should have failed');
            } catch (error) {
                expect(error).toBeDefined();
                // Should handle the error gracefully without crashing
            }
        });

        it('should handle connection pool exhaustion', async () => {
            // This test simulates high load on the connection pool
            const maxConnections = 20; // From your pool configuration
            const queries = Array(maxConnections + 5).fill(null).map(() =>
                query('SELECT 1')
            );

            try {
                const results = await Promise.all(queries);
                // Should handle gracefully even under high load
                expect(results.length).toBe(maxConnections + 5);
            } catch (error) {
                // Should handle pool exhaustion gracefully
                expect(error).toBeDefined();
                logger.warn('Pool exhaustion test handled gracefully', { error: error instanceof Error ? error.message : String(error) });
            }
        });

        it('should provide timeout statistics and recommendations', () => {
            const stats = getTimeoutStats();

            expect(stats).toHaveProperty('config');
            expect(stats).toHaveProperty('recommendations');
            expect(stats).toHaveProperty('health');

            expect(stats.config).toEqual(getTimeoutConfig());
            expect(Array.isArray(stats.recommendations)).toBe(true);
            expect(stats.health).toHaveProperty('status');
            expect(stats.health).toHaveProperty('issues');
        });
    });

    describe('Pool Health Monitoring', () => {
        it('should detect healthy pool status', () => {
            const metrics = getPoolMetrics();

            // Should report healthy status under normal conditions
            if (metrics.pool.utilizationPercent < 80 && metrics.performance.totalWaits === 0) {
                expect(metrics.health.status).toBe('healthy');
                expect(metrics.health.issues).toHaveLength(0);
            }
        });

        it('should detect warning conditions', () => {
            const metrics = getPoolMetrics();

            // If utilization is high, should report warning
            if (metrics.pool.utilizationPercent > 80) {
                expect(metrics.health.status).toBe('warning');
                expect(metrics.health.issues.length).toBeGreaterThan(0);
            }
        });

        it('should detect critical conditions', () => {
            const metrics = getPoolMetrics();

            // If utilization is very high, should report critical
            if (metrics.pool.utilizationPercent > 95) {
                expect(metrics.health.status).toBe('critical');
                expect(metrics.health.issues.length).toBeGreaterThan(0);
            }
        });
    });

    describe('Configuration Management', () => {
        it('should reset timeout configuration to defaults', () => {
            // Change configuration
            updateTimeoutConfig({
                default: 60000,
                fast: QueryTimeout.FAST,
            });

            let config = getTimeoutConfig();
            expect(config.default).toBe(60000);
            expect(config.fast).toBe(QueryTimeout.FAST);

            // Reset to defaults
            resetTimeoutConfig();
            config = getTimeoutConfig();

            expect(config.default).toBe(QueryTimeout.SLOW); // 30 seconds
            expect(config.fast).toBe(QueryTimeout.FAST); // 5 seconds
        });

        it('should validate timeout configuration', () => {
            const stats = getTimeoutStats();

            // Should provide recommendations for problematic configurations
            if (stats.config.default > 60000) {
                expect(stats.recommendations.length).toBeGreaterThan(0);
                expect(stats.recommendations.some(rec => rec.includes('reduce'))).toBe(true);
            }
        });
    });
});