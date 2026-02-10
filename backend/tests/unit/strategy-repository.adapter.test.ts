/** @format */

import { StrategyRepositoryAdapter, strategyRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/strategy-repository.adapter';
import { Strategy, StrategyType, StrategyConfig } from '@trade-bot/shared';
import { databaseLogger as logger } from '../../src/core/logging/context-aware-logger.service';
import { query } from '../../src/database/pool';

// Mock dependencies
jest.mock('../../src/core/logging/context-aware-logger.service', () => ({
    databaseLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../../src/database/pool', () => ({
    query: jest.fn()
}));

describe('StrategyRepositoryAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should create a StrategyRepositoryAdapter instance', () => {
            const adapter = new StrategyRepositoryAdapter();
            expect(adapter).toBeInstanceOf(StrategyRepositoryAdapter);
        });

        it('should export a singleton instance', () => {
            expect(strategyRepositoryAdapter).toBeInstanceOf(StrategyRepositoryAdapter);
        });
    });

    describe('getStrategies', () => {
        it('should return empty array when no strategies found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new StrategyRepositoryAdapter();
            const userId = 'test-user-id';

            const strategies = await adapter.getStrategies(userId);

            expect(strategies).toEqual([]);
            expect(query).toHaveBeenCalled();
        });

        it('should return strategies for user with valid data', async () => {
            const mockStrategyRows = [
                {
                    id: 'strategy1',
                    user_id: 'test-user-id',
                    name: 'Grid Strategy',
                    type: StrategyType.GRID,
                    config: JSON.stringify({ symbol: 'BTC-USD', gridSize: 5 }),
                    active: true,
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z'
                },
                {
                    id: 'strategy2',
                    user_id: 'test-user-id',
                    name: 'Trend Following',
                    type: StrategyType.TREND_FOLLOWING,
                    config: JSON.stringify({ symbol: 'ETH-USD', movingAverage: 20 }),
                    active: false,
                    created_at: '2024-01-02T00:00:00Z',
                    updated_at: '2024-01-02T00:00:00Z'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockStrategyRows });
            const adapter = new StrategyRepositoryAdapter();
            const userId = 'test-user-id';

            const strategies = await adapter.getStrategies(userId);

            expect(strategies).toHaveLength(2);
            expect(strategies[0]).toEqual(expect.objectContaining({
                id: 'strategy1',
                userId: 'test-user-id',
                name: 'Grid Strategy',
                type: StrategyType.GRID,
                config: { symbol: 'BTC-USD', gridSize: 5 },
                active: true
            }));
            expect(strategies[1]).toEqual(expect.objectContaining({
                id: 'strategy2',
                userId: 'test-user-id',
                name: 'Trend Following',
                type: StrategyType.TREND_FOLLOWING,
                config: { symbol: 'ETH-USD', movingAverage: 20 },
                active: false
            }));
        });

        it('should filter out invalid strategies', async () => {
            const mockStrategyRows = [
                {
                    id: 'invalid-strategy',
                    user_id: 'test-user-id',
                    name: '',
                    type: 'INVALID_TYPE' as StrategyType,
                    config: 'invalid-json',
                    active: true,
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockStrategyRows });
            const adapter = new StrategyRepositoryAdapter();
            const userId = 'test-user-id';

            const strategies = await adapter.getStrategies(userId);

            expect(strategies).toEqual([]);
            expect(logger.error).toHaveBeenCalled();
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database connection error'));
            const adapter = new StrategyRepositoryAdapter();
            const userId = 'test-user-id';

            await expect(adapter.getStrategies(userId)).rejects.toThrow('Failed to get strategies');
        });
    });

    describe('getStrategy', () => {
        it('should return null when strategy not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'non-existent-id';

            const strategy = await adapter.getStrategy(strategyId);

            expect(strategy).toBeNull();
            expect(query).toHaveBeenCalled();
        });

        it('should return strategy when found', async () => {
            const mockStrategyRow = {
                id: 'strategy1',
                user_id: 'test-user-id',
                name: 'Grid Strategy',
                type: StrategyType.GRID,
                config: JSON.stringify({ symbol: 'BTC-USD', gridSize: 5 }),
                active: true,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockStrategyRow] });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';

            const strategy = await adapter.getStrategy(strategyId);

            expect(strategy).toEqual(expect.objectContaining({
                id: 'strategy1',
                userId: 'test-user-id',
                name: 'Grid Strategy',
                type: StrategyType.GRID,
                config: { symbol: 'BTC-USD', gridSize: 5 },
                active: true
            }));
        });

        it('should return null for invalid strategy', async () => {
            const mockStrategyRow = {
                id: 'invalid-strategy',
                user_id: 'test-user-id',
                name: '',
                type: 'INVALID_TYPE' as StrategyType,
                config: 'invalid-json',
                active: true,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockStrategyRow] });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'invalid-strategy';

            const strategy = await adapter.getStrategy(strategyId);

            expect(strategy).toBeNull();
            expect(logger.error).toHaveBeenCalled();
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Query failed'));
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';

            await expect(adapter.getStrategy(strategyId)).rejects.toThrow('Failed to get strategy');
        });
    });

    describe('createStrategy', () => {
        it('should create a new strategy', async () => {
            const strategyData = {
                userId: 'test-user-id',
                name: 'New Strategy',
                type: StrategyType.GRID,
                config: { symbol: 'BTC-USD', gridSize: 5 },
                active: true
            };
            const mockResult = {
                rows: [{
                    id: 'new-strategy-id',
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z'
                }]
            };
            (query as jest.Mock).mockResolvedValue(mockResult);
            const adapter = new StrategyRepositoryAdapter();

            const strategy = await adapter.createStrategy(strategyData);

            expect(strategy).toEqual(expect.objectContaining({
                id: 'new-strategy-id',
                ...strategyData
            }));
            expect(query).toHaveBeenCalledWith(
                'INSERT INTO strategies (user_id, name, type, config, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id, created_at, updated_at',
                [strategyData.userId, strategyData.name, strategyData.type, JSON.stringify(strategyData.config), strategyData.active]
            );
        });

        it('should throw error when creation fails', async () => {
            const strategyData = {
                userId: 'test-user-id',
                name: 'New Strategy',
                type: StrategyType.GRID,
                config: { symbol: 'BTC-USD', gridSize: 5 },
                active: true
            };
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new StrategyRepositoryAdapter();

            await expect(adapter.createStrategy(strategyData)).rejects.toThrow('Strategy creation failed');
        });

        it('should throw error when query fails', async () => {
            const strategyData = {
                userId: 'test-user-id',
                name: 'New Strategy',
                type: StrategyType.GRID,
                config: { symbol: 'BTC-USD', gridSize: 5 },
                active: true
            };
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));
            const adapter = new StrategyRepositoryAdapter();

            await expect(adapter.createStrategy(strategyData)).rejects.toThrow('Failed to create strategy');
        });
    });

    describe('updateStrategy', () => {
        it('should update strategy and log information', async () => {
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';
            const updates = { gridSize: 10 };

            await adapter.updateStrategy(strategyId, updates);

            expect(logger.info).toHaveBeenCalledWith(`Strategy config update for strategy ${strategyId}`);
        });

        it('should throw error when update fails', async () => {
            const errorMessage = 'Update failed';
            const mockLoggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';
            const updates = { gridSize: 10 };

            await expect(adapter.updateStrategy(strategyId, updates)).rejects.toThrow('Failed to update strategy');

            mockLoggerInfo.mockRestore();
        });
    });

    describe('deleteStrategy', () => {
        it('should delete strategy when it exists', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';

            await adapter.deleteStrategy(strategyId);

            expect(query).toHaveBeenCalledWith('DELETE FROM strategies WHERE id = $1', [strategyId]);
        });

        it('should throw error when strategy not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'non-existent-id';

            await expect(adapter.deleteStrategy(strategyId)).rejects.toThrow('Strategy not found');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';

            await expect(adapter.deleteStrategy(strategyId)).rejects.toThrow('Failed to delete strategy');
        });
    });

    describe('toggleStrategy', () => {
        it('should toggle strategy active status when it exists', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';
            const active = true;

            await adapter.toggleStrategy(strategyId, active);

            expect(query).toHaveBeenCalledWith(
                'UPDATE strategies SET active = $1, updated_at = NOW() WHERE id = $2',
                [active, strategyId]
            );
        });

        it('should throw error when strategy not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'non-existent-id';
            const active = true;

            await expect(adapter.toggleStrategy(strategyId, active)).rejects.toThrow('Strategy not found');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));
            const adapter = new StrategyRepositoryAdapter();
            const strategyId = 'strategy1';
            const active = true;

            await expect(adapter.toggleStrategy(strategyId, active)).rejects.toThrow('Failed to toggle strategy');
        });
    });
});