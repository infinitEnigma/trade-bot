/** @format */

import { TradeRepositoryAdapter, tradeRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/trade-repository.adapter';
import { Trade, OrderStatus, OrderSide } from '@trade-bot/shared';
import { logger } from '../../src/core/logging';
import { query } from '../../src/database/pool';

// Mock dependencies
jest.mock('../../src/core/logging', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../../src/database/pool', () => ({
    query: jest.fn()
}));

describe('TradeRepositoryAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should create a TradeRepositoryAdapter instance', () => {
            const adapter = new TradeRepositoryAdapter();
            expect(adapter).toBeInstanceOf(TradeRepositoryAdapter);
        });

        it('should export a singleton instance', () => {
            expect(tradeRepositoryAdapter).toBeInstanceOf(TradeRepositoryAdapter);
        });
    });

    describe('getTrades', () => {
        it('should return empty array when no trades found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';

            const trades = await adapter.getTrades(userId);

            expect(trades).toEqual([]);
            expect(query).toHaveBeenCalled();
        });

        it('should return trades for user with valid data', async () => {
            const mockTradeRows = [
                {
                    id: 'trade1',
                    strategy_id: 'strategy1',
                    order_id: 'order1',
                    symbol: 'BTC-USD',
                    side: OrderSide.BUY,
                    quantity: '1.5',
                    price: '50000.00',
                    fee: '0.1',
                    pnl: '50.00',
                    executed_at: '2024-01-01T00:00:00Z'
                },
                {
                    id: 'trade2',
                    strategy_id: 'strategy2',
                    order_id: 'order2',
                    symbol: 'ETH-USD',
                    side: OrderSide.SELL,
                    quantity: '2.0',
                    price: '3000.00',
                    fee: '0.05',
                    pnl: '-10.00',
                    executed_at: '2024-01-02T00:00:00Z'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';

            const trades = await adapter.getTrades(userId);

            expect(trades).toHaveLength(2);
            expect(trades[0]).toEqual(expect.objectContaining({
                id: 'trade1',
                userId: 'unknown',
                strategyId: 'strategy1',
                orderId: 'order1',
                symbol: 'BTC-USD',
                side: OrderSide.BUY,
                quantity: 1.5,
                price: 50000,
                fee: 0.1,
                pnl: 50,
                status: OrderStatus.FILLED
            }));
            expect(trades[1]).toEqual(expect.objectContaining({
                id: 'trade2',
                userId: 'unknown',
                strategyId: 'strategy2',
                orderId: 'order2',
                symbol: 'ETH-USD',
                side: OrderSide.SELL,
                quantity: 2.0,
                price: 3000,
                fee: 0.05,
                pnl: -10,
                status: OrderStatus.FILLED
            }));
        });

        it('should filter out invalid trades', async () => {
            const mockTradeRows = [
                {
                    id: 'invalid-trade',
                    strategy_id: 'strategy1',
                    order_id: 'order1',
                    symbol: '',
                    side: 'INVALID' as OrderSide,
                    quantity: 'invalid',
                    price: 'invalid',
                    fee: 'invalid',
                    pnl: 'invalid',
                    executed_at: '2024-01-01T00:00:00Z'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';

            const trades = await adapter.getTrades(userId);

            expect(trades).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database connection error'));
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';

            await expect(adapter.getTrades(userId)).rejects.toThrow('Failed to get trades');
        });
    });

    describe('getTradesByStrategy', () => {
        it('should return empty array when no trades found for strategy', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';
            const strategyId = 'non-existent-strategy';

            const trades = await adapter.getTradesByStrategy(userId, strategyId);

            expect(trades).toEqual([]);
            expect(query).toHaveBeenCalled();
        });

        it('should return trades for specific strategy', async () => {
            const mockTradeRows = [
                {
                    id: 'trade1',
                    strategy_id: 'strategy1',
                    order_id: 'order1',
                    symbol: 'BTC-USD',
                    side: OrderSide.BUY,
                    quantity: '1.5',
                    price: '50000.00',
                    fee: '0.1',
                    pnl: '50.00',
                    executed_at: '2024-01-01T00:00:00Z'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';
            const strategyId = 'strategy1';

            const trades = await adapter.getTradesByStrategy(userId, strategyId);

            expect(trades).toHaveLength(1);
            expect(trades[0]).toEqual(expect.objectContaining({
                id: 'trade1',
                userId: 'unknown',
                strategyId: 'strategy1',
                orderId: 'order1',
                symbol: 'BTC-USD',
                side: OrderSide.BUY,
                quantity: 1.5,
                price: 50000,
                fee: 0.1,
                pnl: 50,
                status: OrderStatus.FILLED
            }));
        });

        it('should filter out invalid trades for strategy', async () => {
            const mockTradeRows = [
                {
                    id: 'invalid-trade',
                    strategy_id: 'strategy1',
                    order_id: 'order1',
                    symbol: '',
                    side: 'INVALID' as OrderSide,
                    quantity: 'invalid',
                    price: 'invalid',
                    fee: 'invalid',
                    pnl: 'invalid',
                    executed_at: '2024-01-01T00:00:00Z'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';
            const strategyId = 'strategy1';

            const trades = await adapter.getTradesByStrategy(userId, strategyId);

            expect(trades).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Query failed'));
            const adapter = new TradeRepositoryAdapter();
            const userId = 'test-user-id';
            const strategyId = 'strategy1';

            await expect(adapter.getTradesByStrategy(userId, strategyId)).rejects.toThrow('Failed to get trades by strategy');
        });
    });

    describe('createTrade', () => {
        it('should create a new trade', async () => {
            const tradeData = {
                userId: 'test-user-id',
                strategyId: 'strategy1',
                orderId: 'order1',
                symbol: 'BTC-USD',
                side: OrderSide.BUY,
                quantity: 1.5,
                price: 50000,
                fee: 0.1,
                pnl: 50,
                status: OrderStatus.FILLED
            };
            const mockResult = {
                rows: [{
                    id: 'new-trade-id',
                    executed_at: '2024-01-01T00:00:00Z'
                }]
            };
            (query as jest.Mock).mockResolvedValue(mockResult);
            const adapter = new TradeRepositoryAdapter();

            const trade = await adapter.createTrade(tradeData);

            expect(trade).toEqual(expect.objectContaining({
                id: 'new-trade-id',
                ...tradeData
            }));
            expect(query).toHaveBeenCalled();
        });

        it('should throw error when creation fails', async () => {
            const tradeData = {
                userId: 'test-user-id',
                strategyId: 'strategy1',
                orderId: 'order1',
                symbol: 'BTC-USD',
                side: OrderSide.BUY,
                quantity: 1.5,
                price: 50000,
                fee: 0.1,
                pnl: 50,
                status: OrderStatus.FILLED
            };
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new TradeRepositoryAdapter();

            await expect(adapter.createTrade(tradeData)).rejects.toThrow('Trade creation failed');
        });

        it('should throw error when query fails', async () => {
            const tradeData = {
                userId: 'test-user-id',
                strategyId: 'strategy1',
                orderId: 'order1',
                symbol: 'BTC-USD',
                side: OrderSide.BUY,
                quantity: 1.5,
                price: 50000,
                fee: 0.1,
                pnl: 50,
                status: OrderStatus.FILLED
            };
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));
            const adapter = new TradeRepositoryAdapter();

            await expect(adapter.createTrade(tradeData)).rejects.toThrow('Failed to create trade');
        });
    });

    describe('updateTradeStatus', () => {
        it('should update trade status and log information', async () => {
            const adapter = new TradeRepositoryAdapter();
            const tradeId = 'trade1';
            const status = OrderStatus.CANCELLED;

            await adapter.updateTradeStatus(tradeId, status);

            expect(logger.info).toHaveBeenCalledWith(`Trade status update for trade ${tradeId}: ${status}`);
        });

        it('should throw error when update fails', async () => {
            const errorMessage = 'Update failed';
            const mockLoggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const adapter = new TradeRepositoryAdapter();
            const tradeId = 'trade1';
            const status = OrderStatus.CANCELLED;

            await expect(adapter.updateTradeStatus(tradeId, status)).rejects.toThrow('Failed to update trade status');

            mockLoggerInfo.mockRestore();
        });
    });
});