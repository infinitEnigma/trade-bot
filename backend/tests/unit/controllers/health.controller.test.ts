/** @format */

import request from 'supertest';
import { Express } from 'express';

// Mock dependencies before importing any other modules
jest.mock('../../../src/core/service-provider', () => ({
    getHealthService: jest.fn(),
}));

jest.mock('../../../src/database/pool', () => ({
    getPool: jest.fn(),
    getPoolMetrics: jest.fn(),
}));

jest.mock('../../../src/infrastructure/cache/redis.service', () => ({
    redisService: {
        getClient: jest.fn(),
    },
}));

jest.mock('../../../src/infrastructure/security/key-management.service', () => ({
    keyManagementService: {
        getKeyStatus: jest.fn(),
        validateEncryption: jest.fn(),
    },
}));

jest.mock('../../../src/core/service-selector', () => ({
    getServiceStatus: jest.fn(),
}));

jest.mock('../../../src/core/logging', () => ({
    httpLogger: {
        http: jest.fn(),
    },
    logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    },
}));

// Get mock services
const mockGetHealthService = require('../../../src/core/service-provider').getHealthService;
const mockGetPool = require('../../../src/database/pool').getPool;
const mockGetPoolMetrics = require('../../../src/database/pool').getPoolMetrics;
const mockRedisService = require('../../../src/infrastructure/cache/redis.service').redisService;
const mockKeyManagementService = require('../../../src/infrastructure/security/key-management.service').keyManagementService;
const mockGetServiceStatus = require('../../../src/core/service-selector').getServiceStatus;

// Create a test app
function createTestApp(): Express {
    const express = require('express');
    const app = express();

    // Add necessary middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Import and register routes
    const { healthRoutes } = require('../../../src/interfaces/http/system/health');
    app.use('/', healthRoutes);

    return app;
}

