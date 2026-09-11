/** @format */

import { BalanceService, createBalanceService, BalanceServiceDependencies, LegacyBalanceFormat } from '../../src/core/wallet/balance.service.pure';
import { Balance } from '@trade-bot/shared';

describe('BalanceService', () => {
    // Create mock dependencies for the BalanceService
    const createMockDependencies = (): BalanceServiceDependencies => {
        return {
            balanceRepository: {
                getBalance: jest.fn(),
                updateBalance: jest.fn(),
                getBalanceHistory: jest.fn(),
            },
            cache: {
                get: jest.fn(),
                setex: jest.fn(),
                delete: jest.fn(),
                set: jest.fn(),
                exists: jest.fn(),
                mget: jest.fn(),
                mset: jest.fn(),
                atomicConditionalUpdate: jest.fn(),
            },
            externalApi: {
                getBalance: jest.fn(),
                getPositions: jest.fn(),
                getTrades: jest.fn(),
                getAccountInfo: jest.fn(),
                testConnectivity: jest.fn(),
                invalidateUserCache: jest.fn(),
                validateWalletChain: jest.fn(),
                checkNFTOwnership: jest.fn(),
                checkTokenBalance: jest.fn(),
            },
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                child: jest.fn(),
            },
        };
    };

    // Create mock balance data
    const createMockBalance = (): Balance => {
        return new Balance(1000, 800, 200, 'USD', new Date());
    };

    describe('Constructor', () => {
        it('should create an instance of BalanceService', () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            expect(balanceService).toBeInstanceOf(BalanceService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const balanceService = createBalanceService(deps);
            expect(balanceService).toBeInstanceOf(BalanceService);
        });
    });

    describe('getUserBalance', () => {
        it('should return balance from cache when available (modern format)', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';
            const mockBalance = createMockBalance();

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: true, data: mockBalance });

            const result = await balanceService.getUserBalance(testUserId);

            expect(result).toEqual(mockBalance);
            expect(deps.cache.get).toHaveBeenCalled();
            expect(deps.externalApi.getBalance).not.toHaveBeenCalled();
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should fetch balance from API and cache when cache miss (modern format)', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';
            const mockBalance = createMockBalance();

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.externalApi.getBalance as jest.Mock).mockResolvedValue({ success: true, data: mockBalance });
            (deps.cache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await balanceService.getUserBalance(testUserId);

            expect(result).toEqual(mockBalance);
            expect(deps.cache.get).toHaveBeenCalled();
            expect(deps.externalApi.getBalance).toHaveBeenCalledWith(testUserId);
            expect(deps.cache.setex).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should return legacy format when LEGACY_BALANCE_API flag is true', async () => {
            const originalEnv = process.env.LEGACY_BALANCE_API;
            process.env.LEGACY_BALANCE_API = 'true';

            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';
            const mockBalance = createMockBalance();

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: true, data: mockBalance });

            const result = await balanceService.getUserBalance(testUserId);

            expect(result).toEqual(expect.objectContaining({
                walletBalance: mockBalance.total,
                accountBalance: mockBalance.total,
                availableBalance: mockBalance.available,
                reservedBalance: mockBalance.locked,
                totalAssets: mockBalance.total,
            }));
            expect(typeof (result as LegacyBalanceFormat).timestamp).toBe('string');
            expect(Date.parse((result as LegacyBalanceFormat).timestamp)).not.toBeNaN();

            process.env.LEGACY_BALANCE_API = originalEnv;
        });

        it('should throw error when API call fails', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.externalApi.getBalance as jest.Mock).mockResolvedValue({ success: false, error: 'API Error' });

            await expect(balanceService.getUserBalance(testUserId)).rejects.toThrow();
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should throw error when API returns success without data', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.externalApi.getBalance as jest.Mock).mockResolvedValue({ success: true, data: null });

            await expect(balanceService.getUserBalance(testUserId)).rejects.toThrow();
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should throw error when balance validation fails', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';
            const invalidBalance = createMockBalance();
            invalidBalance.isValid = jest.fn().mockReturnValue(false);

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.externalApi.getBalance as jest.Mock).mockResolvedValue({ success: true, data: invalidBalance });

            await expect(balanceService.getUserBalance(testUserId)).rejects.toThrow();
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should handle cache set failure', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';
            const mockBalance = createMockBalance();

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: false, data: null });
            (deps.externalApi.getBalance as jest.Mock).mockResolvedValue({ success: true, data: mockBalance });
            (deps.cache.setex as jest.Mock).mockResolvedValue({ success: false, error: 'Cache Error' });

            const result = await balanceService.getUserBalance(testUserId);

            expect(result).toEqual(mockBalance);
            expect(deps.logger.warn).toHaveBeenCalled();
        });
    });

    describe('invalidateBalanceCache', () => {
        it('should invalidate balance cache successfully', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            (deps.cache.delete as jest.Mock).mockResolvedValue({ success: true });
            (deps.externalApi.invalidateUserCache as jest.Mock).mockResolvedValue(undefined);

            await balanceService.invalidateBalanceCache(testUserId);

            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.externalApi.invalidateUserCache).toHaveBeenCalledWith(testUserId);
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should handle cache invalidation failure', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            (deps.cache.delete as jest.Mock).mockResolvedValue({ success: false, error: 'Cache Error' });
            (deps.externalApi.invalidateUserCache as jest.Mock).mockResolvedValue(undefined);

            await balanceService.invalidateBalanceCache(testUserId);

            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.logger.warn).toHaveBeenCalled();
        });
    });

    describe('getBalanceHistory', () => {
        it('should return empty array for balance history (placeholder implementation)', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            const result = await balanceService.getBalanceHistory(testUserId);

            expect(result).toEqual([]);
            expect(deps.logger.debug).toHaveBeenCalled();
        });
    });

    describe('canWithdraw', () => {
        it('should return true when user has sufficient balance to withdraw', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            // Create a spy on the Balance prototype methods
            const canWithdrawSpy = jest.spyOn(Balance.prototype, 'canWithdraw').mockReturnValue(true);
            const mockBalance = createMockBalance();

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: true, data: mockBalance });

            const result = await balanceService.canWithdraw(testUserId, 500);

            expect(result).toBe(true);
            expect(canWithdrawSpy).toHaveBeenCalledWith(500);

            canWithdrawSpy.mockRestore();
        });

        it('should return false when user does not have sufficient balance', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            const canWithdrawSpy = jest.spyOn(Balance.prototype, 'canWithdraw').mockReturnValue(false);
            const mockBalance = createMockBalance();

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: true, data: mockBalance });

            const result = await balanceService.canWithdraw(testUserId, 1000);

            expect(result).toBe(false);
            expect(canWithdrawSpy).toHaveBeenCalledWith(1000);

            canWithdrawSpy.mockRestore();
        });

        it('should return false when getting balance fails', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            (deps.cache.get as jest.Mock).mockRejectedValue(new Error('Cache Error'));

            const result = await balanceService.canWithdraw(testUserId, 500);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('getBalanceUtilization', () => {
        it('should return correct utilization percentage', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            const getUtilizationPercentageSpy = jest.spyOn(Balance.prototype, 'getUtilizationPercentage').mockReturnValue(20);
            const mockBalance = createMockBalance();

            (deps.cache.get as jest.Mock).mockResolvedValue({ success: true, data: mockBalance });

            const result = await balanceService.getBalanceUtilization(testUserId);

            expect(result).toEqual(20);
            expect(getUtilizationPercentageSpy).toHaveBeenCalled();

            getUtilizationPercentageSpy.mockRestore();
        });

        it('should throw error when getting balance fails', async () => {
            const deps = createMockDependencies();
            const balanceService = new BalanceService(deps);
            const testUserId = 'user-123';

            (deps.cache.get as jest.Mock).mockRejectedValue(new Error('Cache Error'));

            await expect(balanceService.getBalanceUtilization(testUserId)).rejects.toThrow();
        });
    });

    describe('Internal Methods', () => {
        describe('shouldReturnLegacyFormat', () => {
            it('should return true when LEGACY_BALANCE_API is true', () => {
                const originalEnv = process.env.LEGACY_BALANCE_API;
                process.env.LEGACY_BALANCE_API = 'true';

                const getShouldReturnLegacyFormat = (service: any) => service.shouldReturnLegacyFormat();

                const deps = createMockDependencies();
                const balanceService = new BalanceService(deps);

                const result = getShouldReturnLegacyFormat(balanceService);

                expect(result).toBe(true);

                process.env.LEGACY_BALANCE_API = originalEnv;
            });

            it('should return false when LEGACY_BALANCE_API is not true', () => {
                const originalEnv = process.env.LEGACY_BALANCE_API;
                process.env.LEGACY_BALANCE_API = 'false';

                const getShouldReturnLegacyFormat = (service: any) => service.shouldReturnLegacyFormat();

                const deps = createMockDependencies();
                const balanceService = new BalanceService(deps);

                const result = getShouldReturnLegacyFormat(balanceService);

                expect(result).toBe(false);

                process.env.LEGACY_BALANCE_API = originalEnv;
            });
        });

        describe('convertToLegacyFormat', () => {
            it('should correctly convert modern balance format to legacy format', () => {
                const convertToLegacyFormat = (service: any, balance: Balance) => service.convertToLegacyFormat(balance);

                const deps = createMockDependencies();
                const balanceService = new BalanceService(deps);
                const mockBalance = createMockBalance();

                const legacyFormat = convertToLegacyFormat(balanceService, mockBalance);

                expect(legacyFormat.walletBalance).toEqual(mockBalance.total);
                expect(legacyFormat.accountBalance).toEqual(mockBalance.total);
                expect(legacyFormat.availableBalance).toEqual(mockBalance.available);
                expect(legacyFormat.reservedBalance).toEqual(mockBalance.locked);
                expect(legacyFormat.totalAssets).toEqual(mockBalance.total);
                expect(typeof legacyFormat.timestamp).toBe('string');
                expect(Date.parse(legacyFormat.timestamp)).not.toBeNaN();
            });
        });
    });
});