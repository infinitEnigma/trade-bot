/** @format */

// Mock logger before importing any modules that use it
jest.mock('../../../src/core/logging/logger.service', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    },
}));

import request from 'supertest';
import { Express } from 'express';

// Mock middleware to pass through and set user context
jest.mock('../../../src/interfaces/middleware/auth', () => ({
    authMiddleware: jest.fn().mockImplementation((req: any, res: any, next: any) => {
        req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
        next();
    }),
    AuthenticatedRequest: jest.fn(),
}));

jest.mock('../../../src/interfaces/middleware/validation', () => ({
    validators: {
        startBot: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
        stopBot: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
    },
}));

jest.mock('../../../src/infrastructure/security/rate-limiter.service', () => ({
    RateLimiters: {
        botInstances: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
    },
}));

// Mock all other dependencies
jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('test-bot-id'),
}));

jest.mock('../../../src/database/pool', () => ({
    query: jest.fn(),
}));

jest.mock('../../../src/core/strategies/engine-manager.service.pure', () => ({
    EngineManager: jest.fn().mockImplementation(() => ({
        ensureEngineRunning: jest.fn().mockResolvedValue(undefined),
        stopEngineIfNoActiveBots: jest.fn().mockResolvedValue(undefined),
        getEngineStatus: jest.fn().mockResolvedValue({ running: true }),
    })),
}));

jest.mock('../../../src/core/service-provider', () => ({
    serviceProvider: {
        getBotManagementService: jest.fn().mockReturnValue({
            getBotInstances: jest.fn(),
            getBotInstance: jest.fn(),
            getBotPerformance: jest.fn(),
            createAndStartBot: jest.fn(),
            stopBot: jest.fn(),
            emergencyStop: jest.fn(),
        }),
        getMarketService: jest.fn().mockReturnValue({
            hasUserKodiakCredentials: jest.fn().mockResolvedValue(true),
        }),
        getEngineManager: jest.fn().mockReturnValue({
            ensureEngineRunning: jest.fn().mockResolvedValue(undefined),
            stopEngineIfNoActiveBots: jest.fn().mockResolvedValue(undefined),
            getEngineStatus: jest.fn().mockResolvedValue({ running: true }),
        }),
    },
}));

jest.mock('../../../src/infrastructure/adapters/repositories/strategy-repository.adapter', () => ({
    strategyRepositoryAdapter: {
        getStrategy: jest.fn(),
    },
}));

jest.mock('../../../src/infrastructure/adapters/repositories/bot-instance-repository.adapter', () => ({
    botInstanceRepositoryAdapter: {
        getActiveBotInstances: jest.fn(),
        createBotInstance: jest.fn(),
    },
}));

jest.mock('../../../src/infrastructure/adapters/repositories/audit-log-repository.adapter', () => ({
    auditLogRepositoryAdapter: {
        logEvent: jest.fn(),
    },
}));

// Mock other dependencies
jest.mock('../../../src/infrastructure/security/encryption.service', () => ({
    withCredentials: jest.fn().mockImplementation((userId, callback) => {
        return callback({
            get: jest.fn().mockReturnValue('test-value'),
        });
    }),
    encryptionService: {
        encryptWithVersion: jest.fn().mockReturnValue('encrypted-session-key'),
    },
}));

jest.mock('../../../src/shared/utils/context', () => ({
    getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
    getContextForLogging: jest.fn().mockReturnValue({}),
}));

// Mock Redis service to prevent initialization issues
jest.mock('../../../src/infrastructure/cache/redis.service', () => ({
    redisService: {
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn(() => ({
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
            setNX: jest.fn().mockResolvedValue(true),
            get: jest.fn().mockResolvedValue(null),
            exists: jest.fn().mockResolvedValue(0),
            expire: jest.fn().mockResolvedValue(1),
        })),
        del: jest.fn().mockResolvedValue({ success: true }),
        atomicReadModifyWrite: jest.fn(),
        cleanupForTests: jest.fn(),
    },
}));

