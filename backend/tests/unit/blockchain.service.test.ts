/** @format */

import { BlockchainService, BlockchainBalance, TokenBalance } from '../../src/infrastructure/external/blockchain.service';
import logger from '../../src/core/logging/logger.service';
import { redisService } from '../../src/infrastructure/cache/redis.service';
import { ethers } from 'ethers';

// Mock dependencies - only mock what we need
jest.mock('../../src/core/logging/logger.service');
jest.mock('../../src/infrastructure/cache/redis.service');

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

    beforeEach(() => {
        blockchainService = new BlockchainService(mockConfig);
        jest.clearAllMocks();
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

            // Mock ethers provider balance call
            const mockProvider = (blockchainService as any).provider;
            mockProvider.getBalance = jest.fn().mockResolvedValue(BigInt('1000000000000000000'));

            const result = await blockchainService.getNativeBalance(validAddress);

            expect(result.address).toEqual(validAddress);
            expect(parseFloat(result.nativeBalanceFormatted)).toBeGreaterThan(0);
            expect(redisService.get).toHaveBeenCalled();
            expect(redisService.setex).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'Fetching blockchain balance from RPC',
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

            const mockError = new Error('RPC connection failed');
            const mockProvider = (blockchainService as any).provider;
            mockProvider.getBalance = jest.fn().mockRejectedValue(mockError);

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

            // Mock the ethers contract
            const mockContract = {
                balanceOf: jest.fn().mockResolvedValue(BigInt('1000000')),
                symbol: jest.fn().mockResolvedValue('USDC')
            };

            (ethers.Contract as jest.Mock).mockReturnValue(mockContract);

            const result = await blockchainService.getTokenBalance(validWalletAddress, validTokenAddress, 6);

            expect(result.address).toEqual(validWalletAddress);
            expect(result.tokenAddress).toEqual(validTokenAddress);
            expect(parseFloat(result.tokenBalanceFormatted)).toBeGreaterThan(0);
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

            const mockError = new Error('Contract call failed');
            const mockContract = {
                balanceOf: jest.fn().mockRejectedValue(mockError),
                symbol: jest.fn().mockRejectedValue(mockError)
            };

            (ethers.Contract as jest.Mock).mockReturnValue(mockContract);

            await expect(blockchainService.getTokenBalance(validWalletAddress, validTokenAddress)).rejects.toThrow(
                `Failed to get token balance for ${validWalletAddress}`
            );
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('checkHealth', () => {
        it('should return healthy status when RPC is reachable', async () => {
            const mockProvider = (blockchainService as any).provider;
            mockProvider.getBlockNumber = jest.fn().mockResolvedValue(1234567);

            const result = await blockchainService.checkHealth();

            expect(result.healthy).toBe(true);
            expect(result.error).toBeUndefined();
            expect(logger.debug).toHaveBeenCalledWith(
                'Blockchain service health check successful',
                expect.objectContaining({
                    blockNumber: 1234567
                })
            );
        });

        it('should return unhealthy status when RPC is unreachable', async () => {
            const mockError = new Error('RPC connection timeout');
            const mockProvider = (blockchainService as any).provider;
            mockProvider.getBlockNumber = jest.fn().mockRejectedValue(mockError);

            const result = await blockchainService.checkHealth();

            expect(result.healthy).toBe(false);
            expect(result.error).toEqual(mockError.message);
            expect(logger.error).toHaveBeenCalledWith(
                'Blockchain service health check failed',
                expect.objectContaining({
                    error: mockError.message
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
            expect(logger.warn).toHaveBeenCalled();
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