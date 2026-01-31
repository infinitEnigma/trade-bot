/**
 * ===========================================
 * 🧪 REDIS HEALTH MONITOR - Unit Tests
 * ===========================================
 *
 * Tests for Redis health monitoring and availability tracking
 *
 * @format
 */

import { RedisHealthMonitor, redisHealthMonitor } from '../../src/infrastructure/security/rate-limiter/redis-health-monitor';
import { redisService } from '../../src/infrastructure';

// Mock Redis service
jest.mock('../../src/infrastructure', () => ({
    ...jest.requireActual('../../src/infrastructure'),
    redisService: {
        isHealthy: jest.fn(),
    },
}));

describe('RedisHealthMonitor', () => {
    describe('Single instance behavior', () => {
        it('should export a singleton instance', () => {
            // Assert
            expect(redisHealthMonitor).toBeDefined();
            expect(redisHealthMonitor).toBeInstanceOf(RedisHealthMonitor);
        });
    });

    describe('Health check functionality', () => {
        let monitor: RedisHealthMonitor;

        beforeEach(() => {
            jest.clearAllMocks();
            monitor = new RedisHealthMonitor();
        });

        it('should return current health status without checking', () => {
            // Act
            const initialHealth = monitor.getCurrentHealth();

            // Assert
            expect(typeof initialHealth).toBe('boolean');
            expect(redisService.isHealthy).not.toHaveBeenCalled();
        });

        it('should check Redis health when checkHealth is called', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);

            // Act
            const health = await monitor.checkHealth();

            // Assert
            expect(redisService.isHealthy).toHaveBeenCalledTimes(1);
            expect(health).toBe(true);
        });

        it('should cache health check results', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);
            // Create a new monitor instance with a very small interval for testing caching behavior
            const fastMonitor = Object.create(RedisHealthMonitor.prototype);
            Object.assign(fastMonitor, new RedisHealthMonitor());
            fastMonitor['CHECK_INTERVAL_MS'] = 100; // @ts-ignore - testing purposes

            // Act
            await fastMonitor.checkHealth();
            const secondHealth = await fastMonitor.checkHealth();

            // Assert - Should only call once due to caching
            expect(redisService.isHealthy).toHaveBeenCalledTimes(1);
            expect(secondHealth).toBe(true);
        });

        it('should handle Redis health check failures', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockRejectedValue(new Error('Connection failed'));

            // Act
            const health = await monitor.checkHealth();

            // Assert
            expect(health).toBe(false);
        });
    });

    describe('Health status management', () => {
        let monitor: RedisHealthMonitor;

        beforeEach(() => {
            jest.clearAllMocks();
            monitor = new RedisHealthMonitor();
        });

        it('should track last check time', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);

            // Act
            const beforeCheck = Date.now();
            await monitor.checkHealth();
            const afterCheck = Date.now();

            // Assert
            const lastCheck = monitor.getLastCheckTime();
            expect(lastCheck).toBeGreaterThanOrEqual(beforeCheck);
            expect(lastCheck).toBeLessThanOrEqual(afterCheck);
        });

        it('should force health check', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);

            // Act
            await monitor.checkHealth();
            await monitor.forceHealthCheck();

            // Assert - Should call twice
            expect(redisService.isHealthy).toHaveBeenCalledTimes(2);
        });

        it('should manually set health status', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);

            // Act
            monitor.setHealthStatus(false);
            const status = monitor.getCurrentHealth();

            // Assert
            expect(status).toBe(false);
        });
    });

    describe('Health statistics', () => {
        let monitor: RedisHealthMonitor;

        beforeEach(() => {
            jest.clearAllMocks();
            monitor = new RedisHealthMonitor();
        });

        it('should return health statistics', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);
            await monitor.checkHealth();

            // Act
            const stats = monitor.getHealthStats();

            // Assert
            expect(stats.healthy).toBe(true);
            expect(stats.lastCheck).toBeGreaterThan(0);
            expect(stats.secondsSinceLastCheck).toBeGreaterThanOrEqual(0);
            expect(stats.checkIntervalSeconds).toBe(30); // 30 second interval
        });

        it('should calculate time since last check', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);

            // Act
            await monitor.checkHealth();
            const stats1 = monitor.getHealthStats();

            await new Promise(resolve => setTimeout(resolve, 1100)); // Wait at least 1.1 seconds

            const stats2 = monitor.getHealthStats();

            // Assert
            expect(stats2.secondsSinceLastCheck).toBeGreaterThan(stats1.secondsSinceLastCheck);
        });
    });

    describe('Health status transitions', () => {
        let monitor: RedisHealthMonitor;

        beforeEach(() => {
            jest.clearAllMocks();
            monitor = new RedisHealthMonitor();
        });

        it('should transition from healthy to unhealthy', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(false);

            // Act
            const health = await monitor.checkHealth();

            // Assert
            expect(health).toBe(false);
            expect(monitor.getCurrentHealth()).toBe(false);
        });

        it('should transition from unhealthy to healthy', async () => {
            // Arrange
            monitor.setHealthStatus(false);
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);

            // Act
            const health = await monitor.forceHealthCheck();

            // Assert
            expect(health).toBe(true);
            expect(monitor.getCurrentHealth()).toBe(true);
        });
    });
});
