/** @format */

import request from 'supertest';
import { Express } from 'express';

// Mock dependencies before importing any other modules
jest.mock('../../../src/infrastructure/external/kodiak-integration.service', () => ({
    kodiakIntegrationService: {
        getMarketTicker: jest.fn(),
        getOrderbook: jest.fn(),
        getPositions: jest.fn(),
        getBalance: jest.fn(),
        getTradingViewConfig: jest.fn(),
        getTradingViewSymbols: jest.fn(),
        getTradingViewHistory: jest.fn(),
    },
}));

jest.mock('../../../src/infrastructure/messaging/market-stream.service', () => ({
    marketStreamService: {
        getKlines: jest.fn(),
        getLatestMarkPrice: jest.fn(),
    },
}));

jest.mock('../../../src/infrastructure/cache/redis.service', () => ({
    redisService: {
        get: jest.fn().mockResolvedValue({ success: false }),
        setex: jest.fn().mockResolvedValue({ success: true }),
    },
}));

jest.mock('../../../src/database/pool', () => ({
    query: jest.fn(),
}));

jest.mock('../../../src/interfaces/middleware/auth', () => ({
    authMiddleware: jest.fn().mockImplementation((req: any, res: any, next: any) => {
        req.user = { userId: 'user-123', email: 'test@example.com', userLevel: 'VERIFIED', roles: [] };
        next();
    }),
    AuthenticatedRequest: jest.fn(),
}));

jest.mock('../../../src/infrastructure/security/rate-limiter.service', () => ({
    RateLimiters: {
        market: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
        kodiakApi: jest.fn().mockImplementation((req: any, res: any, next: any) => next()),
    },
}));

