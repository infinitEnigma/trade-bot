/** @format */

import { RedisMetrics } from '../../src/infrastructure/cache/redis/metrics';

describe('RedisMetrics', () => {
    let metrics: RedisMetrics;
    let mockConnectionManager: any;
    let mockClient: any;

    beforeEach(() => {
        // Create mock client
        mockClient = {
            dbSize: jest.fn(),
            info: jest.fn(),
            ping: jest.fn(),
        };

        // Create mock connection manager
        mockConnectionManager = {
            isHealthy: jest.fn(),
            getClient: jest.fn().mockReturnValue(mockClient),
            getHealth: jest.fn().mockReturnValue({
                connected: true,
                ready: true,
            }),
        };

        metrics = new RedisMetrics(mockConnectionManager);
    });

    describe('instance creation', () => {
        it('should create an instance of RedisMetrics', () => {
            expect(metrics).toBeInstanceOf(RedisMetrics);
        });
    });

    describe('transaction metrics', () => {
        it('should record successful transactions', () => {
            metrics.recordTransactionAttempt(true, 1, 0);

            const stats = metrics.getTransactionStats();
            expect(stats.transactionsAttempted).toBe(1);
            expect(stats.transactionsSuccessful).toBe(1);
            expect(stats.transactionsFailed).toBe(0);
            expect(stats.lastTransactionTime).toBeDefined();
        });

        it('should record failed transactions', () => {
            metrics.recordTransactionAttempt(false, 1, 0);

            const stats = metrics.getTransactionStats();
            expect(stats.transactionsAttempted).toBe(1);
            expect(stats.transactionsSuccessful).toBe(0);
            expect(stats.transactionsFailed).toBe(1);
        });

        it('should calculate average retry count', () => {
            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(true, 3, 0);

            const stats = metrics.getTransactionStats();
            expect(stats.averageRetryCount).toBeGreaterThan(1);
            expect(stats.averageRetryCount).toBeLessThan(3);
        });
    });

    describe('conflict metrics', () => {
        it('should record conflicts', () => {
            metrics.recordConflict(1);

            const stats = metrics.getConflictStats();
            expect(stats.totalConflicts).toBe(1);
            expect(stats.lastConflictTime).toBeDefined();
        });

        it('should count recent conflicts within 5 minutes', () => {
            metrics.recordConflict(1);

            const stats = metrics.getConflictStats();
            expect(stats.recentConflicts).toBe(1);
        });

        it('should not count conflicts older than 5 minutes', () => {
            // First record a recent conflict
            metrics.recordConflict(1);

            // Then mock Date.now to return a time 6 minutes later
            const oldTime = Date.now() + 6 * 60 * 1000;
            const spy = jest.spyOn(Date, 'now').mockReturnValue(oldTime);

            metrics.recordConflict(1);

            const stats = metrics.getConflictStats();
            // Should only have 1 recent conflict (the first one)
            expect(stats.recentConflicts).toBe(1);

            spy.mockRestore();
        });
    });

    describe('cache stats', () => {
        it('should return cache stats when connected', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(true);
            mockClient.dbSize.mockResolvedValue(100);
            mockClient.info.mockImplementation((section: string) => {
                if (section === 'memory') return 'used_memory:1024000';
                if (section === 'server') return 'uptime_in_seconds:3600';
                return '';
            });

            const stats = await metrics.getCacheStats();

            expect(stats.connected).toBe(true);
            expect(stats.dbSize).toBe(100);
            expect(stats.memoryUsage).toBe(1024000);
            expect(stats.uptime).toBe(3600);
            expect(stats.error).toBeUndefined();
        });

        it('should handle case when memory info is invalid', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(true);
            mockClient.dbSize.mockResolvedValue(100);
            mockClient.info.mockImplementation((section: string) => {
                if (section === 'memory') return 'invalid_memory_info';
                if (section === 'server') return 'uptime_in_seconds:3600';
                return '';
            });

            const stats = await metrics.getCacheStats();

            expect(stats.connected).toBe(true);
            expect(stats.dbSize).toBe(100);
            expect(stats.memoryUsage).toBeUndefined();
            expect(stats.uptime).toBe(3600);
            expect(stats.error).toBeUndefined();
        });

        it('should handle case when uptime info is invalid', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(true);
            mockClient.dbSize.mockResolvedValue(100);
            mockClient.info.mockImplementation((section: string) => {
                if (section === 'memory') return 'used_memory:1024000';
                if (section === 'server') return 'invalid_uptime_info';
                return '';
            });

            const stats = await metrics.getCacheStats();

            expect(stats.connected).toBe(true);
            expect(stats.dbSize).toBe(100);
            expect(stats.memoryUsage).toBe(1024000);
            expect(stats.uptime).toBeUndefined();
            expect(stats.error).toBeUndefined();
        });

        it('should return error when not connected', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(false);

            const stats = await metrics.getCacheStats();

            expect(stats.connected).toBe(false);
            expect(stats.error).toBeDefined();
        });

        it('should handle errors when getting cache stats', async () => {
            const testError = new Error('Connection error');
            mockConnectionManager.isHealthy.mockRejectedValue(testError);

            const stats = await metrics.getCacheStats();

            expect(stats.connected).toBe(false);
            expect(stats.error).toBe(testError.message);
        });
    });

    describe('health report', () => {
        it('should generate comprehensive health report', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(true);
            mockClient.dbSize.mockResolvedValue(100);
            mockClient.info.mockImplementation((section: string) => {
                if (section === 'memory') return 'used_memory:1024000';
                if (section === 'server') return 'uptime_in_seconds:3600';
                return '';
            });

            const report = await metrics.getHealthReport();

            expect(report.timestamp).toBeDefined();
            expect(report.connection).toEqual({ connected: true, ready: true });
            expect(report.cache.connected).toBe(true);
            expect(report.overallHealth).toBeGreaterThanOrEqual(0);
            expect(report.overallHealth).toBeLessThanOrEqual(100);
        });

        it('should calculate overall health score correctly', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(true);
            mockClient.dbSize.mockResolvedValue(100);
            mockClient.info.mockImplementation((section: string) => {
                if (section === 'memory') return 'used_memory:1024000';
                if (section === 'server') return 'uptime_in_seconds:3600';
                return '';
            });

            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(false, 1, 0);

            const report = await metrics.getHealthReport();

            expect(report.overallHealth).toBeGreaterThan(0);
            expect(report.overallHealth).toBeLessThan(100);
        });
    });

    describe('health calculation', () => {
        it('should return 100% health for perfect conditions', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(true);
            mockClient.dbSize.mockResolvedValue(100);
            mockClient.info.mockImplementation((section: string) => {
                if (section === 'memory') return 'used_memory:1024000';
                if (section === 'server') return 'uptime_in_seconds:3600';
                return '';
            });

            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(true, 1, 0);

            const report = await metrics.getHealthReport();

            expect(report.overallHealth).toBeGreaterThan(90);
        });

        it('should return low health score for poor conditions', async () => {
            mockConnectionManager.isHealthy.mockResolvedValue(false);
            mockConnectionManager.getHealth.mockReturnValue({
                connected: false,
                ready: false,
            });

            const report = await metrics.getHealthReport();

            expect(report.overallHealth).toBeLessThan(50);
        });
    });

    describe('reset functionality', () => {
        it('should reset all metrics to initial state', () => {
            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordConflict(1);

            metrics.reset();

            const transactionStats = metrics.getTransactionStats();
            const conflictStats = metrics.getConflictStats();

            expect(transactionStats.transactionsAttempted).toBe(0);
            expect(transactionStats.transactionsSuccessful).toBe(0);
            expect(transactionStats.transactionsFailed).toBe(0);
            expect(transactionStats.averageRetryCount).toBe(0);
            expect(transactionStats.lastTransactionTime).toBeUndefined();

            expect(conflictStats.totalConflicts).toBe(0);
            expect(conflictStats.recentConflicts).toBe(0);
            expect(conflictStats.successRate).toBe(1);
            expect(conflictStats.averageDelay).toBe(0);
            expect(conflictStats.lastConflictTime).toBe(0);
        });
    });

    describe('success rate calculation', () => {
        it('should calculate success rate correctly for all successful transactions', () => {
            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(true, 1, 0);

            const stats = metrics.getConflictStats();
            expect(stats.successRate).toBe(1);
        });

        it('should calculate success rate correctly for mixed transactions', () => {
            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(true, 1, 0);
            metrics.recordTransactionAttempt(false, 1, 0);

            const stats = metrics.getConflictStats();
            expect(stats.successRate).toBeCloseTo(2 / 3);
        });

        it('should calculate success rate correctly for all failed transactions', () => {
            metrics.recordTransactionAttempt(false, 1, 0);
            metrics.recordTransactionAttempt(false, 1, 0);

            const stats = metrics.getConflictStats();
            expect(stats.successRate).toBe(0);
        });
    });
});