describe('Health Controller', () => {
    let app: Express;

    beforeAll(() => {
        // Set necessary environment variables
        process.env.npm_package_version = '1.0.0';
        process.env.NODE_ENV = 'test';
        process.env.DB_NAME = 'test-db';
        process.env.DB_HOST = 'localhost';
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create fresh app instance
        app = createTestApp();
    });

    describe('GET /health', () => {
        it('should return basic health check response', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.timestamp).toBeDefined();
            expect(response.body.uptime).toBeGreaterThanOrEqual(0);
            expect(response.body.version).toBe('1.0.0');
            expect(response.body.environment).toBe('test');
        });
    });

    describe('GET /health/detailed', () => {
        it('should return detailed health check when all services are healthy', async () => {
            const mockHealth = {
                status: 'healthy',
                timestamp: new Date(),
                checks: {
                    api: { status: 'healthy' },
                    database: { status: 'healthy' },
                    redis: { status: 'healthy' },
                    tradingEngine: { status: 'healthy' },
                },
            };

            const mockHealthService = {
                getSystemHealth: jest.fn().mockResolvedValue(mockHealth),
                getPerformanceMetrics: jest.fn(),
                getSystemInfo: jest.fn(),
            };

            mockGetHealthService.mockReturnValue(mockHealthService);

            const response = await request(app)
                .get('/health/detailed')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.timestamp).toBeDefined();
            expect(response.body.checks).toEqual(mockHealth.checks);
        });

        it('should return 503 status when health check fails', async () => {
            const mockHealth = {
                status: 'unhealthy',
                timestamp: new Date(),
                checks: {
                    api: { status: 'healthy' },
                    database: { status: 'unhealthy' },
                    redis: { status: 'healthy' },
                    tradingEngine: { status: 'healthy' },
                },
            };

            const mockHealthService = {
                getSystemHealth: jest.fn().mockResolvedValue(mockHealth),
                getPerformanceMetrics: jest.fn(),
                getSystemInfo: jest.fn(),
            };

            mockGetHealthService.mockReturnValue(mockHealthService);

            const response = await request(app)
                .get('/health/detailed')
                .expect(503);

            expect(response.body.status).toBe('unhealthy');
        });

        it('should handle errors in detailed health check', async () => {
            const errorMessage = 'Health check failed';
            const mockHealthService = {
                getSystemHealth: jest.fn().mockRejectedValue(new Error(errorMessage)),
                getPerformanceMetrics: jest.fn(),
                getSystemInfo: jest.fn(),
            };

            mockGetHealthService.mockReturnValue(mockHealthService);

            const response = await request(app)
                .get('/health/detailed')
                .expect(503);

            expect(response.body.status).toBe('error');
            expect(response.body.error).toBe('Health check failed');
            expect(response.body.message).toBe(errorMessage);
        });
    });

    describe('GET /health/database', () => {
        it('should return database health check', async () => {
            const mockPool = {
                query: jest.fn().mockResolvedValue({
                    rows: [{ total_connections: '5', active_connections: '1', idle_connections: '4' }],
                }),
            };

            mockGetPool.mockReturnValue(mockPool);

            const response = await request(app)
                .get('/health/database')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.database.name).toBe('test-db');
            expect(response.body.database.host).toBe('localhost');
            expect(response.body.database.connections.total).toBe(5);
            expect(response.body.database.connections.active).toBe(1);
            expect(response.body.database.connections.idle).toBe(4);
        });

        it('should return 503 when database health check fails', async () => {
            const errorMessage = 'Connection failed';
            const mockPool = {
                query: jest.fn().mockRejectedValue(new Error(errorMessage)),
            };

            mockGetPool.mockReturnValue(mockPool);

            const response = await request(app)
                .get('/health/database')
                .expect(503);

            expect(response.body.status).toBe('unhealthy');
            expect(response.body.error).toBe('Database health check failed');
            expect(response.body.message).toBe(errorMessage);
        });
    });

    describe('GET /metrics/database', () => {
        it('should return database metrics', async () => {
            const mockMetrics = {
                pool: { size: 10, used: 2, idle: 8 },
                performance: { queryCount: 100, avgResponseTime: 50 },
                config: { max: 20, min: 5 },
                health: { status: 'healthy' },
            };

            mockGetPoolMetrics.mockReturnValue(mockMetrics);

            const response = await request(app)
                .get('/metrics/database')
                .expect(200);

            expect(response.body.pool).toEqual(mockMetrics.pool);
            expect(response.body.performance).toEqual(mockMetrics.performance);
            expect(response.body.config).toEqual(mockMetrics.config);
            expect(response.body.health).toEqual(mockMetrics.health);
        });

        it('should handle metrics retrieval failure', async () => {
            const errorMessage = 'Metrics unavailable';
            mockGetPoolMetrics.mockImplementation(() => {
                throw new Error(errorMessage);
            });

            const response = await request(app)
                .get('/metrics/database')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to fetch database metrics');
            expect(response.body.message).toBe(errorMessage);
        });
    });

    describe('GET /health/encryption', () => {
        it('should return encryption health check', async () => {
            mockKeyManagementService.getKeyStatus.mockReturnValue('active');
            mockKeyManagementService.validateEncryption.mockResolvedValue(true);

            const response = await request(app)
                .get('/health/encryption')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.encryption.keyStatus).toBe('active');
            expect(response.body.encryption.validation.roundtripTest).toBe(true);
        });

        it('should return unhealthy status when encryption validation fails', async () => {
            mockKeyManagementService.getKeyStatus.mockReturnValue('active');
            mockKeyManagementService.validateEncryption.mockResolvedValue(false);

            const response = await request(app)
                .get('/health/encryption')
                .expect(200);

            expect(response.body.status).toBe('unhealthy');
            expect(response.body.encryption.validation.roundtripTest).toBe(false);
        });

        it('should handle encryption check failure', async () => {
            const errorMessage = 'Encryption service unavailable';
            mockKeyManagementService.getKeyStatus.mockImplementation(() => {
                throw new Error(errorMessage);
            });

            const response = await request(app)
                .get('/health/encryption')
                .expect(503);

            expect(response.body.status).toBe('unhealthy');
            expect(response.body.error).toBe('Encryption health check failed');
            expect(response.body.message).toBe(errorMessage);
        });
    });

    describe('GET /health/redis', () => {
        it('should return Redis health check', async () => {
            const mockClient = {
                ping: jest.fn().mockResolvedValue('PONG'),
                info: jest.fn().mockResolvedValue('redis_version:6.0.0'),
                isOpen: true,
            };

            mockRedisService.getClient.mockReturnValue(mockClient);

            const response = await request(app)
                .get('/health/redis')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.redis.ping).toBe('PONG');
            expect(response.body.redis.connected_clients).toBe('connected');
        });

        it('should return 503 when Redis is disconnected', async () => {
            const errorMessage = 'Redis connection error';
            const mockClient = {
                ping: jest.fn().mockRejectedValue(new Error(errorMessage)),
                info: jest.fn(),
                isOpen: false,
            };

            mockRedisService.getClient.mockReturnValue(mockClient);

            const response = await request(app)
                .get('/health/redis')
                .expect(503);

            expect(response.body.status).toBe('unhealthy');
            expect(response.body.error).toBe('Redis health check failed');
            expect(response.body.message).toBe(errorMessage);
        });
    });

    describe('GET /health/external', () => {
        it('should return external API health check when Kodiak API is available', async () => {
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValue({ data: { symbol: 'PERP_BTC_USDC' } }),
            };

            global.fetch = jest.fn().mockResolvedValue(mockResponse);

            const response = await request(app)
                .get('/health/external')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.external.kodiak.status).toBe('healthy');
            expect(response.body.external.kodiak.symbol).toBe('PERP_BTC_USDC');
        });

        it('should return degraded status when Kodiak API fails', async () => {
            const mockResponse = {
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({ error: 'Server error' }),
            };

            global.fetch = jest.fn().mockResolvedValue(mockResponse);

            const response = await request(app)
                .get('/health/external')
                .expect(503);

            expect(response.body.status).toBe('degraded');
            expect(response.body.external.kodiak.status).toBe('unhealthy');
        });

        it('should handle fetch errors', async () => {
            const errorMessage = 'Network error';
            global.fetch = jest.fn().mockRejectedValue(new Error(errorMessage));

            const response = await request(app)
                .get('/health/external')
                .expect(503);

            expect(response.body.status).toBe('degraded');
            expect(response.body.external.kodiak.status).toBe('unhealthy');
        });
    });

    describe('GET /metrics', () => {
        it('should return application metrics', async () => {
            const mockMetrics = {
                cpu: 10,
                memory: { used: 1024, total: 4096 },
                eventLoop: 50,
            };

            const mockInfo = {
                version: '1.0.0',
                nodeVersion: '18.0.0',
                platform: 'linux',
                architecture: 'x64',
                uptime: 3600,
                memoryUsage: { rss: 1024 },
                environment: 'test',
            };

            const mockHealthService = {
                getSystemHealth: jest.fn(),
                getPerformanceMetrics: jest.fn().mockResolvedValue(mockMetrics),
                getSystemInfo: jest.fn().mockResolvedValue(mockInfo),
            };

            mockGetHealthService.mockReturnValue(mockHealthService);

            const response = await request(app)
                .get('/metrics')
                .expect(200);

            expect(response.body.cpu).toEqual(mockMetrics.cpu);
            expect(response.body.memory).toEqual(mockMetrics.memory);
            expect(response.body.eventLoop).toEqual(mockMetrics.eventLoop);
            expect(response.body.process.pid).toBeDefined();
            expect(response.body.environment.node_env).toBe('test');
        });

        it('should handle metrics retrieval failure', async () => {
            const errorMessage = 'Metrics collection failed';
            const mockHealthService = {
                getSystemHealth: jest.fn(),
                getPerformanceMetrics: jest.fn().mockRejectedValue(new Error(errorMessage)),
                getSystemInfo: jest.fn(),
            };

            mockGetHealthService.mockReturnValue(mockHealthService);

            const response = await request(app)
                .get('/metrics')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to fetch metrics');
            expect(response.body.message).toBe(errorMessage);
        });
    });

    describe('GET /ready', () => {
        it('should return ready status when all critical dependencies are available', async () => {
            const mockPool = {
                query: jest.fn().mockResolvedValue({ rows: [{ test: 1 }] }),
            };

            const mockRedisClient = {
                ping: jest.fn().mockResolvedValue('PONG'),
            };

            mockGetPool.mockReturnValue(mockPool);
            mockRedisService.getClient.mockReturnValue(mockRedisClient);

            const response = await request(app)
                .get('/ready')
                .expect(200);

            expect(response.body.status).toBe('ready');
        });

        it('should return 503 when database is unavailable', async () => {
            const errorMessage = 'Database connection failed';
            const mockPool = {
                query: jest.fn().mockRejectedValue(new Error(errorMessage)),
            };

            const mockRedisClient = {
                ping: jest.fn().mockResolvedValue('PONG'),
            };

            mockGetPool.mockReturnValue(mockPool);
            mockRedisService.getClient.mockReturnValue(mockRedisClient);

            const response = await request(app)
                .get('/ready')
                .expect(503);

            expect(response.body.status).toBe('not ready');
            expect(response.body.error).toBe(errorMessage);
        });

        it('should return 503 when Redis is unavailable', async () => {
            const errorMessage = 'Redis connection failed';
            const mockPool = {
                query: jest.fn().mockResolvedValue({ rows: [{ test: 1 }] }),
            };

            const mockRedisClient = {
                ping: jest.fn().mockRejectedValue(new Error(errorMessage)),
            };

            mockGetPool.mockReturnValue(mockPool);
            mockRedisService.getClient.mockReturnValue(mockRedisClient);

            const response = await request(app)
                .get('/ready')
                .expect(503);

            expect(response.body.status).toBe('not ready');
            expect(response.body.error).toBe(errorMessage);
        });
    });

    describe('GET /live', () => {
        it('should return liveness check response', async () => {
            const response = await request(app)
                .get('/live')
                .expect(200);

            expect(response.body.status).toBe('alive');
            expect(response.body.timestamp).toBeDefined();
            expect(response.body.uptime).toBeGreaterThanOrEqual(0);
        });
    });

    describe('GET /health/services', () => {
        it('should return service status information', async () => {
            const mockServiceStatus = {
                service1: { implementation: 'pure', enabled: true },
                service2: { implementation: 'pure', enabled: true },
                service3: { implementation: 'legacy', enabled: false },
            };

            mockGetServiceStatus.mockReturnValue(mockServiceStatus);

            const response = await request(app)
                .get('/health/services')
                .expect(200);

            expect(response.body.status).toBe('transitioning');
            expect(response.body.services).toEqual(mockServiceStatus);
            expect(response.body.summary.pureServicesEnabled).toBe(2);
            expect(response.body.summary.totalServices).toBe(3);
        });

        it('should return healthy status when all services are migrated', async () => {
            const mockServiceStatus = {
                service1: { implementation: 'pure', enabled: true },
                service2: { implementation: 'pure', enabled: true },
                service3: { implementation: 'pure', enabled: true },
            };

            mockGetServiceStatus.mockReturnValue(mockServiceStatus);

            const response = await request(app)
                .get('/health/services')
                .expect(200);

            expect(response.body.status).toBe('healthy');
            expect(response.body.summary.pureServicesEnabled).toBe(3);
        });

        it('should handle service status retrieval failure', async () => {
            const errorMessage = 'Service status unavailable';
            mockGetServiceStatus.mockImplementation(() => {
                throw new Error(errorMessage);
            });

            const response = await request(app)
                .get('/health/services')
                .expect(500);

            expect(response.body.status).toBe('error');
            expect(response.body.error).toBe('Failed to get service status');
            expect(response.body.message).toBe(errorMessage);
        });
    });

    describe('GET /ratelimit', () => {
        it('should return rate limit statistics', async () => {
            const mockKeys = ['ratelimit:192.168.1.1', 'ratelimit:10.0.0.5'];
            const mockClient = {
                keys: jest.fn().mockResolvedValue(mockKeys),
            };

            mockRedisService.getClient.mockReturnValue(mockClient);

            const response = await request(app)
                .get('/ratelimit')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.activeIps).toBe(2);
            expect(response.body.data.ratelimitConfigs).toBeDefined();
        });

        it('should handle rate limit stats retrieval failure', async () => {
            const errorMessage = 'Redis connection error';
            const mockClient = {
                keys: jest.fn().mockRejectedValue(new Error(errorMessage)),
            };

            mockRedisService.getClient.mockReturnValue(mockClient);

            const response = await request(app)
                .get('/ratelimit')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to fetch rate limit stats');
        });
    });
});