import { PositionSyncService, createPositionSyncService, PositionSyncServiceDependencies, PositionData, PositionSyncResult } from '../../src/core/strategies/position-sync.service.pure';
import { IPositionRepository, IUserRepository, ICacheService, IExternalApiService, ILogger, Position } from '@trade-bot/shared';

describe('PositionSyncService', () => {
    let mockLogger: Partial<ILogger>;
    let mockCache: Partial<ICacheService>;
    let mockPositionRepository: Partial<IPositionRepository>;
    let mockUserRepository: Partial<IUserRepository>;
    let mockExternalApi: Partial<IExternalApiService>;
    let service: PositionSyncService;

    const mockUserId = 'test-user-id';
    const mockSymbol = 'BTC/USDT';

    const mockPositions: PositionData[] = [
        {
            symbol: 'BTC/USDT',
            positionQty: 0.1,
            costPosition: 5000,
            averageOpenPrice: 50000,
            markPrice: 51000,
            unsettledPnl: 100,
            pnl24h: 200,
            leverage: 10,
            imr: 0.01,
            mmr: 0.005,
            estLiqPrice: 45000,
            lastUpdated: new Date(),
        },
        {
            symbol: 'ETH/USDT',
            positionQty: 1,
            costPosition: 3000,
            averageOpenPrice: 3000,
            markPrice: 3100,
            unsettledPnl: 100,
            pnl24h: 50,
            leverage: 5,
            imr: 0.02,
            mmr: 0.01,
            estLiqPrice: 2800,
            lastUpdated: new Date(),
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

        mockPositionRepository = {
            getPosition: jest.fn(),
            getPositions: jest.fn(),
            updatePosition: jest.fn(),
        };

        mockUserRepository = {
            // Add necessary user repository methods here
        };

        mockExternalApi = {
            getPositions: jest.fn(),
            getAccountInfo: jest.fn(),
        };

        // Create service instance
        service = createPositionSyncService({
            positionRepository: mockPositionRepository as IPositionRepository,
            userRepository: mockUserRepository as IUserRepository,
            cache: mockCache as ICacheService,
            externalApi: mockExternalApi as IExternalApiService,
            logger: mockLogger as ILogger,
        });
    });

    describe('createPositionSyncService', () => {
        it('should create an instance of PositionSyncService', () => {
            expect(service).toBeInstanceOf(PositionSyncService);
        });
    });

    describe('syncPositionsFromExternalAPI', () => {
        it('should sync positions successfully from external API to database', async () => {
            // Setup mocks
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: mockPositions,
            });
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: { totalBalance: 10000 },
            });
            (mockPositionRepository.getPosition as jest.Mock).mockResolvedValue(null);
            (mockPositionRepository.updatePosition as jest.Mock).mockResolvedValue(true);
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result: PositionSyncResult = await service.syncPositionsFromExternalAPI(mockUserId);

            expect(result.success).toBe(true);
            expect(result.positionsSynced).toBe(mockPositions.length);
            expect(result.errors).toEqual([]);
            expect(mockExternalApi.getPositions).toHaveBeenCalledWith(mockUserId);
            expect(mockExternalApi.getAccountInfo).toHaveBeenCalledWith(mockUserId);
            expect(mockPositionRepository.updatePosition).toHaveBeenCalledTimes(mockPositions.length);
            expect(mockCache.delete).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should handle failed API response for positions', async () => {
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: false,
                error: 'API connection failed',
            });

            const result: PositionSyncResult = await service.syncPositionsFromExternalAPI(mockUserId);

            expect(result.success).toBe(false);
            expect(result.positionsSynced).toBe(0);
            expect(result.errors).toEqual(['API connection failed']);
        });

        it('should handle errors when storing positions in database', async () => {
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: [mockPositions[0]],
            });
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: { totalBalance: 10000 },
            });
            (mockPositionRepository.getPosition as jest.Mock).mockResolvedValue(null);
            (mockPositionRepository.updatePosition as jest.Mock).mockRejectedValue(new Error('Database connection error'));

            const result: PositionSyncResult = await service.syncPositionsFromExternalAPI(mockUserId);

            expect(result.success).toBe(false);
            expect(result.positionsSynced).toBe(0);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should continue syncing other positions when one fails', async () => {
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: mockPositions,
            });
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: true,
                data: { totalBalance: 10000 },
            });
            (mockPositionRepository.getPosition as jest.Mock)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null);
            (mockPositionRepository.updatePosition as jest.Mock)
                .mockRejectedValueOnce(new Error('Failed to store BTC position'))
                .mockResolvedValueOnce(true);

            const result: PositionSyncResult = await service.syncPositionsFromExternalAPI(mockUserId);

            expect(result.success).toBe(false);
            expect(result.positionsSynced).toBe(1);
            expect(result.errors.length).toBe(1);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle failed account info sync separately from position sync', async () => {
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: [mockPositions[0]],
            });
            (mockExternalApi.getAccountInfo as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Account info not available',
            });
            (mockPositionRepository.getPosition as jest.Mock).mockResolvedValue(null);
            (mockPositionRepository.updatePosition as jest.Mock).mockResolvedValue(true);

            const result: PositionSyncResult = await service.syncPositionsFromExternalAPI(mockUserId);

            expect(result.success).toBe(false);
            expect(result.positionsSynced).toBe(1);
            expect(result.errors.length).toBe(1);
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should log errors for failed sync operations', async () => {
            const testError = new Error('Test sync error');
            (mockExternalApi.getPositions as jest.Mock).mockRejectedValue(testError);

            const result: PositionSyncResult = await service.syncPositionsFromExternalAPI(mockUserId);

            expect(result.success).toBe(false);
            expect(mockLogger.error).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                "Position sync error",
                expect.objectContaining({
                    userId: mockUserId,
                    error: testError.message,
                })
            );
        });
    });

    describe('getPositionsFromDatabase', () => {
        it('should return positions from cache when available', async () => {
            const cachedPositions = [
                new Position(mockSymbol, 'LONG', 0.1, 50000, 51000, 10, 0.01, 45000),
            ];
            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: JSON.stringify(cachedPositions),
            });

            const result = await service.getPositionsFromDatabase(mockUserId);

            expect(mockCache.get).toHaveBeenCalled();
            expect(mockPositionRepository.getPositions).not.toHaveBeenCalled();
            expect(result).toEqual(cachedPositions);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Position cache hit",
                expect.objectContaining({
                    userId: mockUserId,
                    count: cachedPositions.length,
                })
            );
        });

        it('should fetch positions from database when cache is missing', async () => {
            const dbPositions = [
                new Position(mockSymbol, 'LONG', 0.1, 50000, 51000, 10, 0.01, 45000),
            ];
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(dbPositions);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getPositionsFromDatabase(mockUserId);

            expect(mockCache.get).toHaveBeenCalled();
            expect(mockPositionRepository.getPositions).toHaveBeenCalledWith(mockUserId);
            expect(mockCache.setex).toHaveBeenCalled();
            expect(result).toEqual(dbPositions);
        });

        it('should handle errors when fetching positions from database', async () => {
            const testError = new Error('Database query failed');
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockPositionRepository.getPositions as jest.Mock).mockRejectedValue(testError);

            await expect(service.getPositionsFromDatabase(mockUserId)).rejects.toThrow(testError);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('validatePositionConsistency', () => {
        it('should return consistent status when positions match', async () => {
            const dbPositions = [
                new Position(mockSymbol, 'LONG', 0.1, 50000, 51000, 10, 0.01, 45000),
            ];
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(dbPositions);
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: [mockPositions[0]],
            });
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });

            const result = await service.validatePositionConsistency(mockUserId);

            expect(result.isConsistent).toBe(true);
            expect(result.issues).toEqual([]);
            expect(result.databasePositions).toEqual(dbPositions.length);
            expect(result.apiPositions).toEqual(1);
        });

        it('should report inconsistency when position count differs significantly', async () => {
            const manyDbPositions = Array.from({ length: 5 }, (_, i) =>
                new Position(`SYMBOL${i}/USDT`, 'LONG', 0.1, 100, 105, 10, 0.01, 90)
            );
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(manyDbPositions);
            (mockExternalApi.getPositions as jest.Mock).mockResolvedValue({
                success: true,
                data: [mockPositions[0]],
            });
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });

            const result = await service.validatePositionConsistency(mockUserId);

            expect(result.isConsistent).toBe(false);
            expect(result.issues.length).toBeGreaterThan(0);
            expect(result.databasePositions).toEqual(5);
            expect(result.apiPositions).toEqual(1);
        });

        it('should handle API errors during consistency check', async () => {
            const dbPositions = [
                new Position(mockSymbol, 'LONG', 0.1, 50000, 51000, 10, 0.01, 45000),
            ];
            const testError = new Error('API connection timeout');
            (mockPositionRepository.getPositions as jest.Mock).mockResolvedValue(dbPositions);
            (mockExternalApi.getPositions as jest.Mock).mockRejectedValue(testError);
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });

            const result = await service.validatePositionConsistency(mockUserId);

            expect(result.isConsistent).toBe(false);
            expect(result.issues.length).toBeGreaterThan(0);
        });
    });

    describe('syncAllUserPositions', () => {
        it('should handle batch sync operation', async () => {
            const result = await service.syncAllUserPositions();

            expect(result.totalUsers).toEqual(0);
            expect(result.successfulSyncs).toEqual(0);
            expect(result.errors).toEqual([]);
            expect(mockLogger.info).toHaveBeenCalled();
        });
    });
});