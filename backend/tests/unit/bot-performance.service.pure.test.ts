import { BotPerformanceService, createBotPerformanceService, IBotPerformanceRepository, BotTrade, LegacyBotPerformance } from '../../src/core/strategies/bot-performance.service.pure';
import { ILogger, ICacheService, CacheResult, OrderSide } from '@trade-bot/shared';

describe('BotPerformanceService', () => {
    let mockLogger: Partial<ILogger>;
    let mockCache: Partial<ICacheService>;
    let mockRepository: Partial<IBotPerformanceRepository>;
    let service: BotPerformanceService;

    const mockBotId = 'test-bot-id';
    const mockUserId = 'test-user-id';

    const mockTrades: BotTrade[] = [
        {
            id: 'trade-1',
            userId: mockUserId,
            orderId: 'order-1',
            botId: mockBotId,
            symbol: 'BTC/USDT',
            side: OrderSide.BUY,
            quantity: 0.1,
            price: 50000,
            pnl: 100,
            fee: 5,
            status: 'FILLED' as any,
            executedAt: new Date(),
            timestamp: Date.now() - 3600000, // 1 hour ago
        },
        {
            id: 'trade-2',
            userId: mockUserId,
            orderId: 'order-2',
            botId: mockBotId,
            symbol: 'ETH/USDT',
            side: OrderSide.SELL,
            quantity: 1,
            price: 3000,
            pnl: -50,
            fee: 3,
            status: 'FILLED' as any,
            executedAt: new Date(),
            timestamp: Date.now() - 1800000, // 30 minutes ago
        },
        {
            id: 'trade-3',
            userId: mockUserId,
            orderId: 'order-3',
            botId: mockBotId,
            symbol: 'BTC/USDT',
            side: OrderSide.SELL,
            quantity: 0.05,
            price: 51000,
            pnl: 25,
            fee: 2.5,
            status: 'FILLED' as any,
            executedAt: new Date(),
            timestamp: Date.now() - 900000, // 15 minutes ago
        },
    ];

    beforeEach(() => {
        // Create mock dependencies
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        mockCache = {
            get: jest.fn(),
            setex: jest.fn(),
            delete: jest.fn(),
        };

        mockRepository = {
            recordTrade: jest.fn(),
            getTrades: jest.fn(),
            getAllTrades: jest.fn(),
            getBotStats: jest.fn(),
        };

        // Create service instance
        service = createBotPerformanceService({
            botPerformanceRepository: mockRepository as IBotPerformanceRepository,
            cache: mockCache as ICacheService,
            logger: mockLogger as ILogger,
        });
    });

    describe('createBotPerformanceService', () => {
        it('should create an instance of BotPerformanceService', () => {
            expect(service).toBeInstanceOf(BotPerformanceService);
        });
    });

    describe('recordTrade', () => {
        it('should record a trade successfully', async () => {
            (mockRepository.recordTrade as jest.Mock).mockResolvedValue(true);
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            await service.recordTrade(mockTrades[0]);

            expect(mockRepository.recordTrade).toHaveBeenCalledWith(mockTrades[0]);
            expect(mockLogger.debug).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should throw an error when recording fails', async () => {
            (mockRepository.recordTrade as jest.Mock).mockResolvedValue(false);

            await expect(service.recordTrade(mockTrades[0])).rejects.toThrow();
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should validate trade data and throw errors for invalid inputs', async () => {
            const invalidTrade = { ...mockTrades[0], botId: '' };
            await expect(service.recordTrade(invalidTrade)).rejects.toThrow('Bot ID and symbol are required');

            const invalidQuantityTrade = { ...mockTrades[0], quantity: 0 };
            await expect(service.recordTrade(invalidQuantityTrade)).rejects.toThrow('Quantity and price must be positive');

            const invalidSideTrade = { ...mockTrades[0], side: 'INVALID' as any };
            await expect(service.recordTrade(invalidSideTrade)).rejects.toThrow('Side must be BUY or SELL');

            const invalidTimestampTrade = { ...mockTrades[0], timestamp: 0 };
            await expect(service.recordTrade(invalidTimestampTrade)).rejects.toThrow('Valid timestamp is required');
        });
    });

    describe('getBotPerformance', () => {
        it('should return cached performance when available', async () => {
            const mockPerformance: LegacyBotPerformance = {
                totalTrades: 3,
                totalVolume: 10000,
                totalPnl: 75,
                winRate: 66.67,
                averageTrade: 25,
                sharpeRatio: 1.2,
                maxDrawdown: 50,
            };

            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: mockPerformance,
            });

            const result = await service.getBotPerformance(mockBotId, '24h');

            expect(mockCache.get).toHaveBeenCalled();
            expect(mockRepository.getTrades).not.toHaveBeenCalled();
            expect(result).toEqual(mockPerformance);
        });

        it('should calculate performance from trades when cache is missing', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockRepository.getTrades as jest.Mock).mockResolvedValue(mockTrades);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getBotPerformance(mockBotId, '24h');

            expect(mockCache.get).toHaveBeenCalled();
            expect(mockRepository.getTrades).toHaveBeenCalled();
            expect(mockCache.setex).toHaveBeenCalled();
            expect(result).not.toBeNull();
            expect(result?.totalTrades).toBe(mockTrades.length);
        });

        it('should return null when there are no trades', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockRepository.getTrades as jest.Mock).mockResolvedValue([]);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getBotPerformance(mockBotId, '24h');

            expect(result).toBeNull();
        });
    });

    describe('getPerformanceSummary', () => {
        it('should return summary for user with multiple bots', async () => {
            const multiBotTrades: BotTrade[] = [
                ...mockTrades,
                {
                    ...mockTrades[0],
                    botId: 'another-bot-id',
                    pnl: 200,
                },
            ];

            (mockRepository.getAllTrades as jest.Mock).mockResolvedValue(multiBotTrades);

            const summary = await service.getPerformanceSummary(mockUserId);

            expect(summary.totalBots).toBe(2);
            expect(summary.activeBots).toBe(2);
            expect(summary.totalPnl).toBeGreaterThan(0);
            expect(summary.totalVolume).toBeGreaterThan(0);
            expect(summary.bestPerformingBot).toBe('another-bot-id');
            expect(summary.worstPerformingBot).toBe(mockBotId);
        });

        it('should return empty summary when there are no trades', async () => {
            (mockRepository.getAllTrades as jest.Mock).mockResolvedValue([]);

            const summary = await service.getPerformanceSummary(mockUserId);

            expect(summary.totalBots).toBe(0);
            expect(summary.activeBots).toBe(0);
            expect(summary.totalPnl).toBe(0);
            expect(summary.totalVolume).toBe(0);
            expect(summary.bestPerformingBot).toBe('');
            expect(summary.worstPerformingBot).toBe('');
        });
    });

    describe('calculateRiskMetrics', () => {
        it('should calculate risk metrics for bot with sufficient trades', async () => {
            const manyTrades = Array.from({ length: 20 }, (_, i) => ({
                ...mockTrades[0],
                timestamp: Date.now() - i * 86400000, // Last 20 days
                pnl: Math.random() * 200 - 100, // Random PnL between -100 and 100
            }));

            (mockRepository.getTrades as jest.Mock).mockResolvedValue(manyTrades);

            const riskMetrics = await service.calculateRiskMetrics(mockBotId);

            expect(riskMetrics.volatility).toBeGreaterThanOrEqual(0);
            expect(riskMetrics.maxDrawdown).toBeGreaterThanOrEqual(0);
            expect(riskMetrics.valueAtRisk).toBeGreaterThanOrEqual(0);
            expect(riskMetrics.expectedShortfall).toBeGreaterThanOrEqual(0);
        });

        it('should return default metrics when there are insufficient trades', async () => {
            const fewTrades = mockTrades.slice(0, 5);
            (mockRepository.getTrades as jest.Mock).mockResolvedValue(fewTrades);

            const riskMetrics = await service.calculateRiskMetrics(mockBotId);

            expect(riskMetrics.volatility).toBe(0);
            expect(riskMetrics.maxDrawdown).toBe(0);
            expect(riskMetrics.valueAtRisk).toBe(0);
            expect(riskMetrics.expectedShortfall).toBe(0);
        });
    });
});