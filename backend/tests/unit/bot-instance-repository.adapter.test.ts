/** @format */

import { BotInstanceRepositoryAdapter, botInstanceRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/bot-instance-repository.adapter';
import { logger } from '../../src/core/logging';
import { query } from '../../src/database/pool';

// Mock dependencies
jest.mock('../../src/core/logging', () => ({
    logger: {
        error: jest.fn()
    }
}));

jest.mock('../../src/database/pool', () => ({
    query: jest.fn()
}));

describe('BotInstanceRepositoryAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should create a BotInstanceRepositoryAdapter instance', () => {
            const adapter = new BotInstanceRepositoryAdapter();
            expect(adapter).toBeInstanceOf(BotInstanceRepositoryAdapter);
        });

        it('should export a singleton instance', () => {
            expect(botInstanceRepositoryAdapter).toBeInstanceOf(BotInstanceRepositoryAdapter);
        });
    });

    describe('getBotInstances', () => {
        it('should return empty array when no bot instances found for user', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new BotInstanceRepositoryAdapter();
            const userId = 'test-user-id';

            const botInstances = await adapter.getBotInstances(userId);

            expect(botInstances).toEqual([]);
            expect(query).toHaveBeenCalled();
        });

        it('should return bot instances for user with strategy details', async () => {
            const mockBotInstances = [
                {
                    id: 'bot-1',
                    strategy_id: 'strategy-1',
                    user_id: 'test-user-id',
                    status: 'RUNNING',
                    running_time: 3600,
                    total_trades: 10,
                    total_pnl: 100.50,
                    strategy_name: 'Test Strategy',
                    strategy_type: 'trend-following',
                    strategy_config: '{}',
                    created_at: '2026-02-04T11:00:00Z',
                    updated_at: '2026-02-04T11:00:00Z'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockBotInstances });
            const adapter = new BotInstanceRepositoryAdapter();
            const userId = 'test-user-id';

            const botInstances = await adapter.getBotInstances(userId);

            expect(botInstances).toEqual(mockBotInstances);
            expect(botInstances).toHaveLength(1);
            expect(botInstances[0].id).toBe('bot-1');
            expect(botInstances[0].strategy_name).toBe('Test Strategy');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database connection error'));
            const adapter = new BotInstanceRepositoryAdapter();
            const userId = 'test-user-id';

            await expect(adapter.getBotInstances(userId)).rejects.toThrow('Failed to get bot instances');
        });
    });

    describe('getBotInstance', () => {
        it('should return null when bot instance not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'non-existent-bot';

            const botInstance = await adapter.getBotInstance(botId);

            expect(botInstance).toBeNull();
        });

        it('should return bot instance with strategy details when found', async () => {
            const mockBotInstance = {
                id: 'bot-1',
                strategy_id: 'strategy-1',
                user_id: 'test-user-id',
                status: 'RUNNING',
                running_time: 3600,
                total_trades: 10,
                total_pnl: 100.50,
                strategy_name: 'Test Strategy',
                strategy_type: 'trend-following',
                strategy_config: '{}',
                created_at: '2026-02-04T11:00:00Z',
                updated_at: '2026-02-04T11:00:00Z'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockBotInstance] });
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';

            const botInstance = await adapter.getBotInstance(botId);

            expect(botInstance).toEqual(mockBotInstance);
            expect(botInstance.id).toBe('bot-1');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Query failed'));
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';

            await expect(adapter.getBotInstance(botId)).rejects.toThrow('Failed to get bot instance');
        });
    });

    describe('createBotInstance', () => {
        it('should create a new bot instance with default values', async () => {
            const mockBotData = {
                id: 'new-bot',
                strategy_id: 'strategy-1',
                user_id: 'test-user-id'
            };
            const createdBot = {
                ...mockBotData,
                status: 'RUNNING',
                running_time: 0,
                total_trades: 0,
                total_pnl: 0,
                created_at: '2026-02-04T11:00:00Z',
                updated_at: '2026-02-04T11:00:00Z'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [createdBot] });
            const adapter = new BotInstanceRepositoryAdapter();

            const result = await adapter.createBotInstance(mockBotData);

            expect(result).toEqual(createdBot);
            expect(query).toHaveBeenCalled();
        });

        it('should create a new bot instance with provided values', async () => {
            const mockBotData = {
                id: 'new-bot',
                strategy_id: 'strategy-1',
                user_id: 'test-user-id',
                status: 'PAUSED',
                running_time: 1800,
                total_trades: 5,
                total_pnl: 50.25
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockBotData] });
            const adapter = new BotInstanceRepositoryAdapter();

            const result = await adapter.createBotInstance(mockBotData);

            expect(result).toEqual(mockBotData);
            expect(result.status).toBe('PAUSED');
            expect(result.running_time).toBe(1800);
        });

        it('should throw error when creation fails', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new BotInstanceRepositoryAdapter();
            const mockBotData = {
                id: 'new-bot',
                strategy_id: 'strategy-1',
                user_id: 'test-user-id'
            };

            await expect(adapter.createBotInstance(mockBotData)).rejects.toThrow('Bot instance creation failed');
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Creation failed'));
            const adapter = new BotInstanceRepositoryAdapter();
            const mockBotData = {
                id: 'new-bot',
                strategy_id: 'strategy-1',
                user_id: 'test-user-id'
            };

            await expect(adapter.createBotInstance(mockBotData)).rejects.toThrow('Failed to create bot instance');
        });
    });

    describe('updateBotStatus', () => {
        it('should update bot instance status', async () => {
            (query as jest.Mock).mockResolvedValue({});
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';
            const newStatus = 'PAUSED';

            await adapter.updateBotStatus(botId, newStatus);

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE bot_instances'),
                expect.arrayContaining([newStatus, botId])
            );
        });

        it('should throw error when status update fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Update failed'));
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';
            const newStatus = 'PAUSED';

            await expect(adapter.updateBotStatus(botId, newStatus)).rejects.toThrow('Failed to update bot status');
        });
    });

    describe('updateBotPerformance', () => {
        it('should update all performance metrics', async () => {
            (query as jest.Mock).mockResolvedValue({});
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';
            const metrics = {
                runningTime: 7200,
                totalTrades: 20,
                totalPnL: 200.75
            };

            await adapter.updateBotPerformance(botId, metrics);

            expect(query).toHaveBeenCalled();
        });

        it('should update partial performance metrics', async () => {
            (query as jest.Mock).mockResolvedValue({});
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';
            const metrics = {
                totalTrades: 20
            };

            await adapter.updateBotPerformance(botId, metrics);

            expect(query).toHaveBeenCalled();
        });

        it('should do nothing when no metrics provided', async () => {
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';
            const metrics = {};

            await adapter.updateBotPerformance(botId, metrics);

            expect(query).not.toHaveBeenCalled();
        });

        it('should throw error when performance update fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Update failed'));
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';
            const metrics = {
                runningTime: 7200
            };

            await expect(adapter.updateBotPerformance(botId, metrics)).rejects.toThrow('Failed to update bot performance');
        });
    });

    describe('deleteBotInstance', () => {
        it('should delete bot instance', async () => {
            (query as jest.Mock).mockResolvedValue({});
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';

            await adapter.deleteBotInstance(botId);

            expect(query).toHaveBeenCalledWith(
                'DELETE FROM bot_instances WHERE id = $1',
                [botId]
            );
        });

        it('should throw error when deletion fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Deletion failed'));
            const adapter = new BotInstanceRepositoryAdapter();
            const botId = 'bot-1';

            await expect(adapter.deleteBotInstance(botId)).rejects.toThrow('Failed to delete bot instance');
        });
    });

    describe('getActiveBotInstances', () => {
        it('should return empty array when no active bot instances', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new BotInstanceRepositoryAdapter();

            const activeBots = await adapter.getActiveBotInstances();

            expect(activeBots).toEqual([]);
        });

        it('should return active bot instances (RUNNING and STARTING)', async () => {
            const mockActiveBots = [
                {
                    id: 'bot-1',
                    status: 'RUNNING',
                    strategy_id: 'strategy-1',
                    user_id: 'test-user-id',
                    running_time: 3600,
                    total_trades: 10,
                    total_pnl: 100.50
                },
                {
                    id: 'bot-2',
                    status: 'STARTING',
                    strategy_id: 'strategy-2',
                    user_id: 'test-user-id',
                    running_time: 0,
                    total_trades: 0,
                    total_pnl: 0
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockActiveBots });
            const adapter = new BotInstanceRepositoryAdapter();

            const activeBots = await adapter.getActiveBotInstances();

            expect(activeBots).toEqual(mockActiveBots);
            expect(activeBots).toHaveLength(2);
            expect(activeBots.every(bot => ['RUNNING', 'STARTING'].includes(bot.status))).toBe(true);
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Query failed'));
            const adapter = new BotInstanceRepositoryAdapter();

            await expect(adapter.getActiveBotInstances()).rejects.toThrow('Failed to get active bot instances');
        });
    });
});