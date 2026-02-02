/** @format */

import { MarketService, createMarketService, MarketServiceDependencies } from '../../src/core/market/market.service';

describe('MarketService', () => {
    // Create mock dependencies for the MarketService
    const createMockDependencies = (): MarketServiceDependencies => {
        return {
            kodiakCredentialsRepository: {
                getCredentials: jest.fn(),
                saveCredentials: jest.fn(),
                updateVerificationStatus: jest.fn(),
                updateWalletAddress: jest.fn(),
                deleteCredentials: jest.fn(),
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

    describe('Constructor', () => {
        it('should create an instance of MarketService', () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);
            expect(marketService).toBeInstanceOf(MarketService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const marketService = createMarketService(deps);
            expect(marketService).toBeInstanceOf(MarketService);
        });
    });

    describe('hasUserKodiakCredentials', () => {
        it('should return true if user has verified Kodiak credentials', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testUserId = 'user-123';
            const mockCredentials = {
                id: 'creds-123',
                userId: testUserId,
                apiKey: 'test-api-key',
                apiSecret: 'test-api-secret',
                verified: true,
                walletAddress: '0x1234567890'
            };
            (deps.kodiakCredentialsRepository.getCredentials as jest.Mock).mockResolvedValue(mockCredentials);

            const result = await marketService.hasUserKodiakCredentials(testUserId);

            expect(result).toBe(true);
            expect(deps.kodiakCredentialsRepository.getCredentials).toHaveBeenCalledWith(testUserId);
        });

        it('should return false if user has credentials but they are not verified', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testUserId = 'user-123';
            const mockCredentials = {
                id: 'creds-123',
                userId: testUserId,
                apiKey: 'test-api-key',
                apiSecret: 'test-api-secret',
                verified: false,
                walletAddress: '0x1234567890'
            };
            (deps.kodiakCredentialsRepository.getCredentials as jest.Mock).mockResolvedValue(mockCredentials);

            const result = await marketService.hasUserKodiakCredentials(testUserId);

            expect(result).toBe(false);
            expect(deps.kodiakCredentialsRepository.getCredentials).toHaveBeenCalledWith(testUserId);
        });

        it('should return false if user has no Kodiak credentials', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testUserId = 'user-123';
            (deps.kodiakCredentialsRepository.getCredentials as jest.Mock).mockResolvedValue(null);

            const result = await marketService.hasUserKodiakCredentials(testUserId);

            expect(result).toBe(false);
            expect(deps.kodiakCredentialsRepository.getCredentials).toHaveBeenCalledWith(testUserId);
        });

        it('should return false and log error when getting credentials fails', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testUserId = 'user-123';
            const testError = new Error('Database connection failed');
            (deps.kodiakCredentialsRepository.getCredentials as jest.Mock).mockRejectedValue(testError);

            const result = await marketService.hasUserKodiakCredentials(testUserId);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
            expect(deps.kodiakCredentialsRepository.getCredentials).toHaveBeenCalledWith(testUserId);
        });
    });

    describe('getMarketPrices', () => {
        it('should retrieve all market prices when no symbols are specified', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const result = await marketService.getMarketPrices();

            expect(result).toBeInstanceOf(Array);
            expect(result.length).toBeGreaterThan(0);
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should retrieve specific market prices when symbols are specified', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testSymbols = ['BTC/USDT', 'ETH/USDT'];
            const result = await marketService.getMarketPrices(testSymbols);

            expect(result).toBeInstanceOf(Array);
            expect(result.length).toBe(testSymbols.length);
            result.forEach(price => {
                expect(testSymbols).toContain(price.symbol);
            });
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle errors when retrieving market prices', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testError = new Error('API connection failed');
            (deps.logger.debug as jest.Mock).mockImplementation(() => { throw testError; });

            await expect(marketService.getMarketPrices()).rejects.toThrow('Failed to get market prices');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('getAvailableTradingPairs', () => {
        it('should retrieve all available trading pairs', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const result = await marketService.getAvailableTradingPairs();

            expect(result).toBeInstanceOf(Array);
            expect(result.length).toBeGreaterThan(0);
            result.forEach(pair => {
                expect(pair.symbol).toBeDefined();
                expect(pair.base).toBeDefined();
                expect(pair.quote).toBeDefined();
                expect(pair.status).toBeDefined();
            });
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle errors when retrieving trading pairs', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testError = new Error('Market data unavailable');
            (deps.logger.debug as jest.Mock).mockImplementation(() => { throw testError; });

            await expect(marketService.getAvailableTradingPairs()).rejects.toThrow('Failed to get trading pairs');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('getMarketDepth', () => {
        it('should retrieve market depth for BTC/USDT', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const result = await marketService.getMarketDepth('BTC/USDT');

            expect(result.symbol).toBe('BTC/USDT');
            expect(result.bids).toBeInstanceOf(Array);
            expect(result.asks).toBeInstanceOf(Array);
            expect(result.bids.length).toBeGreaterThan(0);
            expect(result.asks.length).toBeGreaterThan(0);
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should retrieve market depth with custom limit', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const customLimit = 10;
            const result = await marketService.getMarketDepth('ETH/USDT', customLimit);

            expect(result.symbol).toBe('ETH/USDT');
            expect(result.bids.length).toBe(customLimit);
            expect(result.asks.length).toBe(customLimit);
        });

        it('should retrieve market depth for different symbols', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const symbols = ['SOL/USDT', 'ADA/USDT', 'DOT/USDT'];
            for (const symbol of symbols) {
                const result = await marketService.getMarketDepth(symbol);
                expect(result.symbol).toBe(symbol);
                expect(result.bids).toBeInstanceOf(Array);
                expect(result.asks).toBeInstanceOf(Array);
            }
        });

        it('should handle errors when retrieving market depth', async () => {
            const deps = createMockDependencies();
            const marketService = new MarketService(deps);

            const testError = new Error('Market depth data unavailable');
            (deps.logger.debug as jest.Mock).mockImplementation(() => { throw testError; });

            await expect(marketService.getMarketDepth('BTC/USDT')).rejects.toThrow('Failed to get market depth');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });
});