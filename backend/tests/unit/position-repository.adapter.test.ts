/** @format */

import { PositionRepositoryAdapter, positionRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/position-repository.adapter';
import { Position } from '@trade-bot/shared';
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

describe('PositionRepositoryAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should create a PositionRepositoryAdapter instance', () => {
            const adapter = new PositionRepositoryAdapter();
            expect(adapter).toBeInstanceOf(PositionRepositoryAdapter);
        });

        it('should export a singleton instance', () => {
            expect(positionRepositoryAdapter).toBeInstanceOf(PositionRepositoryAdapter);
        });
    });

    describe('getPositions', () => {
        it('should return empty array when no positions found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';

            const positions = await adapter.getPositions(userId);

            expect(positions).toEqual([]);
            expect(query).toHaveBeenCalled();
        });

        it('should return positions for user with valid data', async () => {
            const mockPositionRows = [
                {
                    symbol: 'BTC-USD',
                    quantity: '1.5',
                    entryPrice: '50000.00',
                    markPrice: '51000.00',
                    leverage: '10',
                    imr: '0.02',
                    liquidationPrice: '45000.00'
                },
                {
                    symbol: 'ETH-USD',
                    quantity: '-2.0',
                    entryPrice: '3000.00',
                    markPrice: '2900.00',
                    leverage: '20',
                    imr: '0.01',
                    liquidationPrice: '3150.00'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockPositionRows });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';

            const positions = await adapter.getPositions(userId);

            expect(positions).toHaveLength(2);
            expect(positions[0]).toBeInstanceOf(Position);
            expect(positions[0].symbol).toBe('BTC-USD');
            expect(positions[0].side).toBe('LONG');
            expect(positions[0].quantity).toBe(1.5);
            expect(positions[0].entryPrice).toBe(50000);
            expect(positions[1]).toBeInstanceOf(Position);
            expect(positions[1].symbol).toBe('ETH-USD');
            expect(positions[1].side).toBe('SHORT');
            expect(positions[1].quantity).toBe(2.0);
            expect(positions[1].entryPrice).toBe(3000);
        });

        it('should filter out invalid positions', async () => {
            const mockPositionRows = [
                {
                    symbol: '',
                    quantity: '0',
                    entryPrice: '0',
                    markPrice: '0',
                    leverage: '1',
                    imr: '0.02'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockPositionRows });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';

            const positions = await adapter.getPositions(userId);

            expect(positions).toEqual([]);
            // We don't expect a warn log here because the invalid position is handled gracefully without exception
        });

        it('should log warning when mapping position fails', async () => {
            const mockPositionRows = [
                {
                    symbol: 'BTC-USD',
                    quantity: 'invalid',
                    entryPrice: '50000.00',
                    markPrice: '51000.00',
                    leverage: '10',
                    imr: '0.02',
                    liquidationPrice: '45000.00'
                }
            ];
            (query as jest.Mock).mockResolvedValue({ rows: mockPositionRows });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';

            const positions = await adapter.getPositions(userId);

            expect(positions).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Database connection error'));
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';

            await expect(adapter.getPositions(userId)).rejects.toThrow('Failed to get positions');
        });
    });

    describe('getPosition', () => {
        it('should return null when position not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const symbol = 'BTC-USD';

            const position = await adapter.getPosition(userId, symbol);

            expect(position).toBeNull();
            expect(query).toHaveBeenCalled();
        });

        it('should return position when found', async () => {
            const mockPositionRow = {
                symbol: 'BTC-USD',
                quantity: '1.5',
                entryPrice: '50000.00',
                markPrice: '51000.00',
                leverage: '10',
                imr: '0.02',
                liquidationPrice: '45000.00'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockPositionRow] });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const symbol = 'BTC-USD';

            const position = await adapter.getPosition(userId, symbol);

            expect(position).toBeInstanceOf(Position);
            expect(position!.symbol).toBe('BTC-USD');
            expect(position!.side).toBe('LONG');
            expect(position!.quantity).toBe(1.5);
        });

        it('should return null for invalid position', async () => {
            const mockPositionRow = {
                symbol: '',
                quantity: '0',
                entryPrice: '0',
                markPrice: '0',
                leverage: '1',
                imr: '0.02'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockPositionRow] });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const symbol = 'BTC-USD';

            const position = await adapter.getPosition(userId, symbol);

            expect(position).toBeNull();
            // We don't expect a warn log here because the invalid position is handled gracefully without exception
        });

        it('should log warning when mapping position fails', async () => {
            const mockPositionRow = {
                symbol: 'BTC-USD',
                quantity: 'invalid',
                entryPrice: '50000.00',
                markPrice: '51000.00',
                leverage: '10',
                imr: '0.02',
                liquidationPrice: '45000.00'
            };
            (query as jest.Mock).mockResolvedValue({ rows: [mockPositionRow] });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const symbol = 'BTC-USD';

            const position = await adapter.getPosition(userId, symbol);

            expect(position).toBeNull();
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should throw error when query fails', async () => {
            (query as jest.Mock).mockRejectedValue(new Error('Query failed'));
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const symbol = 'BTC-USD';

            await expect(adapter.getPosition(userId, symbol)).rejects.toThrow('Failed to get position');
        });
    });

    describe('updatePosition', () => {
        it('should update position and log information', async () => {
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const position = new Position(
                'BTC-USD',
                'LONG',
                1.5,
                50000,
                51000,
                10,
                0.02,
                45000
            );

            await adapter.updatePosition(userId, position);

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining(`Position update for user ${userId}`)
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining(`symbol ${position.symbol}`)
            );
        });

        it('should throw error when update fails', async () => {
            const errorMessage = 'Update failed';
            const mockLoggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const position = new Position(
                'BTC-USD',
                'LONG',
                1.5,
                50000,
                51000,
                10,
                0.02,
                45000
            );

            await expect(adapter.updatePosition(userId, position)).rejects.toThrow('Failed to update position');

            mockLoggerInfo.mockRestore();
        });
    });

    describe('closePosition', () => {
        it('should close position and log information', async () => {
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const symbol = 'BTC-USD';

            await adapter.closePosition(userId, symbol);

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining(`Position close for user ${userId}`)
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining(`symbol ${symbol}`)
            );
        });

        it('should throw error when close fails', async () => {
            const errorMessage = 'Close failed';
            const mockLoggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const adapter = new PositionRepositoryAdapter();
            const userId = 'test-user-id';
            const symbol = 'BTC-USD';

            await expect(adapter.closePosition(userId, symbol)).rejects.toThrow('Failed to close position');

            mockLoggerInfo.mockRestore();
        });
    });
});