jest.mock('../../../src/core/logging/', () => ({
    ContextAwareLogger: jest.fn().mockImplementation(() => ({
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

jest.mock('../../../src/config/cache.config', () => ({
    getCacheConfig: jest.fn().mockReturnValue({
        MARKET_TRADINGVIEW_CONFIG: 3600,
    }),
    getFullCacheConfig: jest.fn().mockReturnValue({
        MARKET_KLINES_SHORT: 300,
    }),
}));

jest.mock('../../../src/shared/utils/context', () => ({
    getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
}));

// Get mock services
const mockKodiakService = require('../../../src/infrastructure/external/kodiak-integration.service').kodiakIntegrationService;
const mockMarketStreamService = require('../../../src/infrastructure/messaging/market-stream.service').marketStreamService;
const mockRedisService = require('../../../src/infrastructure/cache/redis.service').redisService;
const mockQuery = require('../../../src/database/pool').query;

// Create a test app
function createTestApp(): Express {
    const express = require('express');
    const app = express();

    // Add necessary middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Import and register routes
    const { marketRoutes } = require('../../../src/interfaces/http/trading/market');
    app.use('/api/market', marketRoutes);

    return app;
}

describe('Market Controller', () => {
    let app: Express;

    beforeAll(() => {
        // Set necessary environment variables
        process.env.KODIAK_WS_URL = 'wss://test-ws.example.com';
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create fresh app instance
        app = createTestApp();
    });

    describe('GET /api/market/ticker', () => {
        it('should return ticker data for default symbol', async () => {
            const mockTicker = {
                symbol: 'PERP_BTC_USDC',
                mark_price: '45000',
                '24h_close': '44000',
                '24h_volume': '1000000',
                '24h_high': '46000',
                '24h_low': '43000',
                index_price: '44900',
                open_interest: '5000',
                est_funding_rate: '0.001',
            };

            mockKodiakService.getMarketTicker.mockResolvedValue({
                success: true,
                data: mockTicker,
            });

            const response = await request(app)
                .get('/api/market/ticker')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.symbol).toBe('PERP_BTC_USDC');
            expect(parseFloat(response.body.data.price)).toBe(45000);
            expect(parseFloat(response.body.data.change24h)).toBe(1000);
        });

        it('should return ticker data for specific symbol', async () => {
            const symbol = 'PERP_ETH_USDC';
            const mockTicker = {
                symbol,
                mark_price: '2500',
                '24h_close': '2400',
                '24h_volume': '500000',
                '24h_high': '2600',
                '24h_low': '2300',
            };

            mockKodiakService.getMarketTicker.mockResolvedValue({
                success: true,
                data: mockTicker,
            });

            const response = await request(app)
                .get(`/api/market/ticker?symbol=${symbol}`)
                .expect(200);

            expect(response.body.data.symbol).toBe(symbol);
            expect(mockKodiakService.getMarketTicker).toHaveBeenCalledWith(symbol);
        });

        it('should handle ticker API failure', async () => {
            mockKodiakService.getMarketTicker.mockResolvedValue({
                success: false,
                error: 'API error',
            });

            const response = await request(app)
                .get('/api/market/ticker')
                .expect(503);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Market data temporarily unavailable');
        });

        it('should handle internal server errors', async () => {
            mockKodiakService.getMarketTicker.mockRejectedValue(new Error('Network error'));

            const response = await request(app)
                .get('/api/market/ticker')
                .expect(503);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/market/tickers', () => {
        it('should return all tickers', async () => {
            const mockTickers = [
                { symbol: 'PERP_BTC_USDC', mark_price: '45000' },
                { symbol: 'PERP_ETH_USDC', mark_price: '2500' },
            ];

            mockKodiakService.getMarketTicker.mockResolvedValue({
                success: true,
                data: mockTickers,
            });

            const response = await request(app)
                .get('/api/market/tickers')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.length).toBe(2);
        });

        it('should handle tickers API failure', async () => {
            mockKodiakService.getMarketTicker.mockResolvedValue({
                success: false,
                error: 'API error',
            });

            const response = await request(app)
                .get('/api/market/tickers')
                .expect(502);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/market/klines', () => {
        it('should return kline data from WebSocket cache', async () => {
            const mockKlines = [
                { startTime: Date.now() - 3600000, open: 45000, high: 46000, low: 44000, close: 45500, volume: 100 },
            ];

            mockMarketStreamService.getKlines.mockResolvedValue(mockKlines);

            const response = await request(app)
                .get('/api/market/klines')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.length).toBe(1);
            expect(response.body.source).toBe('websocket_cache');
        });

        it('should return empty data when no klines available', async () => {
            mockMarketStreamService.getKlines.mockResolvedValue([]);

            const response = await request(app)
                .get('/api/market/klines')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual([]);
            expect(response.body.message).toContain('Kline data not available yet');
        });

        it('should handle kline API failure', async () => {
            mockMarketStreamService.getKlines.mockRejectedValue(new Error('Service error'));

            const response = await request(app)
                .get('/api/market/klines')
                .expect(502);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/market/orderbook', () => {
        it('should return orderbook data', async () => {
            const mockOrderbook = {
                bids: [[45000, 1], [44999, 2]],
                asks: [[45001, 1], [45002, 2]],
            };

            mockKodiakService.getOrderbook.mockResolvedValue({
                success: true,
                data: mockOrderbook,
            });

            const response = await request(app)
                .get('/api/market/orderbook')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(mockOrderbook);
        });

        it('should handle orderbook API failure', async () => {
            mockKodiakService.getOrderbook.mockResolvedValue({
                success: false,
                error: 'API error',
            });

            const response = await request(app)
                .get('/api/market/orderbook')
                .expect(400);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/market/futures/:symbol', () => {
        it('should return futures data from cache if available', async () => {
            const symbol = 'PERP_BTC_USDC';
            const cacheData = {
                success: true,
                data: { symbol, mark_price: '45000' },
                timestamp: Date.now(),
            };

            mockRedisService.get.mockResolvedValue({
                success: true,
                data: JSON.stringify(cacheData),
            });

            const response = await request(app)
                .get(`/api/market/futures/${symbol}`)
                .expect(200);

            expect(response.body).toEqual(cacheData);
            expect(mockKodiakService.getMarketTicker).not.toHaveBeenCalled();
        });

        it('should fetch and cache futures data', async () => {
            const symbol = 'PERP_BTC_USDC';
            const mockData = { symbol, mark_price: '45000' };

            mockRedisService.get.mockResolvedValue({ success: false });
            mockKodiakService.getMarketTicker.mockResolvedValue({
                success: true,
                data: mockData,
            });

            const response = await request(app)
                .get(`/api/market/futures/${symbol}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(mockData);
            expect(mockRedisService.setex).toHaveBeenCalled();
        });

        it('should handle futures API failure', async () => {
            const symbol = 'PERP_BTC_USDC';

            mockRedisService.get.mockResolvedValue({ success: false });
            mockKodiakService.getMarketTicker.mockResolvedValue({
                success: false,
                error: 'API error',
            });

            const response = await request(app)
                .get(`/api/market/futures/${symbol}`)
                .expect(503);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/market/markprice/:symbol', () => {
        it('should return mark price from cache', async () => {
            const symbol = 'PERP_BTC_USDC';
            const mockPrice = { price: 45000, timestamp: Date.now() };

            mockMarketStreamService.getLatestMarkPrice.mockResolvedValue(mockPrice);

            const response = await request(app)
                .get(`/api/market/markprice/${symbol}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(mockPrice);
        });

        it('should handle no mark price available', async () => {
            const symbol = 'PERP_BTC_USDC';

            mockMarketStreamService.getLatestMarkPrice.mockResolvedValue(null);

            const response = await request(app)
                .get(`/api/market/markprice/${symbol}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toBeNull();
            expect(response.body.message).toContain('Mark price data not available yet');
        });
    });

    describe('GET /api/market/positions (protected)', () => {
        it('should return user positions', async () => {
            const mockPositions = [
                { symbol: 'PERP_BTC_USDC', size: 1, entryPrice: 45000 },
            ];

            mockKodiakService.getPositions.mockResolvedValue({
                success: true,
                data: mockPositions,
            });

            const response = await request(app)
                .get('/api/market/positions')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(mockPositions);
            expect(mockKodiakService.getPositions).toHaveBeenCalledWith('user-123');
        });

        it('should handle positions API failure', async () => {
            mockKodiakService.getPositions.mockResolvedValue({
                success: false,
                error: 'API error',
            });

            const response = await request(app)
                .get('/api/market/positions')
                .expect(400);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/market/balance (protected)', () => {
        it('should return user balance', async () => {
            const mockBalance = { available: 1000, total: 1500 };

            mockKodiakService.getBalance.mockResolvedValue({
                success: true,
                data: mockBalance,
            });

            const response = await request(app)
                .get('/api/market/balance')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(mockBalance);
            expect(mockKodiakService.getBalance).toHaveBeenCalledWith('user-123');
        });

        it('should handle balance API failure', async () => {
            mockKodiakService.getBalance.mockResolvedValue({
                success: false,
                error: 'API error',
            });

            const response = await request(app)
                .get('/api/market/balance')
                .expect(400);

            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/market/ws-url (protected)', () => {
        it('should return WebSocket URL for authenticated user', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ account_id: 'test-account-id' }],
            });

            const response = await request(app)
                .get('/api/market/ws-url')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.publicWsUrl).toContain('test-account-id');
        });

        it('should reject request without Kodiak credentials', async () => {
            mockQuery.mockResolvedValue({
                rows: [],
            });

            const response = await request(app)
                .get('/api/market/ws-url')
                .expect(403);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Kodiak credentials required');
        });
    });

    describe('TradingView endpoints', () => {
        describe('GET /api/market/tv/config', () => {
            it('should return TV config', async () => {
                const mockConfig = { symbols: ['PERP_BTC_USDC'] };

                mockKodiakService.getTradingViewConfig.mockResolvedValue({
                    success: true,
                    data: mockConfig,
                });

                const response = await request(app)
                    .get('/api/market/tv/config')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(mockConfig);
            });
        });

        describe('GET /api/market/tv/symbols', () => {
            it('should return TV symbols', async () => {
                const mockSymbols = ['PERP_BTC_USDC', 'PERP_ETH_USDC'];

                mockKodiakService.getTradingViewSymbols.mockResolvedValue({
                    success: true,
                    data: mockSymbols,
                });

                const response = await request(app)
                    .get('/api/market/tv/symbols')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(mockSymbols);
            });
        });

        describe('GET /api/market/tv/history', () => {
            it('should return TV history data', async () => {
                const mockHistory = {
                    t: [1640995200],
                    o: ['45000'],
                    h: ['46000'],
                    l: ['44000'],
                    c: ['45500'],
                    v: ['100'],
                };

                mockKodiakService.getTradingViewHistory.mockResolvedValue({
                    success: true,
                    data: mockHistory,
                });

                const response = await request(app)
                    .get('/api/market/tv/history')
                    .query({ symbol: 'PERP_BTC_USDC', resolution: '1', from: '1640995200', to: '1641081600' })
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(mockHistory);
            });
        });
    });

    describe('GET /api/market/kline-history (protected)', () => {
        it('should return historical kline data', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ id: '1' }],
            });

            const mockHistory = {
                t: [1640995200],
                o: ['45000'],
                h: ['46000'],
                l: ['44000'],
                c: ['45500'],
                v: ['100'],
            };

            mockKodiakService.getTradingViewHistory.mockResolvedValue({
                success: true,
                data: mockHistory,
            });

            const response = await request(app)
                .get('/api/market/kline-history')
                .query({ symbol: 'PERP_BTC_USDC', resolution: '60', from: '1640995200', to: '1641081600' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].startTime).toBe(1640995200000);
        });

        it('should reject request without Kodiak credentials', async () => {
            mockQuery.mockResolvedValue({
                rows: [],
            });

            const response = await request(app)
                .get('/api/market/kline-history')
                .query({ symbol: 'PERP_BTC_USDC', resolution: '60' })
                .expect(403);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Kodiak credentials required');
        });

        it('should handle no data available', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ id: '1' }],
            });

            mockKodiakService.getTradingViewHistory.mockResolvedValue({
                success: true,
                data: { s: 'no_data' },
            });

            const response = await request(app)
                .get('/api/market/kline-history')
                .query({ symbol: 'PERP_BTC_USDC', resolution: '60' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual([]);
        });
    });
});