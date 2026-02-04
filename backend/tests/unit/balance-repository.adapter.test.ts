/** @format */

import { BalanceRepositoryAdapter, balanceRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/balance-repository.adapter';
import { Balance } from '@trade-bot/shared';
import { logger } from '../../src/core/logging';
import { query } from '../../src/database/pool';

// Mock dependencies
jest.mock('../../src/core/logging', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../../src/database/pool', () => ({
    query: jest.fn()
}));

describe('BalanceRepositoryAdapter', () => {
    describe('Initialization', () => {
        it('should create a BalanceRepositoryAdapter instance', () => {
            const adapter = new BalanceRepositoryAdapter();
            expect(adapter).toBeInstanceOf(BalanceRepositoryAdapter);
        });

        it('should export a singleton instance', () => {
            expect(balanceRepositoryAdapter).toBeInstanceOf(BalanceRepositoryAdapter);
        });

        it('should accept custom query function in constructor', () => {
            const mockQuery = jest.fn();
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            expect(adapter).toBeInstanceOf(BalanceRepositoryAdapter);
        });
    });

    describe('getBalance', () => {
        it('should return a zero balance when no record found', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';

            const balance = await adapter.getBalance(userId);

            expect(balance).toBeInstanceOf(Balance);
            expect(balance.total).toBe(0);
            expect(balance.currency).toBe('USD');
        });

        it('should return balance from database when record exists', async () => {
            const mockQuery = jest.fn().mockResolvedValue({
                rows: [{
                    total: '100.00',
                    available: '50.00',
                    locked: '50.00',
                    currency: 'USD',
                    last_updated: '2026-02-04T11:00:00Z'
                }]
            });
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';

            const balance = await adapter.getBalance(userId);

            expect(balance).toBeInstanceOf(Balance);
            expect(balance.total).toBe(100);
            expect(balance.available).toBe(50);
            expect(balance.locked).toBe(50);
            expect(balance.currency).toBe('USD');
            expect(balance.lastUpdated).toEqual(new Date('2026-02-04T11:00:00Z'));
        });

        it('should throw error when query fails', async () => {
            const mockQuery = jest.fn().mockRejectedValue(new Error('Database connection error'));
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';

            await expect(adapter.getBalance(userId)).rejects.toThrow('Failed to get balance');
        });
    });

    describe('updateBalance', () => {
        it('should update user balance and log information', async () => {
            const mockQuery = jest.fn().mockResolvedValue({});
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';
            const balance = Balance.zero('USD');

            await adapter.updateBalance(userId, balance);

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining(`Balance update for user ${userId}`)
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining(`${balance.total} ${balance.currency}`)
            );
        });

        it('should throw error when update query fails', async () => {
            const mockQuery = jest.fn().mockRejectedValue(new Error('Update failed'));
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';
            const balance = Balance.zero('USD');

            await expect(adapter.updateBalance(userId, balance)).rejects.toThrow('Failed to update balance');
        });
    });

    describe('getBalanceHistory', () => {
        it('should return empty balance history when no records found', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';

            const history = await adapter.getBalanceHistory(userId);

            expect(history).toEqual([]);
        });

        it('should return empty balance history with custom limit', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';
            const limit = 100;

            const history = await adapter.getBalanceHistory(userId, limit);

            expect(history).toEqual([]);
        });

        it('should return balance history from database', async () => {
            const mockQuery = jest.fn().mockResolvedValue({
                rows: [{
                    id: '1',
                    user_id: 'test-user-id',
                    total: '100.00',
                    available: '50.00',
                    locked: '50.00',
                    currency: 'USD',
                    last_updated: '2026-02-04T11:00:00Z',
                    change_reason: 'DEPOSIT',
                    change_amount: '100.00',
                    created_at: '2026-02-04T11:00:00Z'
                }]
            });
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';

            const history = await adapter.getBalanceHistory(userId);

            expect(history).toHaveLength(1);
            expect(history[0].id).toBe('1');
            expect(history[0].userId).toBe('test-user-id');
            expect(history[0].balance).toBeInstanceOf(Balance);
            expect(history[0].balance.total).toBe(100);
            expect(history[0].changeReason).toBe('DEPOSIT');
            expect(history[0].changeAmount).toBe(100);
            expect(history[0].timestamp).toEqual(new Date('2026-02-04T11:00:00Z'));
        });

        it('should throw error when history query fails', async () => {
            const mockQuery = jest.fn().mockRejectedValue(new Error('History query failed'));
            const adapter = new BalanceRepositoryAdapter(mockQuery);
            const userId = 'test-user-id';

            await expect(adapter.getBalanceHistory(userId)).rejects.toThrow('Failed to get balance history');
        });
    });
});
