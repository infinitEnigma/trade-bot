/** @format */

import {
    mapKodiakBalanceToDomain,
    mapKodiakPositionToDomain,
    mapKodiakTradeToDomain,
    mapKodiakAccountInfoToDomain
} from '../../src/infrastructure/adapters/external/kodiak.mappers';
import { logger } from '../../src/core/logging';

// Mock dependencies
jest.mock('../../src/core/logging', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

describe('Kodiak Mappers', () => {
    describe('mapKodiakBalanceToDomain', () => {
        it('should map Kodiak account info to domain Balance with USD currency', () => {
            const mockKodiakBalance = {
                totalBalance: '1000',
                totalPnl24H: '50',
                totalPnl30D: '150',
                totalPnlAll: '200',
                tradingVolume24H: '10000',
                accountType: 'SPOT',
                balances: [
                    { asset: 'USDC', free: '1000', locked: '0' },
                    { asset: 'BTC', free: '0.01', locked: '0' }
                ]
            };

            const result = mapKodiakBalanceToDomain(mockKodiakBalance as any);

            expect(result).toEqual(expect.objectContaining({
                total: 1000,
                available: 1000,
                currency: 'USD'
            }));
        });

        it('should handle missing USD balance data', () => {
            const mockKodiakBalance = {
                totalBalance: '1000',
                totalPnl24H: '50',
                totalPnl30D: '150',
                totalPnlAll: '200',
                tradingVolume24H: '10000',
                accountType: 'SPOT',
                balances: [
                    { asset: 'BTC', free: '0.01', locked: '0' },
                    { asset: 'ETH', free: '0.1', locked: '0' }
                ]
            };

            const result = mapKodiakBalanceToDomain(mockKodiakBalance as any);

            expect(result).toEqual(expect.objectContaining({
                total: 0,
                available: 0,
                currency: 'USD'
            }));
        });

        it('should handle missing balances array', () => {
            const mockKodiakBalance = {
                totalBalance: '1000',
                totalPnl24H: '50'
            };

            const result = mapKodiakBalanceToDomain(mockKodiakBalance as any);

            expect(result).toEqual(expect.objectContaining({
                total: 0,
                available: 0,
                currency: 'USD'
            }));
        });

        it('should handle invalid balance data', () => {
            const mockKodiakBalance = {
                totalBalance: 'invalid',
                totalPnl24H: '50',
                balances: [
                    { asset: 'USDC', free: 'invalid', locked: '0' }
                ]
            };

            const result = mapKodiakBalanceToDomain(mockKodiakBalance as any);

            expect(result).toEqual(expect.objectContaining({
                total: 0,
                available: 0,
                currency: 'USD'
            }));
        });

        it('should handle exception when mapping balance', () => {
            const mockKodiakBalance = null;

            const result = mapKodiakBalanceToDomain(mockKodiakBalance as any);

            expect(result).toEqual(expect.objectContaining({
                total: 0,
                available: 0,
                currency: 'USD'
            }));
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('mapKodiakPositionToDomain', () => {
        it('should map Kodiak position to domain Position (LONG)', () => {
            const mockKodiakPosition = {
                symbol: 'BTC-USDC',
                positionAmt: '1.0',
                entryPrice: '50000',
                markPrice: '51000'
            };

            const result = mapKodiakPositionToDomain(mockKodiakPosition as any);

            expect(result).toEqual(expect.objectContaining({
                symbol: 'BTC-USDC',
                side: 'LONG',
                quantity: 1.0,
                entryPrice: 50000,
                markPrice: 51000,
                leverage: 1
            }));
        });

        it('should map Kodiak position to domain Position (SHORT)', () => {
            const mockKodiakPosition = {
                symbol: 'ETH-USDC',
                positionAmt: '-0.5',
                entryPrice: '3000',
                markPrice: '2900'
            };

            const result = mapKodiakPositionToDomain(mockKodiakPosition as any);

            expect(result).toEqual(expect.objectContaining({
                symbol: 'ETH-USDC',
                side: 'SHORT',
                quantity: 0.5,
                entryPrice: 3000,
                markPrice: 2900,
                leverage: 1
            }));
        });

        it('should return null for invalid position data', () => {
            const mockKodiakPosition = {
                symbol: '',
                positionAmt: '0',
                entryPrice: '0',
                markPrice: '0'
            };

            const result = mapKodiakPositionToDomain(mockKodiakPosition as any);

            expect(result).toBeNull();
        });

        it('should handle missing required fields', () => {
            const mockKodiakPosition = {
                positionAmt: '1.0',
                entryPrice: '50000',
                markPrice: '51000'
            };

            const result = mapKodiakPositionToDomain(mockKodiakPosition as any);

            expect(result).toBeNull();
        });

        it('should handle exception when mapping position', () => {
            const mockKodiakPosition = null;

            const result = mapKodiakPositionToDomain(mockKodiakPosition as any);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('mapKodiakTradeToDomain', () => {
        it('should map Kodiak trade to domain Trade', () => {
            const mockKodiakTrade = {
                id: '123',
                orderId: 'order-123',
                symbol: 'BTC-USDC',
                side: 'BUY',
                price: '50000',
                qty: '0.1',
                commission: '0.01',
                time: Date.now()
            };

            const result = mapKodiakTradeToDomain(mockKodiakTrade as any);

            expect(result).toEqual(expect.objectContaining({
                id: '123',
                orderId: 'order-123',
                symbol: 'BTC-USDC',
                side: 'BUY',
                quantity: 0.1,
                price: 50000,
                fee: 0.01
            }));
            expect(result?.executedAt).toEqual(expect.any(Date));
        });

        it('should handle missing id field', () => {
            const mockKodiakTrade = {
                orderId: 'order-123',
                symbol: 'BTC-USDC',
                side: 'BUY',
                price: '50000',
                qty: '0.1',
                commission: '0.01',
                time: Date.now()
            };

            const result = mapKodiakTradeToDomain(mockKodiakTrade as any);

            expect(result).toEqual(expect.objectContaining({
                id: 'order-123',
                orderId: 'order-123'
            }));
        });

        it('should return null for invalid trade data', () => {
            const mockKodiakTrade = {
                id: '',
                orderId: '',
                symbol: '',
                side: 'BUY',
                price: '0',
                qty: '0',
                commission: '0',
                time: Date.now()
            };

            const result = mapKodiakTradeToDomain(mockKodiakTrade as any);

            expect(result).toBeNull();
        });

        it('should handle exception when mapping trade', () => {
            const mockKodiakTrade = null;

            const result = mapKodiakTradeToDomain(mockKodiakTrade as any);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('mapKodiakAccountInfoToDomain', () => {
        it('should map Kodiak account info to domain AccountInfo', () => {
            const mockKodiakAccountInfo = {
                totalBalance: '1000',
                totalPnl24H: '50',
                totalPnl30D: '150',
                totalPnlAll: '200',
                accountType: 'SPOT',
                balances: []
            };

            const result = mapKodiakAccountInfoToDomain(mockKodiakAccountInfo as any);

            expect(result).toEqual(expect.objectContaining({
                totalBalance: '1000',
                totalPnl24H: '50',
                totalPnl30D: '150',
                totalPnlAll: '200',
                accountType: 'SPOT',
                balances: []
            }));
        });

        it('should handle missing optional fields', () => {
            const mockKodiakAccountInfo = {};

            const result = mapKodiakAccountInfoToDomain(mockKodiakAccountInfo as any);

            expect(result).toEqual(expect.objectContaining({
                totalBalance: '0',
                totalPnl24H: '0',
                totalPnl30D: '0',
                totalPnlAll: '0',
                accountType: 'UNKNOWN',
                balances: []
            }));
        });

        it('should handle exception when mapping account info', () => {
            const mockKodiakAccountInfo = null;

            const result = mapKodiakAccountInfoToDomain(mockKodiakAccountInfo as any);

            expect(result).toEqual(expect.objectContaining({
                totalBalance: '0',
                totalPnl24H: '0',
                totalPnl30D: '0',
                totalPnlAll: '0',
                accountType: 'UNKNOWN',
                balances: []
            }));
            expect(logger.warn).toHaveBeenCalled();
        });
    });
});