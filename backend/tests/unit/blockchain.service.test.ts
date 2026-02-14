/** @format */

import { BlockchainService, BlockchainBalance, TokenBalance } from '../../src/infrastructure/external/blockchain.service';
import { integrationLogger as logger } from '../../src/core/logging/context-aware-logger.service';
import { redisService } from '../../src/infrastructure/cache/redis.service';
import { ethers } from 'ethers';

// Mock dependencies - only mock what we need
jest.mock('../../src/core/logging/context-aware-logger.service', () => ({
    integrationLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
    redisLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
    cacheLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }
}));
jest.mock('../../src/infrastructure/cache/redis.service', () => ({
    redisService: {
        get: jest.fn(),
        setex: jest.fn(),
        del: jest.fn(),
    }
}));

// Mock the database pool module
jest.mock('../../src/database/pool', () => ({
    query: jest.fn()
}));

// Don't mock the entire ethers module, just specific parts
// We need ethers.isAddress to work properly for address validation
jest.spyOn(ethers, 'Contract').mockImplementation(jest.fn());

describe('BlockchainService', () => {
    let blockchainService: BlockchainService;
    const mockConfig = {
        defaultRpcUrl: 'https://testnet-rpc.example.com',
        chainId: 5, // Goerli testnet
        chainName: 'Goerli Testnet',
        nativeSymbol: 'ETH',
        cacheTtl: 60
    };

    // Mock fetch
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    beforeEach(() => {
        // Set Etherscan API key for testing
        process.env.ETHERSCAN_API_KEY = 'test-api-key';
        blockchainService = new BlockchainService(mockConfig);
        jest.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.ETHERSCAN_API_KEY;
    });

    describe('initialization', () => {
        it('should initialize with default configuration if no config provided', () => {
            const service = new BlockchainService();
            expect(service).toBeDefined();
            expect(logger.info).toHaveBeenCalled();
        });

        it('should initialize with custom configuration', () => {
            expect(blockchainService).toBeDefined();
        });
    });

    describe('getNativeBalance', () => {
        const validAddress = '0x1234567890123456789012345678901234567890';
        const invalidAddress = 'invalid-address';

        it('should throw error for invalid wallet address', async () => {
            await expect(blockchainService.getNativeBalance(invalidAddress)).rejects.toThrow(
                `Invalid wallet address format: ${invalidAddress}`
            );
        });

        it('should return cached balance when available', async () => {
            const mockBalance: BlockchainBalance = {
                address: validAddress,
                nativeBalance: '1000000000000000000',
                nativeBalanceFormatted: '1.0',
                chainId: mockConfig.chainId,
                chainName: mockConfig.chainName,
                symbol: mockConfig.nativeSymbol,
                timestamp: new Date().toISOString()
            };

            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: JSON.stringify(mockBalance)
            });

            const result = await blockchainService.getNativeBalance(validAddress);

            expect(result).toEqual(mockBalance);
            expect(redisService.get).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'Blockchain balance cache hit',
                expect.objectContaining({
                    walletAddress: validAddress
                })
            );
        });

        it('should fetch and cache balance when not in cache', async () => {
            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: null
            });

            (redisService.setex as jest.Mock).mockResolvedValue({
                success: true
            });

            // Mock Etherscan API response
            const mockEtherscanResponse = {
                status: "1",
                message: "OK",
                result: "1000000000000000000" // 1 ETH in wei
            };

            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockEtherscanResponse)
            });

            const result = await blockchainService.getNativeBalance(validAddress);

            expect(result.address).toEqual(validAddress);
            expect(parseFloat(result.nativeBalanceFormatted)).toBeGreaterThan(0);
            expect(redisService.get).toHaveBeenCalled();
            expect(redisService.setex).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'Fetching blockchain balance from Etherscan API',
                expect.objectContaining({
                    walletAddress: validAddress
                })
            );
        });

        it('should handle errors when fetching balance', async () => {
            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: null
            });

            const mockError = new Error('Etherscan API error: 500 Internal Server Error');
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            await expect(blockchainService.getNativeBalance(validAddress)).rejects.toThrow(
                `Failed to get balance for ${validAddress}`
            );
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('getTokenBalance', () => {
        const validWalletAddress = '0x1234567890123456789012345678901234567890';
        const validTokenAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
        const invalidAddress = 'invalid-address';

        it('should throw error for invalid wallet address', async () => {
            await expect(blockchainService.getTokenBalance(invalidAddress, validTokenAddress)).rejects.toThrow(
                `Invalid wallet address format: ${invalidAddress}`
            );
        });

        it('should throw error for invalid token address', async () => {
            await expect(blockchainService.getTokenBalance(validWalletAddress, invalidAddress)).rejects.toThrow(
                `Invalid token address format: ${invalidAddress}`
            );
        });

        it('should return cached token balance when available', async () => {
            const mockTokenBalance: TokenBalance = {
                address: validWalletAddress,
                tokenAddress: validTokenAddress,
                tokenSymbol: 'USDC',
                tokenBalance: '1000000',
                tokenBalanceFormatted: '1.0',
                decimals: 6
            };

            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: JSON.stringify(mockTokenBalance)
            });

            const result = await blockchainService.getTokenBalance(validWalletAddress, validTokenAddress, 6);

            expect(result).toEqual(mockTokenBalance);
            expect(redisService.get).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'Blockchain token balance cache hit',
                expect.objectContaining({
                    walletAddress: validWalletAddress,
                    tokenAddress: validTokenAddress
                })
            );
        });

        it('should fetch and cache token balance when not in cache', async () => {
            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: null
            });

            (redisService.setex as jest.Mock).mockResolvedValue({
                success: true
            });

            // Mock Etherscan token transactions API response
            const mockEtherscanResponse = {
                status: "1",
                message: "OK",
                result: [
                    {
                        blockNumber: "123456",
                        timeStamp: "1620000000",
                        hash: "0xabc123...",
                        nonce: "0",
                        blockHash: "0xdef456...",
                        from: "0x1111111111111111111111111111111111111111",
                        contractAddress: validTokenAddress,
                        to: validWalletAddress,
                        value: "1000000", // 1 USDC (6 decimals)
                        tokenName: "USD Coin",
                        tokenSymbol: "USDC",
                        tokenDecimal: "6",
                        transactionIndex: "0",
                        gas: "21000",
                        gasPrice: "20000000000",
                        gasUsed: "21000",
                        cumulativeGasUsed: "21000",
                        input: "0x",
                        methodId: "0x",
                        functionName: "",
                        confirmations: "100"
                    },
                    {
                        blockNumber: "123457",
                        timeStamp: "1620000001",
                        hash: "0xabc124...",
                        nonce: "1",
                        blockHash: "0xdef457...",
                        from: validWalletAddress,
                        contractAddress: validTokenAddress,
                        to: "0x2222222222222222222222222222222222222222",
                        value: "500000", // 0.5 USDC (6 decimals)
                        tokenName: "USD Coin",
                        tokenSymbol: "USDC",
                        tokenDecimal: "6",
                        transactionIndex: "1",
                        gas: "21000",
                        gasPrice: "20000000000",
                        gasUsed: "21000",
                        cumulativeGasUsed: "42000",
                        input: "0x",
                        methodId: "0x",
                        functionName: "",
                        confirmations: "99"
                    }
                ]
            };

            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockEtherscanResponse)
            });

            const result = await blockchainService.getTokenBalance(validWalletAddress, validTokenAddress, 6);

            expect(result.address).toEqual(validWalletAddress);
            expect(result.tokenAddress).toEqual(validTokenAddress);
            expect(parseFloat(result.tokenBalanceFormatted)).toBeCloseTo(0.5); // 1 - 0.5 = 0.5 USDC
            expect(redisService.get).toHaveBeenCalled();
            expect(redisService.setex).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'Fetching token balance from blockchain',
                expect.objectContaining({
                    walletAddress: validWalletAddress,
                    tokenAddress: validTokenAddress
                })
            );
        });

        it('should handle errors when fetching token balance', async () => {
            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: null
            });

            const mockError = new Error('Etherscan API request failed with status: 500');
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            await expect(blockchainService.getTokenBalance(validWalletAddress, validTokenAddress)).rejects.toThrow(
                `Failed to get token balance for ${validWalletAddress}`
            );
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('checkHealth', () => {
        it('should return healthy status when API is reachable', async () => {
            // Mock Etherscan API response
            const mockEtherscanResponse = {
                status: "1",
                message: "OK",
                result: "0"
            };

            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockEtherscanResponse)
            });

            const result = await blockchainService.checkHealth();

            expect(result.healthy).toBe(true);
            expect(result.error).toBeUndefined();
            expect(logger.debug).toHaveBeenCalledWith(
                'Blockchain service health check successful',
                expect.objectContaining({
                    chainId: mockConfig.chainId
                })
            );
        });

        it('should return unhealthy status when API is unreachable', async () => {
            const mockError = new Error('Etherscan API request failed with status: 503');
            mockFetch.mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable'
            });

            const result = await blockchainService.checkHealth();

            expect(result.healthy).toBe(false);
            expect(result.error).toContain('503');
            expect(logger.error).toHaveBeenCalledWith(
                'Blockchain service health check failed',
                expect.any(Error),
                expect.objectContaining({
                    chainId: mockConfig.chainId
                })
            );
        });
    });

    describe('invalidateUserCache', () => {
        it('should invalidate user cache for valid wallet address', async () => {
            const userId = 'test-user-123';
            const walletAddress = '0x1234567890123456789012345678901234567890';

            (redisService.del as jest.Mock).mockResolvedValue({
                success: true
            });

            await blockchainService.invalidateUserCache(userId, walletAddress);

            expect(redisService.del).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'Blockchain cache invalidated for user',
                expect.objectContaining({
                    userId,
                    walletAddress
                })
            );
        });

        it('should handle errors when invalidating cache', async () => {
            const userId = 'test-user-123';
            const walletAddress = '0x1234567890123456789012345678901234567890';

            (redisService.del as jest.Mock).mockRejectedValue(new Error('Redis connection failed'));

            // Should not throw error
            await expect(blockchainService.invalidateUserCache(userId, walletAddress)).resolves.not.toThrow();
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('getUserWalletAddress', () => {
        it('should return null if no verified wallet address found', async () => {
            const poolModule = await import('../../src/database/pool');
            (poolModule.query as jest.Mock).mockResolvedValue({ rows: [] });

            const result = await blockchainService.getUserWalletAddress('550e8400-e29b-41d4-a716-446655440000');

            expect(result).toBeNull();
            expect(logger.debug).toHaveBeenCalledWith(
                'No wallet address found for user',
                expect.objectContaining({
                    userId: '550e8400-e29b-41d4-a716-446655440000'
                })
            );
        });

        it('should return null if wallet address is invalid format', async () => {
            const poolModule = await import('../../src/database/pool');
            (poolModule.query as jest.Mock).mockResolvedValue({ rows: [{ wallet_address: 'invalid-wallet-address' }] });

            const result = await blockchainService.getUserWalletAddress('550e8400-e29b-41d4-a716-446655440000');

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                'Invalid wallet address format in database',
                expect.objectContaining({
                    userId: '550e8400-e29b-41d4-a716-446655440000'
                })
            );
        });

        it('should return valid wallet address from database', async () => {
            const validAddress = '0x1234567890123456789012345678901234567890';
            const poolModule = await import('../../src/database/pool');
            (poolModule.query as jest.Mock).mockResolvedValue({ rows: [{ wallet_address: validAddress }] });

            const result = await blockchainService.getUserWalletAddress('550e8400-e29b-41d4-a716-446655440000');

            expect(result).toEqual(validAddress);
            expect(logger.debug).toHaveBeenCalledWith(
                'Wallet address retrieved from database',
                expect.objectContaining({
                    userId: '550e8400-e29b-41d4-a716-446655440000',
                    walletAddress: validAddress
                })
            );
        });

        it('should handle database query errors', async () => {
            const poolModule = await import('../../src/database/pool');
            (poolModule.query as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

            await expect(blockchainService.getUserWalletAddress('550e8400-e29b-41d4-a716-446655440000')).rejects.toThrow(
                `Failed to get wallet address for user 550e8400-e29b-41d4-a716-446655440000`
            );
            expect(logger.error).toHaveBeenCalled();
        });
    });
});