jest.mock('../../../src/core/notifications/error-notification.service', () => ({
    errorNotificationService: {
        notifyError: jest.fn(),
    },
    ErrorSeverity: {
        LOW: 'LOW',
        MEDIUM: 'MEDIUM',
        HIGH: 'HIGH',
        CRITICAL: 'CRITICAL',
    },
    ErrorCategory: {
        SYSTEM: 'SYSTEM',
        BUSINESS_LOGIC: 'BUSINESS_LOGIC',
    },
}));

// Create a test app
function createTestApp(): Express {
    const express = require('express');
    const app = express();

    // Add necessary middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mock WebSocket io instance with 'to' method
    app.set('io', {
        emit: jest.fn(),
        to: jest.fn().mockReturnThis(),
    });

    // Import and register routes
    const { botRoutes } = require('../../../src/interfaces/http/bots');
    app.use('/api/bot', botRoutes);

    return app;
}

describe('Bots Controller', () => {
    let app: Express;

    beforeAll(() => {
        // Set required environment variables for tests
        process.env.BOT_ENGINE_API_KEY = 'test-engine-key';
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create fresh app instance
        app = createTestApp();
    });

    describe('Bot Management Routes', () => {
        describe('GET /api/bot/management/instances', () => {
            it('should return list of bot instances for authenticated user', async () => {
                const mockBotInstances = [
                    {
                        id: 'bot-1',
                        strategy_id: 'strategy-1',
                        user_id: 'user-123',
                        status: 'RUNNING',
                        running_time: 3600,
                        total_trades: 150,
                        total_pnl: 1250.50,
                        created_at: new Date().toISOString(),
                        strategy_name: 'Grid Trading BTC',
                        strategy_type: 'GRID',
                        strategy_config: { symbol: 'PERP_BTC_USDC' },
                    },
                ];

                const serviceProvider = require('../../../src/core/service-provider').serviceProvider;
                serviceProvider.getBotManagementService().getBotInstances.mockResolvedValue(mockBotInstances);

                const response = await request(app)
                    .get('/api/bot/management/instances')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(expect.arrayContaining([
                    expect.objectContaining({
                        id: 'bot-1',
                        strategy_id: 'strategy-1',
                        user_id: 'user-123',
                        status: 'RUNNING',
                        running_time: 3600,
                        total_trades: 150,
                        total_pnl: 1250.50,
                        strategy_name: 'Grid Trading BTC',
                        strategy_type: 'GRID',
                        strategy_config: { symbol: 'PERP_BTC_USDC' },
                    })
                ]));
                expect(serviceProvider.getBotManagementService().getBotInstances).toHaveBeenCalledWith('user-123');
            });
        });

        describe('POST /api/bot/management/start', () => {
            it('should start a bot instance', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC' },
                    user_id: 'user-123',
                    active: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                const mockBotInstance = {
                    id: 'test-bot-id',
                    strategy_id: 'strategy-1',
                    user_id: 'user-123',
                    status: 'RUNNING',
                    running_time: 0,
                    total_trades: 0,
                    total_pnl: 0,
                };

                const serviceProvider = require('../../../src/core/service-provider').serviceProvider;
                serviceProvider.getBotManagementService().createAndStartBot.mockResolvedValue(mockBotInstance);

                // Mock the strategy repository used by bot management service
                const strategyRepositoryAdapter = require('../../../src/infrastructure/adapters/repositories/strategy-repository.adapter').strategyRepositoryAdapter;
                strategyRepositoryAdapter.getStrategy.mockResolvedValue(mockStrategy);

                // Mock the bot instance repository
                const botInstanceRepositoryAdapter = require('../../../src/infrastructure/adapters/repositories/bot-instance-repository.adapter').botInstanceRepositoryAdapter;
                botInstanceRepositoryAdapter.getActiveBotInstances.mockResolvedValue([]);
                botInstanceRepositoryAdapter.createBotInstance.mockResolvedValue(mockBotInstance);

                // Mock the audit log repository
                const auditLogRepositoryAdapter = require('../../../src/infrastructure/adapters/repositories/audit-log-repository.adapter').auditLogRepositoryAdapter;
                auditLogRepositoryAdapter.logEvent.mockResolvedValue(undefined);

                const query = require('../../../src/database/pool').query;
                query.mockImplementation((sql: string) => {
                    console.log('Query called with SQL:', sql);
                    if (sql.includes('SELECT * FROM strategies')) {
                        return Promise.resolve({ rows: [mockStrategy] });
                    } else if (sql.includes('INSERT INTO audit_logs')) {
                        return Promise.resolve({});
                    } else if (sql.includes('UPDATE strategies')) {
                        return Promise.resolve({});
                    }
                    return Promise.resolve({ rows: [] });
                });

                // Mock position validator
                jest.spyOn(require('../../../src/core/strategies/position-validator.service.pure'), 'PositionValidatorService')
                    .mockResolvedValue({
                        isValid: true,
                        maxAllowed: 10000,
                        recommended: 5000,
                    });

                const response = await request(app)
                    .post('/api/bot/management/start')
                    .send({
                        strategyId: 'strategy-1',
                        notionalAmount: 1000.50,
                    });

                console.log('Response status:', response.status);
                console.log('Response body:', response.body);

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.data.botId).toEqual('test-bot-id');
                expect(response.body.data.strategyId).toEqual('strategy-1');
                expect(response.body.data.status).toEqual('RUNNING');
                expect(serviceProvider.getBotManagementService().createAndStartBot).toHaveBeenCalledWith('user-123', 'strategy-1', 1000.50);
            });
        });

        describe('POST /api/bot/management/stop', () => {
            it('should stop a running bot instance', async () => {
                const serviceProvider = require('../../../src/core/service-provider').serviceProvider;
                serviceProvider.getBotManagementService().stopBot.mockResolvedValue(undefined);

                const response = await request(app)
                    .post('/api/bot/management/stop')
                    .send({
                        botId: 'bot-1',
                    })
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data.botId).toEqual('bot-1');
                expect(response.body.data.status).toEqual('STOPPED');
                expect(serviceProvider.getBotManagementService().stopBot).toHaveBeenCalledWith('user-123', 'bot-1');
            });
        });

        describe('GET /api/bot/management/status/:botId', () => {
            it('should return bot status', async () => {
                const mockBot = {
                    id: 'bot-1',
                    userId: 'user-123',
                    strategy_id: 'strategy-1',
                    status: 'RUNNING',
                    last_heartbeat: new Date(),
                    last_error: null,
                    created_at: new Date(),
                    updated_at: new Date(),
                };

                const serviceProvider = require('../../../src/core/service-provider').serviceProvider;
                serviceProvider.getBotManagementService().getBotInstance.mockResolvedValue(mockBot);

                const response = await request(app)
                    .get('/api/bot/management/status/bot-1')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(expect.objectContaining({
                    id: 'bot-1',
                    status: 'RUNNING',
                }));
                expect(serviceProvider.getBotManagementService().getBotInstance).toHaveBeenCalledWith('bot-1');
            });

            it('should handle bot not found', async () => {
                const serviceProvider = require('../../../src/core/service-provider').serviceProvider;
                serviceProvider.getBotManagementService().getBotInstance.mockResolvedValue(null);

                const response = await request(app)
                    .get('/api/bot/management/status/nonexistent-bot')
                    .expect(404);

                expect(response.body.success).toBe(false);
            });
        });

        describe('GET /api/bot/management/performance/:botId', () => {
            it('should return bot performance', async () => {
                const mockPerformance = {
                    total_trades: 150,
                    total_pnl: 1250.50,
                };

                const serviceProvider = require('../../../src/core/service-provider').serviceProvider;
                serviceProvider.getBotManagementService().getBotPerformance.mockResolvedValue(mockPerformance);

                const response = await request(app)
                    .get('/api/bot/management/performance/bot-1')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(mockPerformance);
                expect(serviceProvider.getBotManagementService().getBotPerformance).toHaveBeenCalledWith('bot-1');
            });
        });

        describe('GET /api/bot/management/engine/status', () => {
            it('should return engine status', async () => {
                const mockEngineStatus = {
                    running: true,
                    status: 'healthy',
                };

                const engineManager = require('../../../src/core/service-provider').serviceProvider.getEngineManager();
                engineManager.getEngineStatus.mockResolvedValue(mockEngineStatus);

                const response = await request(app)
                    .get('/api/bot/management/engine/status')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(mockEngineStatus);
                expect(engineManager.getEngineStatus).toHaveBeenCalled();
            });
        });
    });

    describe('Bot Engine Routes', () => {
        describe('POST /api/bot/engine/heartbeat', () => {
            it('should record bot heartbeat', async () => {
                const query = require('../../../src/database/pool').query;
                query.mockResolvedValueOnce({ rows: [{}] }) // Check bot exists
                    .mockResolvedValueOnce({}); // Update bot

                const response = await request(app)
                    .post('/api/bot/engine/heartbeat')
                    .set('x-bot-engine-key', 'test-engine-key')
                    .send({
                        bot_id: 'bot-1',
                        status: 'RUNNING',
                        position: 100,
                        exposure: 50,
                        timestamp: Date.now(),
                    })
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(query).toHaveBeenCalled();
            });
        });

        describe('POST /api/bot/engine/report-trade', () => {
            it('should record trade report', async () => {
                const query = require('../../../src/database/pool').query;
                query.mockResolvedValueOnce({}) // Insert trade
                    .mockResolvedValueOnce({}); // Update bot statistics

                // Create a new app with properly mocked io
                const testApp = createTestApp();
                testApp.set('io', {
                    to: jest.fn().mockReturnThis(),
                    emit: jest.fn(),
                });

                const response = await request(testApp)
                    .post('/api/bot/engine/report-trade')
                    .set('x-bot-engine-key', 'test-engine-key')
                    .send({
                        userId: 'user-123',
                        strategyId: 'strategy-1',
                        orderId: 'order-1',
                        symbol: 'PERP_BTC_USDC',
                        side: 'BUY',
                        quantity: 0.5,
                        price: 50000,
                        pnl: 100,
                        fee: 0.1,
                        status: 'FILLED',
                    })
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(query).toHaveBeenCalled();
            });
        });

        describe('POST /api/bot/engine/engine-status', () => {
            it('should process engine status update', async () => {
                const response = await request(app)
                    .post('/api/bot/engine/engine-status')
                    .set('x-bot-engine-key', 'test-engine-key')
                    .send({
                        status: 'running',
                        activeBots: 2,
                        totalBots: 5,
                        uptime: 3600,
                        memoryUsage: { rss: 100000000 },
                        cpuUsage: 0.1,
                    })
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.acknowledged).toBe(true);
            });
        });

        describe('GET /api/bot/engine/engine/health', () => {
            it('should return engine health', async () => {
                const query = require('../../../src/database/pool').query;
                query.mockResolvedValueOnce({
                    rows: [{ total_bots: 5, running_bots: 2, error_bots: 0 }]
                }) // Get bot stats
                    .mockResolvedValueOnce({}); // Check database connectivity

                const response = await request(app)
                    .get('/api/bot/engine/engine/health')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(expect.objectContaining({
                    status: 'healthy',
                    botStats: {
                        total_bots: 5,
                        running_bots: 2,
                        error_bots: 0,
                    },
                    database: 'connected',
                }));
                expect(query).toHaveBeenCalled();
            });
        });
    });
});