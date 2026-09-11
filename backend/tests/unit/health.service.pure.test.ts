/** @format */

import { HealthService, createHealthService, HealthServiceDependencies } from '../../src/core/system/health.service.pure';

describe('HealthService', () => {
    // Create mock dependencies for the HealthService
    const createMockDependencies = (): HealthServiceDependencies => {
        return {
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                child: jest.fn(),
            },
            cacheService: {
                get: jest.fn(),
                setex: jest.fn(),
                delete: jest.fn(),
                set: jest.fn(),
                exists: jest.fn(),
                mget: jest.fn(),
                mset: jest.fn(),
                atomicConditionalUpdate: jest.fn(),
            },
        };
    };

    describe('Constructor', () => {
        it('should create an instance of HealthService', () => {
            const deps = createMockDependencies();
            const healthService = new HealthService(deps);
            expect(healthService).toBeInstanceOf(HealthService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const healthService = createHealthService(deps);
            expect(healthService).toBeInstanceOf(HealthService);
        });
    });

    describe('getSystemHealth', () => {
        it('should return healthy status when all services are healthy', async () => {
            const deps = createMockDependencies();
            const healthService = new HealthService(deps);
            (deps.cacheService.get as jest.Mock).mockResolvedValue({ success: true });

            const result = await healthService.getSystemHealth();

            expect(result.status).toBe('healthy');
            expect(result.timestamp).toBeInstanceOf(Date);
            expect(result.checks.api.status).toBe('healthy');
            expect(result.checks.database.status).toBe('healthy');
            expect(result.checks.redis.status).toBe('healthy');
            expect(result.checks.tradingEngine.status).toBe('healthy');
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should return unhealthy status when Redis is down', async () => {
            const deps = createMockDependencies();
            const healthService = new HealthService(deps);
            (deps.cacheService.get as jest.Mock).mockRejectedValue(new Error('Redis connection failed'));

            const result = await healthService.getSystemHealth();

            expect(result.status).toBe('unhealthy');
            expect(result.checks.redis.status).toBe('unhealthy');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('getSystemInfo', () => {
        it('should retrieve system information', async () => {
            const deps = createMockDependencies();
            const healthService = new HealthService(deps);

            const result = await healthService.getSystemInfo();

            expect(result.version).toBeDefined();
            expect(result.nodeVersion).toBeDefined();
            expect(result.platform).toBeDefined();
            expect(result.architecture).toBeDefined();
            expect(result.uptime).toBeDefined();
            expect(result.memoryUsage).toBeDefined();
            expect(result.environment).toBeDefined();
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle errors when retrieving system info', async () => {
            const deps = createMockDependencies();
            const healthService = new HealthService(deps);
            const testError = new Error('Failed to get system info');
            (deps.logger.debug as jest.Mock).mockImplementation(() => { throw testError; });

            await expect(healthService.getSystemInfo()).rejects.toThrow('Failed to get system information');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('getPerformanceMetrics', () => {
        it('should retrieve performance metrics', async () => {
            const deps = createMockDependencies();
            const healthService = new HealthService(deps);

            const result = await healthService.getPerformanceMetrics();

            expect(result.cpu).toBeDefined();
            expect(typeof result.cpu).toBe('number');
            expect(result.cpu).toBeGreaterThanOrEqual(0);
            expect(result.cpu).toBeLessThanOrEqual(100);

            expect(result.memory).toBeDefined();
            expect(typeof result.memory).toBe('object');

            expect(result.eventLoop).toBeDefined();
            expect(typeof result.eventLoop).toBe('number');
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle errors when retrieving performance metrics', async () => {
            const deps = createMockDependencies();
            const healthService = new HealthService(deps);
            const testError = new Error('Performance metrics unavailable');
            (deps.logger.debug as jest.Mock).mockImplementation(() => { throw testError; });

            await expect(healthService.getPerformanceMetrics()).rejects.toThrow('Failed to get performance metrics');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });
});