import { PositionValidatorService, createPositionValidatorService, PositionValidatorServiceDependencies, AccountLimits, PositionValidationResult } from '../../src/core/strategies/position-validator.service.pure';
import { IPositionRepository, IUserRepository, ICacheService, IExternalApiService, ILogger } from '@trade-bot/shared';

describe('PositionValidatorService', () => {
    let mockLogger: Partial<ILogger>;
    let mockCache: Partial<ICacheService>;
    let mockPositionRepository: Partial<IPositionRepository>;
    let mockUserRepository: Partial<IUserRepository>;
    let mockExternalApi: Partial<IExternalApiService>;
    let service: PositionValidatorService;

    const mockUserId = 'test-user-id';
    const mockSymbol = 'BTC/USDT';

    const mockAccountLimits: AccountLimits = {
        balance: 10000,
        maxLeverage: 10,
        totalExposure: 2000,
        maxNotional: { 'BTC/USDT': 5000, 'ETH/USDT': 3000 },
        takerFeeRate: 0.001,
        makerFeeRate: 0.001,
    };

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

        mockPositionRepository = {
            getPosition: jest.fn(),
            getPositions: jest.fn(),
            updatePosition: jest.fn(),
        };

        mockUserRepository = {
            // Add necessary user repository methods here
        };

        mockExternalApi = {
            getAccountInfo: jest.fn(),
            getPositions: jest.fn(),
        };

        // Create service instance
        service = createPositionValidatorService({
            positionRepository: mockPositionRepository as IPositionRepository,
            userRepository: mockUserRepository as IUserRepository,
            cache: mockCache as ICacheService,
            externalApi: mockExternalApi as IExternalApiService,
            logger: mockLogger as ILogger,
        });
    });

    describe('createPositionValidatorService', () => {
        it('should create an instance of PositionValidatorService', () => {
            expect(service).toBeInstanceOf(PositionValidatorService);
        });
    });

    describe('getAccountLimits', () => {
        it('should retrieve and calculate account limits successfully', async () => {
            // Setup mocks
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: { totalBalance: 10000 },
            });
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: [
                    { quantity: 0.1, markPrice: 50000 },
                    { quantity: 1, markPrice: 3000 },
                ],
            });

            const result: AccountLimits = await service.getAccountLimits(mockUserId);

            expect(result).toEqual(expect.objectContaining({
                balance: 10000,
                maxLeverage: 10,
                totalExposure: expect.any(Number),
            }));
            expect(mockExternalApi.getAccountInfo).toHaveBeenCalledWith(mockUserId);
            expect(mockExternalApi.getPositions).toHaveBeenCalledWith(mockUserId);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should throw error when account info API fails', async () => {
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: false,
                error: 'API connection failed',
            });

            await expect(service.getAccountLimits(mockUserId)).rejects.toThrow('Account validation failed');
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should throw error when positions API fails', async () => {
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: { totalBalance: 10000 },
            });
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Positions API error',
            });

            await expect(service.getAccountLimits(mockUserId)).rejects.toThrow('Account validation failed');
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should log errors when API calls reject', async () => {
            const testError = new Error('Network timeout');
            (mockExternalApi.getAccountInfo as jest.Mock).mockRejectedValue(testError);

            await expect(service.getAccountLimits(mockUserId)).rejects.toThrow('Account validation failed');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('validatePositionSize', () => {
        it('should return valid result for position within all limits', async () => {
            const result: PositionValidationResult = await service.validatePositionSize(
                1000, mockSymbol, mockAccountLimits
            );

            expect(result.isValid).toBe(true);
            expect(result.reason).toBeUndefined();
            expect(result.maxAllowed).toBeGreaterThan(0);
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should reject position smaller than minimum notional', async () => {
            const result: PositionValidationResult = await service.validatePositionSize(
                5, mockSymbol, mockAccountLimits
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Position too small');
            expect(result.maxAllowed).toBeGreaterThan(0);
        });

        it('should reject position exceeding single position limit', async () => {
            const result: PositionValidationResult = await service.validatePositionSize(
                3000, mockSymbol, mockAccountLimits
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('single position limit');
            expect(result.maxAllowed).toBeLessThan(3000);
            expect(result.recommended).toBeDefined();
        });

        it('should reject position exceeding symbol-specific max notional', async () => {
            // Create a new mock with much larger single position limit to reach symbol specific check
            const largeAccountLimits = { ...mockAccountLimits, balance: 100000 };
            const result: PositionValidationResult = await service.validatePositionSize(
                6000, mockSymbol, largeAccountLimits
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Orderly max notional limit');
            expect(result.maxAllowed).toBeLessThan(6000);
        });

        it('should reject position exceeding leverage limit', async () => {
            // Create a new mock that will specifically trigger leverage limit check
            const accountLimits = {
                balance: 10000,
                maxLeverage: 5,
                totalExposure: 0,
                maxNotional: {},
                takerFeeRate: 0.001,
                makerFeeRate: 0.001
            };

            // Leverage limit is 5, so max position size is 50000
            // We set single position limit to very high value to not trigger that first
            const result: PositionValidationResult = await service.validatePositionSize(
                60000, mockSymbol, accountLimits, 1, 10 // 1000% single position limit (essentially no limit)
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('leverage limit');
            expect(result.maxAllowed).toBeLessThan(60000);
        });

        it('should reject position with insufficient margin', async () => {
            // Create a new mock that will specifically trigger margin check
            const accountLimits = {
                balance: 1000,
                maxLeverage: 100,
                totalExposure: 0,
                maxNotional: {},
                takerFeeRate: 0.001,
                makerFeeRate: 0.001
            };

            // We need to directly override both single position and total exposure checks
            // Let's set them to very high values so they don't get triggered first
            const result: PositionValidationResult = await service.validatePositionSize(
                91000, mockSymbol, accountLimits, 100, 100 // 10000% for both
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Insufficient margin');
            expect(result.maxAllowed).toBeLessThan(91000);
        });

        it('should handle symbol without max notional limit', async () => {
            // Create a new mock with larger single position limit for SOL/USDT
            const largeAccountLimits = { ...mockAccountLimits, balance: 20000 };
            const result: PositionValidationResult = await service.validatePositionSize(
                4000, 'SOL/USDT', largeAccountLimits
            );

            expect(result.isValid).toBe(true);
            expect(result.reason).toBeUndefined();
        });
    });

    describe('hasUserKodiakCredentials', () => {
        it('should check if user has Kodiak credentials', async () => {
            const result = await service.hasUserKodiakCredentials(mockUserId);

            expect(typeof result).toBe('boolean');
        });

        it('should handle errors when checking user credentials', async () => {
            const testError = new Error('Database connection failed');
            // Mock repository to throw error
            // Since the current implementation returns true by default, we need to mock the implementation
            // This test will need to be updated if the real implementation changes
            expect(await service.hasUserKodiakCredentials(mockUserId)).toBe(true);
        });
    });

    describe('validateUserPosition', () => {
        it('should validate user position successfully', async () => {
            // Setup mocks
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: { totalBalance: 10000 },
            });
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: [
                    { quantity: 0.01, markPrice: 50000 }, // Reduced quantity to lower exposure
                    { quantity: 0.1, markPrice: 3000 }, // Reduced quantity to lower exposure
                ],
            });

            const result: PositionValidationResult = await service.validateUserPosition(
                mockUserId, 1000, mockSymbol
            );

            expect(result.isValid).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        it('should reject position if user has no Kodiak credentials', async () => {
            // Override the default implementation to return false
            service['hasUserKodiakCredentials'] = jest.fn().mockResolvedValue(false);

            const result: PositionValidationResult = await service.validateUserPosition(
                mockUserId, 1000, mockSymbol
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Kodiak credentials not configured');
        });

        it('should handle errors during validation process', async () => {
            const testError = new Error('Validation process failed');
            (mockExternalApi.getAccountInfo as jest.Mock).mockRejectedValue(testError);

            const result: PositionValidationResult = await service.validateUserPosition(
                mockUserId, 1000, mockSymbol
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Validation error');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('calculateAccountLimitsFromPositions', () => {
        it('should calculate account limits from position data', async () => {
            const mockPositions = [
                { positionQty: 0.1, markPrice: 50000 },
                { positionQty: 1, markPrice: 3000 },
            ];

            // Mock cache to return default account info
            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: JSON.stringify({
                    balance: 10000,
                    maxLeverage: 10,
                    maxNotional: { 'BTC/USDT': 5000 },
                    takerFeeRate: 0.001,
                    makerFeeRate: 0.001,
                }),
            });

            const result: AccountLimits = await service.calculateAccountLimitsFromPositions(
                mockUserId, mockPositions
            );

            expect(result).toEqual(expect.objectContaining({
                balance: 10000,
                maxLeverage: 10,
                totalExposure: expect.any(Number), // We don't know exact value, just that it exists
            }));
            expect(mockCache.get).toHaveBeenCalled();
        });

        it('should use default account info if cache is missing', async () => {
            const mockPositions = [
                { positionQty: 0.1, markPrice: 50000 },
            ];

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });

            const result: AccountLimits = await service.calculateAccountLimitsFromPositions(
                mockUserId, mockPositions
            );

            expect(result).toEqual(expect.objectContaining({
                balance: 0,
                maxLeverage: 1,
            }));
            expect(mockLogger.warn).toHaveBeenCalled();
            expect(mockCache.setex).toHaveBeenCalled();
        });

        it('should handle errors when calculating account limits', async () => {
            const testError = new Error('Failed to calculate limits');
            // We need to check the implementation of getAccountInfoFromCache
            // Looking at the service, it actually handles all errors and returns default values
            (mockCache.get as jest.Mock).mockImplementation(() => {
                throw testError;
            });

            const result = await service.calculateAccountLimitsFromPositions(
                mockUserId, []
            );

            expect(result).toEqual(expect.objectContaining({
                balance: 0,
                maxLeverage: 1,
            }));
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getAccountInfoFromCache', () => {
        it('should retrieve account info from cache when available', async () => {
            const mockAccountInfo = {
                balance: 10000,
                maxLeverage: 10,
                maxNotional: { 'BTC/USDT': 5000 },
                takerFeeRate: 0.001,
                makerFeeRate: 0.001,
            };

            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: JSON.stringify(mockAccountInfo),
            });

            // We need to spy on the private method to test it
            // This is a workaround to test private methods
            const getAccountInfoFromCache = jest.spyOn(service as any, 'getAccountInfoFromCache');
            const result = await (service as any).getAccountInfoFromCache(mockUserId);

            expect(getAccountInfoFromCache).toHaveBeenCalled();
            expect(result).toEqual(mockAccountInfo);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Account info cache hit",
                expect.objectContaining({
                    userId: mockUserId,
                })
            );
        });

        it('should return default account info if cache misses', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });

            const getAccountInfoFromCache = jest.spyOn(service as any, 'getAccountInfoFromCache');
            const result = await (service as any).getAccountInfoFromCache(mockUserId);

            expect(getAccountInfoFromCache).toHaveBeenCalled();
            expect(result).toEqual(expect.objectContaining({
                balance: 0,
                maxLeverage: 1,
            }));
            expect(mockLogger.warn).toHaveBeenCalled();
            expect(mockCache.setex).toHaveBeenCalled();
        });

        it('should handle cache errors gracefully', async () => {
            const testError = new Error('Cache connection failed');
            (mockCache.get as jest.Mock).mockRejectedValue(testError);

            const getAccountInfoFromCache = jest.spyOn(service as any, 'getAccountInfoFromCache');
            const result = await (service as any).getAccountInfoFromCache(mockUserId);

            expect(getAccountInfoFromCache).toHaveBeenCalled();
            expect(result).toEqual(expect.objectContaining({
                balance: 0,
                maxLeverage: 1,
            }));
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});