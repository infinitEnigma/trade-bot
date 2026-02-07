/**
 * Blockchain Service
 *
 * Handles blockchain interactions including wallet balance fetching,
 * token balance queries, and chain-specific operations using ethers.js.
 * Provides centralized blockchain connectivity for the application.
 */

import { ethers } from "ethers";
import logger from "../../core/logging/logger.service";
import { redisService } from "../cache/redis.service";

export interface BlockchainBalance {
    address: string;
    nativeBalance: string; // In wei
    nativeBalanceFormatted: string; // In ETH
    chainId: number;
    chainName: string;
    symbol: string;
    timestamp: string;
}

export interface TokenBalance {
    address: string;
    tokenAddress: string;
    tokenSymbol: string;
    tokenBalance: string; // In smallest units
    tokenBalanceFormatted: string; // In human-readable format
    decimals: number;
}

export interface BlockchainServiceConfig {
    defaultRpcUrl: string;
    chainId: number;
    chainName: string;
    nativeSymbol: string;
    cacheTtl: number;
}

/**
 * Blockchain Service
 */
export class BlockchainService {
    private config: BlockchainServiceConfig;
    private provider: ethers.JsonRpcProvider;

    constructor(config: Partial<BlockchainServiceConfig> = {}) {
        // Set default configuration with fallback values
        this.config = {
            defaultRpcUrl: config.defaultRpcUrl || process.env.BLOCKCHAIN_RPC_URL || `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY || "your-infura-key"}`,
            chainId: config.chainId || 1, // Mainnet by default
            chainName: config.chainName || "Ethereum Mainnet",
            nativeSymbol: config.nativeSymbol || "ETH",
            cacheTtl: config.cacheTtl || 60, // 60 seconds cache
        };

        // Initialize ethers provider
        this.provider = new ethers.JsonRpcProvider(this.config.defaultRpcUrl);

        // Log provider errors for debugging
        this.provider.on("error", (error) => {
            logger.error("Blockchain provider error", {
                error: error.message,
                chainId: this.config.chainId,
                chainName: this.config.chainName,
            });
        });

        logger.info("Blockchain service initialized", {
            chainId: this.config.chainId,
            chainName: this.config.chainName,
            rpcUrl: this.config.defaultRpcUrl.includes("your-infura-key") ? "default-infura" : "custom",
        });
    }

    /**
     * Validate wallet address format
     */
    private isValidWalletAddress(address: string): boolean {
        return ethers.isAddress(address);
    }

