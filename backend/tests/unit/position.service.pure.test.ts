import { PositionService, createPositionService, PositionServiceDependencies, PositionValidationResult, AccountLimits, RiskAssessment } from '../../src/core/strategies/position.service.pure';
import { IPositionRepository, ICacheService, IExternalApiService, ILogger, Position, Balance } from '@trade-bot/shared';

describe('PositionService', () => {
    let mockLogger: Partial<ILogger>;
    let mockCache: Partial<ICacheService>;
    let mockPositionRepository: Partial<IPositionRepository>;
    let mockExternalApi: Partial<IExternalApiService>;
    let service: PositionService;

    const mockUserId = 'test-user-id';
    const mockSymbol = 'BTC/USDT';

    const mockPositions: Position[] = [
        new Position('BTC/USDT', 'LONG', 0.1, 50000, 51000, 10, 0.01, 45000),
        new Position('ETH/USDT', 'SHORT', 1, 3000, 2900, 5, 0.02, 3200),
    ];

    const mockBalance: Balance = new Balance(10000, 5000, 5000, 'USD', new Date());

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
            setex: jest.fn().mockResolvedValue({ success: true }),
            delete: jest.fn(),
        };

        mockPositionRepository = {
            getPosition: jest.fn(),
            getPositions: jest.fn(),
        };

        mockExternalApi = {
            getPositions: jest.fn(),
        };

        // Create service instance
        service = createPositionService({
            positionRepository: mockPositionRepository as IPositionRepository,
            cache: mockCache as ICacheService,
            externalApi: mockExternalApi as IExternalApiService,
            logger: mockLogger as ILogger,
        });
    });

    describe('createPositionService', () => {
        it('should create an instance of PositionService', () => {
            expect(service).toBeInstanceOf(PositionService);
        });
    });

    describe('getUserPositions', () => {
        it('should return cached positions when available', async () => {
            const cacheKey = `positions:${mockUserId}`;
            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: mockPositions,
            });

            const result = await service.getUserPositions(mockUserId);

            expect(mockCache.get).toHaveBeenCalledWith(cacheKey);
            expect(mockPositionRepository.getPositions).not.toHaveBeenCalled();
            expect(result).toEqual(mockPositions);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Position cache hit',
                expect.objectContaining({
                    userId: mockUserId,
                    count: mockPositions.length,
                })
            );
        });

        it('should fetch positions from repository when cache miss', async () => {
            const cacheKey = `positions:${mockUserId}`;
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(mockPositions);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getUserPositions(mockUserId);

            expect(mockCache.get).toHaveBeenCalledWith(cacheKey);
            expect(mockPositionRepository.getPositions).toHaveBeenCalledWith(mockUserId);
            expect(mockCache.setex).toHaveBeenCalled();
            expect(result).toEqual(mockPositions);
        });

        it('should handle cache set failure gracefully', async () => {
            const cacheKey = `positions:${mockUserId}`;
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(mockPositions);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: false, error: 'Redis connection error' });

            const result = await service.getUserPositions(mockUserId);

            expect(mockLogger.warn).toHaveBeenCalled();
            expect(result).toEqual(mockPositions);
        });

        it('should validate and convert positions before returning', async () => {
            const invalidPositions = [
                ...mockPositions,
                { invalid: 'data' }, // Invalid position data
            ];

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(invalidPositions);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getUserPositions(mockUserId);

            expect(result.length).toEqual(mockPositions.length);
            expect(mockLogger.warn).toHaveBeenCalled();
        });
    });

    describe('getPosition', () => {
        it('should return single position by symbol', async () => {
            (mockPositionRepository.getPosition as jest.Mock).mockResolvedValue(mockPositions[0]);

            const result = await service.getPosition(mockUserId, mockSymbol);

            expect(mockPositionRepository.getPosition).toHaveBeenCalledWith(mockUserId, mockSymbol);
            expect(result).toEqual(mockPositions[0]);
        });

        it('should return null when position not found', async () => {
            (mockPositionRepository.getPosition as jest.Mock).mockResolvedValue(null);

            const result = await service.getPosition(mockUserId, 'INVALID/SYMBOL');

            expect(result).toBeNull();
            expect(mockLogger.debug).toHaveBeenCalledWith('Position not found', expect.any(Object));
        });

        it('should handle errors when fetching position', async () => {
            const testError = new Error('Database connection failed');
            (mockPositionRepository.getPosition as jest.Mock).mockRejectedValue(testError);

            const result = await service.getPosition(mockUserId, mockSymbol);

            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('validatePositionSize', () => {
        const baseAccountLimits: AccountLimits = {
            balance: 10000,
            maxLeverage: 10,
            totalExposure: 5000,
            maxNotional: { 'BTC/USDT': 2000 },
            takerFeeRate: 0.001,
            makerFeeRate: 0.001,
        };

        it('should reject position below minimum notional', async () => {
            const result = await service.validatePositionSize(
                mockUserId,
                5, // Less than $10 minimum
                mockSymbol,
                baseAccountLimits
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Minimum');
        });

        it('should reject position exceeding single position limit', async () => {
            const result = await service.validatePositionSize(
                mockUserId,
                3000, // 30% of $10000 (exceeds 25% limit)
                mockSymbol,
                baseAccountLimits
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('single position limit');
            expect(result.maxAllowed).toBeLessThan(3000);
        });

        it('should reject position exceeding symbol-specific max notional', async () => {
            const result = await service.validatePositionSize(
                mockUserId,
                2500, // Exceeds BTC/USDT max notional of 2000
                mockSymbol,
                baseAccountLimits
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('exchange max notional limit');
            expect(result.maxAllowed).toBe(2000);
        });

        it('should reject position exceeding leverage limit', async () => {
            // Increase balance and single position limit to allow leverage check
            const highLeverageLimits = {
                ...baseAccountLimits,
                balance: 100000, // $100,000 balance
                maxLeverage: 10,
                totalExposure: 0,
                maxNotional: {},
            };

            // Need single position limit > $1,100,000. 10000% of $100,000 is $10,000,000
            const result = await service.validatePositionSize(
                mockUserId,
                1100000, // Exceeds 10x leverage ($1,100,000 > $1,000,000)
                'ETH/USDT',
                highLeverageLimits,
                100.0, // maxExposurePercent (10000% - much higher than leverage limit)
                100.0  // maxSinglePositionPercent (10000% - much higher than leverage limit)
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('leverage limit');
            expect(result.maxAllowed).toBe(1000000); // $100,000 * 10
        });

        it('should reject position with insufficient margin', async () => {
            // Adjust limits to allow margin check without hitting single position limit
            const marginLimits = {
                ...baseAccountLimits,
                maxLeverage: 100, // Very high leverage to avoid hitting leverage limit
            };

            // Requires margin = 95000 / 100 = $950, which is 9.5% of $10,000 - needs to be > 90%
            const result = await service.validatePositionSize(
                mockUserId,
                950000, // Requires $9500 margin (exceeds 90% of $10000)
                'ETH/USDT',
                marginLimits,
                100.0, // maxExposurePercent (10000%)
                100.0  // maxSinglePositionPercent (10000%)
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Insufficient margin');
            expect(result.maxAllowed).toBe(900000); // $10000 * 0.9 * 100
        });


        it('should approve valid position size', async () => {
            const result = await service.validatePositionSize(
                mockUserId,
                1500, // $1500 notional
                mockSymbol,
                baseAccountLimits
            );

            expect(result.isValid).toBe(true);
            expect(result.maxAllowed).toBeGreaterThanOrEqual(1500);
            expect(mockLogger.debug).toHaveBeenCalledWith('Position validation passed', expect.any(Object));
        });
    });

    describe('calculateAccountLimits', () => {
        it('should calculate account limits correctly', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(mockPositions);

            const result = await service.calculateAccountLimits(mockUserId, mockBalance);

            expect(result.balance).toEqual(mockBalance.total);
            expect(result.maxLeverage).toEqual(10);
            expect(result.takerFeeRate).toEqual(0.001);
            expect(result.makerFeeRate).toEqual(0.001);
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should handle errors when calculating limits', async () => {
            const testError = new Error('Failed to fetch positions');
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockRejectedValue(testError);

            await expect(service.calculateAccountLimits(mockUserId, mockBalance)).rejects.toThrow(testError);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('assessRisk', () => {
        it('should assess low risk level correctly', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue([]);

            const result = await service.assessRisk(mockUserId, mockBalance);

            expect(result.riskLevel).toEqual('LOW');
            expect(result.utilizationPercentage).toEqual(0);
            expect(result.recommendations.length).toBeGreaterThan(0);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should assess high risk level correctly', async () => {
            const highRiskPositions = [
                new Position('BTC/USDT', 'LONG', 1, 50000, 51000, 100, 0.01, 49000),
            ];

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(highRiskPositions);

            const result = await service.assessRisk(mockUserId, new Balance(1000, 500, 500, 'USD', new Date()));

            expect(result.riskLevel).toEqual('CRITICAL');
            expect(result.utilizationPercentage).toBeGreaterThan(90);
            expect(result.recommendations.length).toBeGreaterThan(2);
        });

        it('should identify concentrated positions', async () => {
            const concentratedPositions = [
                new Position('BTC/USDT', 'LONG', 0.5, 50000, 51000, 10, 0.01, 45000),
            ];

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(concentratedPositions);

            const result = await service.assessRisk(mockUserId, new Balance(25000, 12500, 12500, 'USD', new Date()));

            expect(result.recommendations.some(rec => rec.includes('BTC/USDT'))).toBe(true);
        });

        it('should identify positions near liquidation', async () => {
            const nearLiquidationPosition = new Position('BTC/USDT', 'LONG', 0.1, 50000, 45500, 10, 0.01, 45000);

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue([nearLiquidationPosition]);

            const result = await service.assessRisk(mockUserId, mockBalance);

            expect(result.recommendations.some(rec => rec.includes('near liquidation'))).toBe(true);
        });
    });

    describe('syncPositions', () => {
        it('should synchronize positions successfully', async () => {
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.syncPositions(mockUserId);

            expect(result.success).toBe(true);
            expect(mockLogger.info).toHaveBeenCalled();
            expect(mockCache.delete).toHaveBeenCalled();
        });

        it('should handle sync failure gracefully', async () => {
            const testError = new Error('API connection timeout');
            (mockCache.delete as jest.Mock).mockRejectedValue(testError);

            const result = await service.syncPositions(mockUserId);

            expect(result.success).toBe(false);
            expect(result.message).toContain(testError.message);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('invalidatePositionCache', () => {
        it('should invalidate position cache successfully', async () => {
            const cacheKey = `positions:${mockUserId}`;
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            await service.invalidatePositionCache(mockUserId);

            expect(mockCache.delete).toHaveBeenCalledWith(cacheKey);
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should handle cache invalidation failure', async () => {
            const cacheKey = `positions:${mockUserId}`;
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: false, error: 'Redis error' });

            await service.invalidatePositionCache(mockUserId);

            expect(mockLogger.warn).toHaveBeenCalled();
        });
    });

    describe('getPortfolioMetrics', () => {
        it('should calculate portfolio metrics correctly', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: true, data: mockPositions });

            const result = await service.getPortfolioMetrics(mockUserId);

            expect(result.totalPositions).toEqual(2);
            expect(result.totalExposure).toBeGreaterThan(0);
            expect(typeof result.totalUnrealizedPnL).toEqual('number');
            expect(typeof result.profitablePositions).toEqual('number');
            expect(typeof result.losingPositions).toEqual('number');
            expect(result.largestPosition).toBeDefined();
        });

        it('should handle empty positions list', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: true, data: [] });

            const result = await service.getPortfolioMetrics(mockUserId);

            expect(result.totalPositions).toEqual(0);
            expect(result.totalExposure).toEqual(0);
            expect(result.totalUnrealizedPnL).toEqual(0);
            expect(result.profitablePositions).toEqual(0);
            expect(result.losingPositions).toEqual(0);
            expect(result.largestPosition).toBeNull();
        });
    });
});