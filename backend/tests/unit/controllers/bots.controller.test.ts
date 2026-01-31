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

// Mock the entire bots module
jest.mock('../../../src/interfaces/http/bots', () => {
    const express = require('express');
    const mockBotManagementRoutes = express.Router();
    const mockBotEngineRoutes = express.Router();

    // Create mock routes for testing
    mockBotManagementRoutes.get('/instances', (req: any, res: any) => res.json({}));
    mockBotManagementRoutes.post('/start', (req: any, res: any) => res.json({}));
    mockBotManagementRoutes.post('/stop', (req: any, res: any) => res.json({}));
    mockBotManagementRoutes.get('/status/:botId', (req: any, res: any) => res.json({}));
    mockBotManagementRoutes.get('/performance/:botId', (req: any, res: any) => res.json({}));
    mockBotManagementRoutes.get('/engine/status', (req: any, res: any) => res.json({}));

    mockBotEngineRoutes.post('/heartbeat', (req: any, res: any) => res.json({}));
    mockBotEngineRoutes.post('/report-trade', (req: any, res: any) => res.json({}));
    mockBotEngineRoutes.post('/engine-status', (req: any, res: any) => res.json({}));
    mockBotEngineRoutes.get('/engine/health', (req: any, res: any) => res.json({}));

    return {
        __esModule: true,
        botManagementRoutes: mockBotManagementRoutes,
        botEngineRoutes: mockBotEngineRoutes,
    };
});

import { Request, Response } from 'express';
import { botManagementRoutes, botEngineRoutes } from '../../../src/interfaces/http/bots';
import { query } from '../../../src/database/pool';
import { engineManager } from '../../../src/core/strategies/engine-manager.service';

// Mock all other dependencies
jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('test-bot-id'),
}));

jest.mock('../../../src/database/pool', () => ({
    query: jest.fn(),
}));