    /**
     * Get native token balance for a wallet address
     */
    async getNativeBalance(walletAddress: string): Promise<BlockchainBalance> {
        try {
            // Validate wallet address format
            if (!this.isValidWalletAddress(walletAddress)) {
                throw new Error(`Invalid wallet address format: ${walletAddress}`);
            }

            const cacheKey = `blockchain:balance:${this.config.chainId}:${walletAddress}`;

            // Check cache first
            const cachedResult = await redisService.get(cacheKey);
            if (cachedResult.success && cachedResult.data) {
                logger.debug("Blockchain balance cache hit", {
                    walletAddress,
                    chainId: this.config.chainId,
                });
                return JSON.parse(cachedResult.data);
            }

            logger.debug("Fetching blockchain balance from RPC", {
                walletAddress,
            });

            // Fetch balance from blockchain
            const balance = await this.provider.getBalance(walletAddress);
            const balanceFormatted = ethers.formatEther(balance);

            const result: BlockchainBalance = {
                address: walletAddress,
                nativeBalance: balance.toString(),
                nativeBalanceFormatted: balanceFormatted,
                chainId: this.config.chainId,
                chainName: this.config.chainName,
                symbol: this.config.nativeSymbol,
                timestamp: new Date().toISOString(),
            };

            // Cache the result
            await redisService.setex(cacheKey, this.config.cacheTtl, JSON.stringify(result));

            logger.debug("Blockchain balance fetched and cached", {
                walletAddress,
                balance: balanceFormatted,
                chainId: this.config.chainId,
            });

            return result;
        } catch (error) {
            logger.error("Failed to get blockchain balance", {
                walletAddress,
                chainId: this.config.chainId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw new Error(`Failed to get balance for ${walletAddress}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get token balance for a wallet address
     */
    async getTokenBalance(walletAddress: string, tokenAddress: string, decimals: number = 18): Promise<TokenBalance> {
        try {
            // Validate addresses
            if (!this.isValidWalletAddress(walletAddress)) {
                throw new Error(`Invalid wallet address format: ${walletAddress}`);
            }
            if (!this.isValidWalletAddress(tokenAddress)) {
                throw new Error(`Invalid token address format: ${tokenAddress}`);
            }

            const cacheKey = `blockchain:token:${this.config.chainId}:${walletAddress}:${tokenAddress}`;

            // Check cache first
            const cachedResult = await redisService.get(cacheKey);
            if (cachedResult.success && cachedResult.data) {
                logger.debug("Blockchain token balance cache hit", {
                    walletAddress,
                    tokenAddress,
                    chainId: this.config.chainId,
                });
                return JSON.parse(cachedResult.data);
            }

            logger.debug("Fetching token balance from blockchain", {
                walletAddress,
                tokenAddress,
                chainId: this.config.chainId,
            });

            // Create token contract instance
            const tokenAbi = [
                "function balanceOf(address owner) view returns (uint256)",
                "function symbol() view returns (string)",
                "function decimals() view returns (uint8)",
            ];

            const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, this.provider);

            // Get balance and token info
            const [balance, symbol] = await Promise.all([
                tokenContract.balanceOf(walletAddress),
                tokenContract.symbol(),
            ]);

            const balanceFormatted = ethers.formatUnits(balance, decimals);

            const result: TokenBalance = {
                address: walletAddress,
                tokenAddress,
                tokenSymbol: symbol,
                tokenBalance: balance.toString(),
                tokenBalanceFormatted: balanceFormatted,
                decimals,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.config.cacheTtl, JSON.stringify(result));

            logger.debug("Token balance fetched and cached", {
                walletAddress,
                tokenAddress,
                balance: balanceFormatted,
                symbol,
                chainId: this.config.chainId,
            });

            return result;
        } catch (error) {
            logger.error("Failed to get token balance", {
                walletAddress,
                tokenAddress,
                chainId: this.config.chainId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw new Error(`Failed to get token balance for ${walletAddress}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get wallet address from database for a user
     */
    async getUserWalletAddress(userId: string): Promise<string | null> {
        try {
            const { query } = await import("../../database/pool");

            const result = await query<{
                wallet_address: string;
            }>(
                "SELECT wallet_address FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );

            if (result.rows.length === 0 || !result.rows[0].wallet_address) {
                logger.debug("No wallet address found for user", { userId });
                return null;
            }

            const walletAddress = result.rows[0].wallet_address;

            // Validate the wallet address
            if (!this.isValidWalletAddress(walletAddress)) {
                logger.warn("Invalid wallet address format in database", {
                    userId,
                    walletAddress,
                });
                return null;
            }

            logger.debug("Wallet address retrieved from database", {
                userId,
                walletAddress,
            });

            return walletAddress;
        } catch (error) {
            logger.error("Failed to get user wallet address", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw new Error(`Failed to get wallet address for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Invalidate cached blockchain data for a user
     */
    async invalidateUserCache(userId: string, walletAddress: string): Promise<void> {
        try {
            const cacheKeys = [
                `blockchain:balance:${this.config.chainId}:${walletAddress}`,
                // Add more cache keys as needed for tokens, etc.
            ];

            for (const cacheKey of cacheKeys) {
                await redisService.del(cacheKey);
            }

            logger.debug("Blockchain cache invalidated for user", {
                userId,
                walletAddress,
                chainId: this.config.chainId,
            });
        } catch (error) {
            logger.warn("Failed to invalidate blockchain cache", {
                userId,
                walletAddress,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Check if blockchain service is healthy
     */
    async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
        try {
            // Test connection by getting latest block
            const blockNumber = await this.provider.getBlockNumber();
            logger.debug("Blockchain service health check successful", {
                blockNumber,
                chainId: this.config.chainId,
            });
            return { healthy: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Blockchain service health check failed", {
                error: errorMessage,
                chainId: this.config.chainId,
            });
            return { healthy: false, error: errorMessage };
        }
    }
}

// Export singleton instance with default configuration
export const blockchainService = new BlockchainService();
