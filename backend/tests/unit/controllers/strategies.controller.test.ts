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

// Mock DI container
jest.mock('../../../src/infrastructure/dependency-injection.container', () => ({
    diContainer: {
        strategyService: {
            getStrategies: jest.fn(),
            createStrategy: jest.fn(),
            getStrategy: jest.fn(),
            updateStrategy: jest.fn(),
            deleteStrategy: jest.fn(),
            getStrategyPerformance: jest.fn(),
        },
    },
}));

// Create a test app
function createTestApp(): Express {
    const express = require('express');
    const app = express();

    // Add necessary middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Import and register routes
    const { strategyRoutes } = require('../../../src/interfaces/http/trading/strategies');
    app.use('/api/strategies', strategyRoutes);

    return app;
}

describe('Strategies Controller', () => {
    let app: Express;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create fresh app instance
        app = createTestApp();
    });

    describe('Strategy Management Routes', () => {
        describe('GET /api/strategies', () => {
            it('should return list of strategies for authenticated user', async () => {
                const mockStrategies = [
                    {
                        id: 'strategy-1',
                        name: 'Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                        userId: 'user-123',
                        active: true,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    },
                ];

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategies.mockResolvedValue(mockStrategies);

                const response = await request(app)
                    .get('/api/strategies')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(expect.arrayContaining([
                    expect.objectContaining({
                        id: 'strategy-1',
                        name: 'Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                        userId: 'user-123',
                        active: true,
                    })
                ]));
                expect(diContainer.strategyService.getStrategies).toHaveBeenCalledWith('user-123');
            });

            it('should handle errors when fetching strategies', async () => {
                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategies.mockRejectedValue(new Error('Database error'));

                const response = await request(app)
                    .get('/api/strategies')
                    .expect(500);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toEqual('Failed to get strategies');
            });
        });

        describe('POST /api/strategies', () => {
            it('should create a new strategy', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.createStrategy.mockResolvedValue(mockStrategy);

                const response = await request(app)
                    .post('/api/strategies')
                    .send({
                        name: 'Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    })
                    .expect(201);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(expect.objectContaining({
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                }));
                expect(diContainer.strategyService.createStrategy).toHaveBeenCalledWith('user-123', expect.objectContaining({
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                }));
            });

            it('should validate input before creating strategy', async () => {
                const response = await request(app)
                    .post('/api/strategies')
                    .send({
                        name: '',
                        type: 'INVALID_TYPE',
                        config: {},
                    })
                    .expect(400);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toBeDefined();
            });

            it('should handle errors when creating strategy', async () => {
                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.createStrategy.mockRejectedValue(new Error('Database error'));

                const response = await request(app)
                    .post('/api/strategies')
                    .send({
                        name: 'Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    })
                    .expect(500);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toEqual('Failed to create strategy');
            });
        });

        describe('GET /api/strategies/:id', () => {
            it('should return strategy by id for authenticated user', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(mockStrategy);

                const response = await request(app)
                    .get('/api/strategies/strategy-1')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(expect.objectContaining({
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                }));
                expect(diContainer.strategyService.getStrategy).toHaveBeenCalledWith('strategy-1');
            });

            it('should return 404 for non-existent strategy', async () => {
                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(null);

                const response = await request(app)
                    .get('/api/strategies/nonexistent-strategy')
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should return 404 for strategy belonging to another user', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'another-user',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(mockStrategy);

                const response = await request(app)
                    .get('/api/strategies/strategy-1')
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should handle errors when fetching strategy', async () => {
                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockRejectedValue(new Error('Database error'));

                const response = await request(app)
                    .get('/api/strategies/strategy-1')
                    .expect(500);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toEqual('Failed to get strategy');
            });
        });

        describe('PUT /api/strategies/:id', () => {
            it('should update strategy', async () => {
                const existingStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const updatedStrategy = {
                    id: 'strategy-1',
                    name: 'Updated Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 15, gridRange: 8 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(existingStrategy);
                diContainer.strategyService.updateStrategy.mockResolvedValue(updatedStrategy);

                const response = await request(app)
                    .put('/api/strategies/strategy-1')
                    .send({
                        name: 'Updated Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 15, gridRange: 8 },
                    })
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(expect.objectContaining({
                    id: 'strategy-1',
                    name: 'Updated Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 15, gridRange: 8 },
                    userId: 'user-123',
                    active: true,
                }));
                expect(diContainer.strategyService.getStrategy).toHaveBeenCalledWith('strategy-1');
                expect(diContainer.strategyService.updateStrategy).toHaveBeenCalledWith('strategy-1', expect.objectContaining({
                    name: 'Updated Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 15, gridRange: 8 },
                }));
            });

            it('should validate input before updating strategy', async () => {
                const existingStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(existingStrategy);

                const response = await request(app)
                    .put('/api/strategies/strategy-1')
                    .send({
                        name: '',
                        type: 'INVALID_TYPE',
                        config: {},
                    })
                    .expect(400);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toBeDefined();
            });

            it('should return 404 for updating non-existent strategy', async () => {
                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(null);

                const response = await request(app)
                    .put('/api/strategies/nonexistent-strategy')
                    .send({
                        name: 'Updated Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 15, gridRange: 8 },
                    })
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should return 404 for updating strategy belonging to another user', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'another-user',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(mockStrategy);

                const response = await request(app)
                    .put('/api/strategies/strategy-1')
                    .send({
                        name: 'Updated Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 15, gridRange: 8 },
                    })
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should handle errors when updating strategy', async () => {
                const existingStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(existingStrategy);
                diContainer.strategyService.updateStrategy.mockRejectedValue(new Error('Database error'));

                const response = await request(app)
                    .put('/api/strategies/strategy-1')
                    .send({
                        name: 'Updated Grid Trading BTC',
                        type: 'GRID',
                        config: { symbol: 'PERP_BTC_USDC', gridSize: 15, gridRange: 8 },
                    })
                    .expect(500);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toEqual('Failed to update strategy');
            });
        });

        describe('DELETE /api/strategies/:id', () => {
            it('should delete strategy', async () => {
                const existingStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(existingStrategy);
                diContainer.strategyService.deleteStrategy.mockResolvedValue(undefined);

                const response = await request(app)
                    .delete('/api/strategies/strategy-1')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.message).toEqual('Strategy deleted');
                expect(diContainer.strategyService.getStrategy).toHaveBeenCalledWith('strategy-1');
                expect(diContainer.strategyService.deleteStrategy).toHaveBeenCalledWith('strategy-1');
            });

            it('should return 404 for deleting non-existent strategy', async () => {
                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(null);

                const response = await request(app)
                    .delete('/api/strategies/nonexistent-strategy')
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should return 404 for deleting strategy belonging to another user', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'another-user',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(mockStrategy);

                const response = await request(app)
                    .delete('/api/strategies/strategy-1')
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should handle errors when deleting strategy', async () => {
                const existingStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(existingStrategy);
                diContainer.strategyService.deleteStrategy.mockRejectedValue(new Error('Database error'));

                const response = await request(app)
                    .delete('/api/strategies/strategy-1')
                    .expect(500);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toEqual('Failed to delete strategy');
            });
        });

        describe('GET /api/strategies/:id/performance', () => {
            it('should return strategy performance', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const mockPerformance = {
                    total_trades: 150,
                    total_pnl: 1250.50,
                    win_rate: 0.65,
                    average_trade: 8.34,
                    max_drawdown: 250.75,
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(mockStrategy);
                diContainer.strategyService.getStrategyPerformance.mockResolvedValue(mockPerformance);

                const response = await request(app)
                    .get('/api/strategies/strategy-1/performance')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(mockPerformance);
                expect(diContainer.strategyService.getStrategy).toHaveBeenCalledWith('strategy-1');
                expect(diContainer.strategyService.getStrategyPerformance).toHaveBeenCalledWith('strategy-1');
            });

            it('should return 404 for performance of non-existent strategy', async () => {
                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(null);

                const response = await request(app)
                    .get('/api/strategies/nonexistent-strategy/performance')
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should return 404 for performance of strategy belonging to another user', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'another-user',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(mockStrategy);

                const response = await request(app)
                    .get('/api/strategies/strategy-1/performance')
                    .expect(404);

                expect(response.body.success).toBe(false);
            });

            it('should handle errors when fetching strategy performance', async () => {
                const mockStrategy = {
                    id: 'strategy-1',
                    name: 'Grid Trading BTC',
                    type: 'GRID',
                    config: { symbol: 'PERP_BTC_USDC', gridSize: 10, gridRange: 5 },
                    userId: 'user-123',
                    active: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                const diContainer = require('../../../src/infrastructure/dependency-injection.container').diContainer;
                diContainer.strategyService.getStrategy.mockResolvedValue(mockStrategy);
                diContainer.strategyService.getStrategyPerformance.mockRejectedValue(new Error('Database error'));

                const response = await request(app)
                    .get('/api/strategies/strategy-1/performance')
                    .expect(500);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toEqual('Failed to get performance');
            });
        });

    });
});