jest.mock('../../../src/core/strategies/engine-manager.service', () => ({
    engineManager: {
        ensureEngineRunning: jest.fn().mockResolvedValue(undefined),
        stopEngineIfNoActiveBots: jest.fn().mockResolvedValue(undefined),
        getEngineStatus: jest.fn().mockResolvedValue({ running: true }),
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

describe('Bots Controller', () => {
    let req: Partial<Request> & { user?: any };
    let res: Partial<Response>;
    let next: jest.Mock;

    beforeEach(() => {
        req = {
            body: {},
            params: {},
            headers: {},
            ip: '127.0.0.1',
            app: {
                get: jest.fn().mockReturnValue({
                    emit: jest.fn(),
                }),
            } as any, // Type assertion to avoid Application type errors
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();

        // Reset all mocks
        jest.clearAllMocks();

        // Mock authenticated user
        req.user = {
            userId: 'user-123',
            email: 'test@example.com',
            userLevel: 'VERIFIED',
            roles: [],
        };
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
                        created_at: new Date(),
                        strategy_name: 'Grid Trading BTC',
                        strategy_type: 'GRID',
                        strategy_config: { symbol: 'PERP_BTC_USDC' },
                    },
                ];

                (query as jest.Mock).mockResolvedValue({
                    rows: mockBotInstances,
                });

                const instancesRoute = botManagementRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/instances' && route.route.methods.get
                );

                if (!instancesRoute || !instancesRoute.route) {
                    throw new Error('Bot instances route not found');
                }

                const instancesHandler = instancesRoute.route.stack[2].handle; // Skip auth and rate limiter middleware

                await instancesHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    data: mockBotInstances,
                }));
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
                };

                (query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [mockStrategy] }) // Get strategy
                    .mockResolvedValueOnce({ rows: [] }) // Check existing bot
                    .mockResolvedValueOnce({}) // Create bot instance
                    .mockResolvedValueOnce({ rows: [{}] }) // Check credentials
                    .mockResolvedValueOnce({}) // Log audit trail
                    .mockResolvedValueOnce({}); // Update strategy

                req.body = {
                    strategyId: 'strategy-1',
                    notionalAmount: 1000.50,
                };

                const startRoute = botManagementRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/start' && route.route.methods.post
                );

                if (!startRoute || !startRoute.route) {
                    throw new Error('Start bot route not found');
                }

                const startHandler = startRoute.route.stack[3].handle; // Skip auth, user level check, and validation

                await startHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(engineManager.ensureEngineRunning).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    data: expect.any(Object),
                }));
            });
        });

        describe('POST /api/bot/management/stop', () => {
            it('should stop a running bot instance', async () => {
                const mockBot = {
                    strategy_id: 'strategy-1',
                    status: 'RUNNING',
                };

                (query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [mockBot] }) // Get bot
                    .mockResolvedValueOnce({}) // Update bot status
                    .mockResolvedValueOnce({}); // Update strategy

                req.body = {
                    botId: 'bot-1',
                };

                const stopRoute = botManagementRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/stop' && route.route.methods.post
                );

                if (!stopRoute || !stopRoute.route) {
                    throw new Error('Stop bot route not found');
                }

                const stopHandler = stopRoute.route.stack[3].handle; // Skip auth, user level check, and validation

                await stopHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    data: expect.any(Object),
                }));
            });
        });

        describe('GET /api/bot/management/status/:botId', () => {
            it('should return bot status', async () => {
                const mockBot = {
                    id: 'bot-1',
                    user_id: 'user-123',
                    strategy_id: 'strategy-1',
                    status: 'RUNNING',
                    last_heartbeat: new Date(),
                    last_error: null,
                    created_at: new Date(),
                    updated_at: new Date(),
                };

                (query as jest.Mock).mockResolvedValue({
                    rows: [mockBot],
                });

                req.params = { botId: 'bot-1' };

                const statusRoute = botManagementRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/status/:botId' && route.route.methods.get
                );

                if (!statusRoute || !statusRoute.route) {
                    throw new Error('Bot status route not found');
                }

                const statusHandler = statusRoute.route.stack[1].handle; // Skip auth middleware

                await statusHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    data: expect.any(Object),
                }));
            });

            it('should handle bot not found', async () => {
                (query as jest.Mock).mockResolvedValue({
                    rows: [],
                });

                req.params = { botId: 'nonexistent-bot' };

                const statusRoute = botManagementRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/status/:botId' && route.route.methods.get
                );

                if (!statusRoute || !statusRoute.route) {
                    throw new Error('Bot status route not found');
                }

                const statusHandler = statusRoute.route.stack[1].handle; // Skip auth middleware

                await statusHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.status).toHaveBeenCalledWith(404);
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: false,
                }));
            });
        });

        describe('GET /api/bot/management/performance/:botId', () => {
            it('should return bot performance', async () => {
                const mockPerformance = {
                    total_trades: 150,
                    total_pnl: 1250.50,
                };

                (query as jest.Mock).mockResolvedValue({
                    rows: [mockPerformance],
                });

                req.params = { botId: 'bot-1' };

                const performanceRoute = botManagementRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/performance/:botId' && route.route.methods.get
                );

                if (!performanceRoute || !performanceRoute.route) {
                    throw new Error('Bot performance route not found');
                }

                const performanceHandler = performanceRoute.route.stack[1].handle; // Skip auth middleware

                await performanceHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    data: expect.any(Object),
                }));
            });
        });

        describe('GET /api/bot/management/engine/status', () => {
            it('should return engine status', async () => {
                const mockEngineStatus = {
                    running: true,
                    status: 'healthy',
                };

                (engineManager.getEngineStatus as jest.Mock).mockResolvedValue(mockEngineStatus);

                const engineStatusRoute = botManagementRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/engine/status' && route.route.methods.get
                );

                if (!engineStatusRoute || !engineStatusRoute.route) {
                    throw new Error('Engine status route not found');
                }

                const engineStatusHandler = engineStatusRoute.route.stack[1].handle; // Skip auth middleware

                await engineStatusHandler(req as Request, res as Response, next);

                expect(engineManager.getEngineStatus).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    data: mockEngineStatus,
                }));
            });
        });
    });

    describe('Bot Engine Routes', () => {
        describe('POST /api/bot/engine/heartbeat', () => {
            it('should record bot heartbeat', async () => {
                (query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [{}] }) // Check bot exists
                    .mockResolvedValueOnce({}); // Update bot

                req.headers = req.headers || {};
                req.headers['x-bot-engine-key'] = 'test-engine-key';
                req.body = {
                    bot_id: 'bot-1',
                    status: 'RUNNING',
                    position: 100,
                    exposure: 50,
                    timestamp: Date.now(),
                };

                const heartbeatRoute = botEngineRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/heartbeat' && route.route.methods.post
                );

                if (!heartbeatRoute || !heartbeatRoute.route) {
                    throw new Error('Heartbeat route not found');
                }

                const heartbeatHandler = heartbeatRoute.route.stack[1].handle; // Skip auth middleware

                await heartbeatHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith({
                    success: true,
                });
            });
        });

        describe('POST /api/bot/engine/report-trade', () => {
            it('should record trade report', async () => {
                (query as jest.Mock)
                    .mockResolvedValueOnce({}) // Insert trade
                    .mockResolvedValueOnce({}); // Update bot statistics

                req.headers = req.headers || {};
                req.headers['x-bot-engine-key'] = 'test-engine-key';
                req.body = {
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
                };

                const reportTradeRoute = botEngineRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/report-trade' && route.route.methods.post
                );

                if (!reportTradeRoute || !reportTradeRoute.route) {
                    throw new Error('Report trade route not found');
                }

                const reportTradeHandler = reportTradeRoute.route.stack[1].handle; // Skip auth middleware

                await reportTradeHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith({
                    success: true,
                });
            });
        });

        describe('POST /api/bot/engine/engine-status', () => {
            it('should process engine status update', async () => {
                req.headers = req.headers || {};
                req.headers['x-bot-engine-key'] = 'test-engine-key';
                req.body = {
                    status: 'running',
                    activeBots: 2,
                    totalBots: 5,
                    uptime: 3600,
                    memoryUsage: { rss: 100000000 },
                    cpuUsage: 0.1,
                };

                const engineStatusRoute = botEngineRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/engine-status' && route.route.methods.post
                );

                if (!engineStatusRoute || !engineStatusRoute.route) {
                    throw new Error('Engine status route not found');
                }

                const engineStatusHandler = engineStatusRoute.route.stack[1].handle; // Skip auth middleware

                await engineStatusHandler(req as Request, res as Response, next);

                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    acknowledged: true,
                }));
            });
        });

        describe('GET /api/bot/engine/health', () => {
            it('should return engine health', async () => {
                (query as jest.Mock)
                    .mockResolvedValueOnce({ rows: [{ total_bots: 5, running_bots: 2, error_bots: 0 }] }) // Get bot stats
                    .mockResolvedValueOnce({}); // Check database connectivity

                const healthRoute = botEngineRoutes.stack.find((route: any) =>
                    route.route && route.route.path === '/engine/health' && route.route.methods.get
                );

                if (!healthRoute || !healthRoute.route) {
                    throw new Error('Engine health route not found');
                }

                const healthHandler = healthRoute.route.stack[0].handle;

                await healthHandler(req as Request, res as Response, next);

                expect(query).toHaveBeenCalled();
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: true,
                    data: expect.any(Object),
                }));
            });
        });
    });
});