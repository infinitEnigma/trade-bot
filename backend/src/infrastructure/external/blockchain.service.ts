/**
 * Blockchain Service
 *
 * Handles blockchain interactions including wallet balance fetching,
 * token balance queries, and chain-specific operations using ethers.js.
 * Provides centralized blockchain connectivity for the application.
 */

import { ethers } from "ethers";
import { integrationLogger as logger } from "../../core/logging/context-aware-logger.service";
import { redisService } from "../cache/redis.service";

// Etherscan API response interfaces
interface EtherscanBalanceResponse {
    status: string;
    message: string;
    result: string;
}

interface EtherscanTokenTransaction {
    blockNumber: string;
    timeStamp: string;
    hash: string;
    nonce: string;
    blockHash: string;
    from: string;
    contractAddress: string;
    to: string;
    value: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimal: string;
    transactionIndex: string;
    gas: string;
    gasPrice: string;
    gasUsed: string;
    cumulativeGasUsed: string;
    input: string;
    methodId: string;
    functionName: string;
    confirmations: string;
}

interface EtherscanTokenTransactionsResponse {
    status: string;
    message: string;
    result: EtherscanTokenTransaction[];
}

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
    etherscanApiKey: string;
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

    constructor(config: Partial<BlockchainServiceConfig> = {}) {
        // Set default configuration with fallback values
        this.config = {
            etherscanApiKey: config.etherscanApiKey || process.env.ETHERSCAN_API_KEY || "your-etherscan-key",
            chainId: config.chainId || 80094, // Default to specified chain (80094)
            chainName: config.chainName || "Ethereum Mainnet",
            nativeSymbol: config.nativeSymbol || "ETH",
            cacheTtl: config.cacheTtl || 60, // 60 seconds cache
        };

        logger.info("Blockchain service initialized", {
            chainId: this.config.chainId,
            chainName: this.config.chainName,
            apiKey: this.config.etherscanApiKey.includes("your-etherscan-key") ? "default" : "custom",
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

            logger.debug("Fetching blockchain balance from Etherscan API", {
                walletAddress,
            });

            // Fetch balance from Etherscan API
            const apiUrl = `https://api.etherscan.io/v2/api?apikey=${this.config.etherscanApiKey}&chainid=${this.config.chainId}&module=account&action=balance&address=${walletAddress}&tag=latest`;

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Etherscan API request failed with status: ${response.status}`);
            }

            const data = await response.json() as EtherscanBalanceResponse;

            if (data.status !== "1" || !data.result) {
                throw new Error(`Etherscan API error: ${data.message || "Unknown error"}`);
            }

            // Balance is returned in wei
            const balance = data.result;
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
            logger.error("Failed to get blockchain balance", error as Error, {
                walletAddress,
                chainId: this.config.chainId,
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

            // Fetch token transaction history from Etherscan API
            const apiUrl = `https://api.etherscan.io/v2/api?apikey=${this.config.etherscanApiKey}&chainid=${this.config.chainId}&module=account&action=tokentx&contractaddress=${tokenAddress}&address=${walletAddress}`;

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Etherscan API request failed with status: ${response.status}`);
            }

            const data = await response.json() as EtherscanTokenTransactionsResponse;

            if (data.status !== "1" || !Array.isArray(data.result)) {
                throw new Error(`Etherscan API error: ${data.message || "Unknown error"}`);
            }

            // Calculate token balance from transactions
            let balance = BigInt(0);
            let tokenSymbol = "UNKNOWN";
            let tokenDecimals = decimals;

            for (const tx of data.result) {
                // Extract token info from first transaction (assuming all transactions are for same token)
                if (!tokenSymbol && tx.tokenSymbol) {
                    tokenSymbol = tx.tokenSymbol;
                }
                if (tx.tokenDecimal) {
                    tokenDecimals = parseInt(tx.tokenDecimal);
                }

                // Calculate balance by adding incoming and subtracting outgoing transfers
                const txValue = BigInt(tx.value);

                if (tx.to.toLowerCase() === walletAddress.toLowerCase()) {
                    // Incoming transfer
                    balance += txValue;
                } else if (tx.from.toLowerCase() === walletAddress.toLowerCase()) {
                    // Outgoing transfer
                    balance -= txValue;
                }
            }

            // Ensure balance can't be negative (shouldn't happen with valid data)
            if (balance < BigInt(0)) {
                balance = BigInt(0);
            }

            const balanceFormatted = ethers.formatUnits(balance, tokenDecimals);

            const result: TokenBalance = {
                address: walletAddress,
                tokenAddress,
                tokenSymbol: tokenSymbol,
                tokenBalance: balance.toString(),
                tokenBalanceFormatted: balanceFormatted,
                decimals: tokenDecimals,
            };

            // Cache the result
            await redisService.setex(cacheKey, this.config.cacheTtl, JSON.stringify(result));

            logger.debug("Token balance calculated and cached", {
                walletAddress,
                tokenAddress,
                balance: balanceFormatted,
                symbol: tokenSymbol,
                chainId: this.config.chainId,
            });

            return result;
        } catch (error) {
            logger.error("Failed to get token balance", error as Error, {
                walletAddress,
                tokenAddress,
                chainId: this.config.chainId,
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
            logger.error("Failed to get user wallet address", error as Error, {
                userId,
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
            logger.error("Failed to invalidate blockchain cache", error as Error, {
                userId,
                walletAddress,
            });
        }
    }

    /**
     * Check if blockchain service is healthy
     */
    async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
        try {
            // Test connection by making a simple API call (we'll use the same balance endpoint with a test address)
            // Note: This is a placeholder TODO: use a dedicated health check endpoint
            const testAddress = "0x0000000000000000000000000000000000000000";
            const apiUrl = `https://api.etherscan.io/v2/api?apikey=${this.config.etherscanApiKey}&chainid=${this.config.chainId}&module=account&action=balance&address=${testAddress}&tag=latest`;

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Etherscan API request failed with status: ${response.status}`);
            }

            const data = await response.json() as EtherscanBalanceResponse;

            if (data.status !== "1") {
                throw new Error(`Etherscan API error: ${data.message || "Unknown error"}`);
            }

            logger.debug("Blockchain service health check successful", {
                chainId: this.config.chainId,
            });
            return { healthy: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Blockchain service health check failed", new Error(errorMessage), {
                chainId: this.config.chainId,
            });
            return { healthy: false, error: errorMessage };
        }
    }
}

// Export the class for on-demand instantiation
// Note: Do NOT export a singleton instance to avoid unnecessary initialization
// Export a factory function instead for on-demand creation
export function createBlockchainService(config: Partial<BlockchainServiceConfig> = {}): BlockchainService {
    return new BlockchainService(config);
}
