/** @format */

import { ExternalApiAdapter } from '../../src/infrastructure/adapters/external/external-api.adapter';
import { kodiakIntegrationService } from '../../src/infrastructure/external/kodiak-integration.service';
import logger from '../../src/core/logging/logger.service';

// Mock dependencies
jest.mock('../../src/infrastructure/external/kodiak-integration.service');
jest.mock('../../src/core/logging/logger.service');

describe('ExternalApiAdapter', () => {
    let adapter: ExternalApiAdapter;

    beforeEach(() => {
        adapter = new ExternalApiAdapter();
        jest.clearAllMocks();
    });

    describe('getBalance', () => {
        it('should return success with domain balance when Kodiak API succeeds', async () => {
            const mockKodiakResult = {
                success: true,
                data: {
                    totalBalance: '1000',
                    totalPnl24H: '50',
                    balances: [
                        { asset: 'USDC', free: '1000', locked: '0' },
                        { asset: 'BTC', free: '0.01', locked: '0' }
                    ]
                }
            };

            (kodiakIntegrationService.getBalance as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getBalance('test-user-id');

            expect(result.success).toBe(true);
            expect(result.data).toEqual(expect.objectContaining({
                total: expect.any(Number),
                available: expect.any(Number),
                currency: 'USD'
            }));
            expect(kodiakIntegrationService.getBalance).toHaveBeenCalledWith('test-user-id');
        });

        it('should return error when Kodiak API fails', async () => {
            const mockKodiakResult = {
                success: false,
                error: 'API connection failed'
            };

            (kodiakIntegrationService.getBalance as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getBalance('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toEqual('API connection failed');
            expect(kodiakIntegrationService.getBalance).toHaveBeenCalledWith('test-user-id');
        });

        it('should handle Kodiak API returning null data', async () => {
            const mockKodiakResult = {
                success: true,
                data: null
            };

            (kodiakIntegrationService.getBalance as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getBalance('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toContain('No balance data received');
        });

        it('should handle exceptions when calling Kodiak API', async () => {
            (kodiakIntegrationService.getBalance as jest.Mock).mockRejectedValue(new Error('Network error'));

            const result = await adapter.getBalance('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toContain('External API balance request failed');
        });
    });

    describe('getPositions', () => {
        it('should return success with domain positions when Kodiak API succeeds', async () => {
            const mockKodiakResult = {
                success: true,
                data: [
                    { symbol: 'BTC-USDC', positionAmt: '1.0', entryPrice: '50000', markPrice: '51000' },
                    { symbol: 'ETH-USDC', positionAmt: '-0.5', entryPrice: '3000', markPrice: '2900' }
                ]
            };

            (kodiakIntegrationService.getPositions as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getPositions('test-user-id');

            expect(result.success).toBe(true);
            expect(result.data).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    symbol: 'BTC-USDC',
                    side: 'LONG',
                    quantity: expect.any(Number),
                    entryPrice: expect.any(Number),
                    markPrice: expect.any(Number)
                }),
                expect.objectContaining({
                    symbol: 'ETH-USDC',
                    side: 'SHORT',
                    quantity: expect.any(Number),
                    entryPrice: expect.any(Number),
                    markPrice: expect.any(Number)
                })
            ]));
            expect(kodiakIntegrationService.getPositions).toHaveBeenCalledWith('test-user-id');
        });

        it('should return error when Kodiak API fails', async () => {
            const mockKodiakResult = {
                success: false,
                error: 'Invalid credentials'
            };

            (kodiakIntegrationService.getPositions as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getPositions('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toEqual('Invalid credentials');
        });

        it('should handle exceptions when calling Kodiak API', async () => {
            (kodiakIntegrationService.getPositions as jest.Mock).mockRejectedValue(new Error('Timeout'));

            const result = await adapter.getPositions('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toContain('External API positions request failed');
        });

        it('should return empty array when Kodiak returns no positions', async () => {
            const mockKodiakResult = {
                success: true,
                data: []
            };

            (kodiakIntegrationService.getPositions as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getPositions('test-user-id');

            expect(result.success).toBe(true);
            expect(result.data).toEqual([]);
        });
    });

    describe('getTrades', () => {
        it('should return success with domain trades when Kodiak API succeeds', async () => {
            const mockKodiakResult = {
                success: true,
                data: [
                    {
                        id: '123',
                        orderId: 'order-123',
                        symbol: 'BTC-USDC',
                        side: 'BUY',
                        price: '50000',
                        qty: '0.1',
                        commission: '0.01',
                        time: Date.now()
                    },
                    {
                        id: '456',
                        orderId: 'order-456',
                        symbol: 'ETH-USDC',
                        side: 'SELL',
                        price: '3000',
                        qty: '1.0',
                        commission: '0.005',
                        time: Date.now() - 3600000
                    }
                ]
            };

            (kodiakIntegrationService.getTrades as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getTrades('test-user-id', 50);

            expect(result.success).toBe(true);
            expect(result.data).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: '123',
                    orderId: 'order-123',
                    symbol: 'BTC-USDC',
                    side: 'BUY',
                    quantity: 0.1,
                    price: 50000
                }),
                expect.objectContaining({
                    id: '456',
                    orderId: 'order-456',
                    symbol: 'ETH-USDC',
                    side: 'SELL',
                    quantity: 1.0,
                    price: 3000
                })
            ]));
            expect(kodiakIntegrationService.getTrades).toHaveBeenCalledWith('test-user-id', 50);
        });

        it('should return error when Kodiak API fails', async () => {
            const mockKodiakResult = {
                success: false,
                error: 'API rate limit exceeded'
            };

            (kodiakIntegrationService.getTrades as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getTrades('test-user-id', 50);

            expect(result.success).toBe(false);
            expect(result.error).toEqual('API rate limit exceeded');
        });

        it('should handle exceptions when calling Kodiak API', async () => {
            (kodiakIntegrationService.getTrades as jest.Mock).mockRejectedValue(new Error('Connection reset'));

            const result = await adapter.getTrades('test-user-id', 50);

            expect(result.success).toBe(false);
            expect(result.error).toContain('External API trades request failed');
        });
    });

    describe('getAccountInfo', () => {
        it('should return success with domain account info when Kodiak API succeeds', async () => {
            const mockKodiakResult = {
                success: true,
                data: {
                    total_pnl_24_h: '50',
                    total_pnl_30_d: '150',
                    total_pnl_all: '200',
                    trading_volume_last_24_hours: '10000',
                    account_type: 'SPOT'
                }
            };

            (kodiakIntegrationService.getAccountInfo as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getAccountInfo('test-user-id');

            expect(result.success).toBe(true);
            expect(result.data).toEqual(expect.objectContaining({
                totalBalance: '0',
                totalPnl24H: '50',
                totalPnl30D: '150',
                totalPnlAll: '200',
                accountType: 'SPOT',
                balances: []
            }));
            expect(kodiakIntegrationService.getAccountInfo).toHaveBeenCalledWith('test-user-id');
        });

        it('should return error when Kodiak API fails', async () => {
            const mockKodiakResult = {
                success: false,
                error: 'Not authenticated'
            };

            (kodiakIntegrationService.getAccountInfo as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getAccountInfo('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toEqual('Not authenticated');
        });

        it('should handle Kodiak API returning null data', async () => {
            const mockKodiakResult = {
                success: true,
                data: null
            };

            (kodiakIntegrationService.getAccountInfo as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.getAccountInfo('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toContain('No account info data received');
        });

        it('should handle exceptions when calling Kodiak API', async () => {
            (kodiakIntegrationService.getAccountInfo as jest.Mock).mockRejectedValue(new Error('Server error'));

            const result = await adapter.getAccountInfo('test-user-id');

            expect(result.success).toBe(false);
            expect(result.error).toContain('External API account info request failed');
        });
    });

    describe('testConnectivity', () => {
        it('should return success when Kodiak API connectivity test passes', async () => {
            const mockKodiakResult = {
                success: true,
                error: undefined
            };

            (kodiakIntegrationService.testConnectivity as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.testConnectivity({
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key'
            });

            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
            expect(kodiakIntegrationService.testConnectivity).toHaveBeenCalledWith({
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key'
            });
        });

        it('should return error when Kodiak API connectivity test fails', async () => {
            const mockKodiakResult = {
                success: false,
                error: 'Invalid API key'
            };

            (kodiakIntegrationService.testConnectivity as jest.Mock).mockResolvedValue(mockKodiakResult);

            const result = await adapter.testConnectivity({
                accountId: 'test-account',
                apiKey: 'invalid-api-key',
                secretKey: 'test-secret-key'
            });

            expect(result.success).toBe(false);
            expect(result.error).toEqual('Invalid API key');
            expect(result.data).toBe(false);
        });

        it('should handle exceptions when testing connectivity', async () => {
            (kodiakIntegrationService.testConnectivity as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

            const result = await adapter.testConnectivity({
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key'
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Connectivity test failed');
        });
    });

    describe('invalidateUserCache', () => {
        it('should call Kodiak integration service to invalidate cache', async () => {
            (kodiakIntegrationService.invalidateUserCache as jest.Mock).mockResolvedValue(undefined);

            await adapter.invalidateUserCache('test-user-id');

            expect(kodiakIntegrationService.invalidateUserCache).toHaveBeenCalledWith('test-user-id');
        });

        it('should handle exceptions when invalidating cache', async () => {
            (kodiakIntegrationService.invalidateUserCache as jest.Mock).mockRejectedValue(new Error('Cache server error'));

            await adapter.invalidateUserCache('test-user-id');
        });
    });

    describe('validateWalletChain', () => {
        it('should return true for any wallet address and chain ID', async () => {
            const result = await adapter.validateWalletChain('0x1234567890abcdef', 1);

            expect(result).toBe(true);
        });
    });

    describe('checkNFTOwnership', () => {
        it('should return false for any wallet and contract address', async () => {
            const result = await adapter.checkNFTOwnership('0x1234567890abcdef', '0xabcdef1234567890');

            expect(result).toBe(false);
        });
    });

    describe('checkTokenBalance', () => {
        it('should return false for any wallet, token, and min amount', async () => {
            const result = await adapter.checkTokenBalance('0x1234567890abcdef', '0xabcdef1234567890', BigInt(1000));

            expect(result).toBe(false);
        });
    });
});