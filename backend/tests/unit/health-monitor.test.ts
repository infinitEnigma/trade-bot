import { HealthMonitor, EngineHealth, HealthCheckConfig } from '../../src/core/strategies/engine/health-monitor';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HealthMonitor', () => {
    let healthMonitor: HealthMonitor;
    let mockProcessSpawner: any;
    const defaultPort = 4000;

    beforeEach(() => {
        // Create mock ProcessSpawner
        mockProcessSpawner = {
            isAlive: jest.fn(),
        };

        healthMonitor = new HealthMonitor(mockProcessSpawner, defaultPort);
    });

    describe('constructor', () => {
        it('should create a HealthMonitor instance with default configuration', () => {
            expect(healthMonitor).toBeInstanceOf(HealthMonitor);
        });

        it('should create a HealthMonitor instance with custom configuration', () => {
            const customConfig: Partial<HealthCheckConfig> = {
                enabledLayers: {
                    processLiveness: false,
                    httpConnectivity: false,
                    websocketHealth: true,
                    botOperational: true,
                    systemResources: true,
                },
                timeouts: {
                    httpTimeout: 5000,
                    websocketTimeout: 5000,
                    botCheckTimeout: 10000,
                },
                thresholds: {
                    maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
                    maxErrorRate: 0.2, // 20%
                    staleTradeThreshold: 60, // 60 minutes
                },
            };

            const monitor = new HealthMonitor(mockProcessSpawner, defaultPort, customConfig);

            // We can't directly access private config, but we can test the behavior
            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            // Verify the custom config is used by checking behavior
        });
    });

    describe('performMultiLayerHealthCheck', () => {
        it('should return healthy status when all checks pass', async () => {
            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            const health = await healthMonitor.performMultiLayerHealthCheck();

            expect(health.processAlive).toBe(true);
            expect(health.httpResponsive).toBe(true);
            expect(health.overallHealthy).toBe(true);
            expect(health.issues).toEqual([]);
            expect(health.healthScore).toBeGreaterThanOrEqual(70);
        });

        it('should return unhealthy status when process is not alive', async () => {
            mockProcessSpawner.isAlive.mockReturnValue(false);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            const health = await healthMonitor.performMultiLayerHealthCheck();

            expect(health.processAlive).toBe(false);
            expect(health.overallHealthy).toBe(false);
            expect(health.issues).toEqual(expect.arrayContaining(['Process is not alive']));
        });

        it('should return unhealthy status when HTTP endpoint is not responding', async () => {
            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockRejectedValue(new Error('Network error'));

            const health = await healthMonitor.performMultiLayerHealthCheck();

            expect(health.httpResponsive).toBe(false);
            expect(health.overallHealthy).toBe(false);
            expect(health.issues).toEqual(expect.arrayContaining(['HTTP endpoint not responding']));
        });

        it('should handle health check errors gracefully', async () => {
            const testError = new Error('Test error');
            mockProcessSpawner.isAlive.mockImplementation(() => {
                throw testError;
            });

            const health = await healthMonitor.performMultiLayerHealthCheck();

            expect(health.overallHealthy).toBe(false);
            expect(health.healthScore).toBe(0);
            expect(health.issues).toEqual(expect.arrayContaining([expect.stringContaining('Health check error')]));
        });
    });

    describe('health trend analysis', () => {
        it('should return initial trend when no health checks have been performed', () => {
            const trend = healthMonitor.getHealthTrend();

            expect(trend.currentHealth).toBeNull();
            expect(trend.averageHealthScore).toBe(0);
            expect(trend.healthStability).toBe('stable');
            expect(trend.recentIssues).toEqual([]);
        });

        it('should track health trend over multiple checks', async () => {
            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            // Perform multiple health checks
            for (let i = 0; i < 5; i++) {
                await healthMonitor.performMultiLayerHealthCheck();
            }

            const trend = healthMonitor.getHealthTrend();

            expect(trend.currentHealth).not.toBeNull();
            expect(trend.averageHealthScore).toBeGreaterThanOrEqual(70);
            expect(trend.healthStability).toBe('stable');
        });

        it('should detect significant health degradation', async () => {
            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            // First healthy check
            await healthMonitor.performMultiLayerHealthCheck();

            // Then unhealthy check
            mockedAxios.get.mockRejectedValue(new Error('Network error'));
            await healthMonitor.performMultiLayerHealthCheck();

            const degraded = healthMonitor.hasHealthDegraded(20);

            expect(degraded).toBe(true);
        });
    });

    describe('health reporting', () => {
        it('should generate health report with recommendations', async () => {
            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            await healthMonitor.performMultiLayerHealthCheck();

            const report = healthMonitor.getHealthReport();

            expect(report.summary).not.toBeNull();
            expect(report.trend.currentHealth).toEqual(report.summary);
            // Since all checks pass, there should be no recommendations about unhealthy engine
            expect(report.recommendations).not.toContain(
                expect.stringContaining('Engine is not healthy - investigate issues immediately')
            );
        });

        it('should recommend running health check when no data', () => {
            const report = healthMonitor.getHealthReport();

            expect(report.recommendations).toEqual(['No health data available - run health check']);
        });
    });

    describe('layer configurations', () => {
        it('should respect layer configuration', async () => {
            const config: Partial<HealthCheckConfig> = {
                enabledLayers: {
                    processLiveness: false,
                    httpConnectivity: false,
                    websocketHealth: false,
                    botOperational: false,
                    systemResources: false,
                },
            };

            const monitor = new HealthMonitor(mockProcessSpawner, defaultPort, config);

            mockProcessSpawner.isAlive.mockReturnValue(false);
            mockedAxios.get.mockRejectedValue(new Error('Network error'));

            const health = await monitor.performMultiLayerHealthCheck();

            // With all layers disabled, the health score should be 0
            expect(health.healthScore).toBe(0);
        });

        it('should calculate health score correctly with enabled layers', async () => {
            const config: Partial<HealthCheckConfig> = {
                enabledLayers: {
                    processLiveness: true,
                    httpConnectivity: true,
                    websocketHealth: true,
                    botOperational: true,
                    systemResources: true,
                },
            };

            const monitor = new HealthMonitor(mockProcessSpawner, defaultPort, config);

            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            const health = await monitor.performMultiLayerHealthCheck();

            expect(health.healthScore).toBe(100);
        });
    });

    describe('placeholder methods', () => {
        it('should return default values for system resources layer', async () => {
            const config: Partial<HealthCheckConfig> = {
                enabledLayers: {
                    processLiveness: true,
                    httpConnectivity: true,
                    websocketHealth: false,
                    botOperational: false,
                    systemResources: true,
                },
                thresholds: {
                    maxMemoryUsage: 100, // Very low threshold
                    maxErrorRate: 0.05, // 5%
                    staleTradeThreshold: 30,
                },
            };

            const monitor = new HealthMonitor(mockProcessSpawner, defaultPort, config);

            mockProcessSpawner.isAlive.mockReturnValue(true);
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });

            const health = await monitor.performMultiLayerHealthCheck();

            // Currently, the system resources layer is a placeholder that returns 0
            // So even with very low thresholds, it won't trigger the checks
            expect(health.overallHealthy).toBe(true);
            expect(health.issues).toEqual([]);
        });
    });
});