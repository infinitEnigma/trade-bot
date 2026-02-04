/**
 * External API Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IExternalApiService interface using the existing Kodiak integration service.
 * This adapter provides a clean abstraction layer for external API operations,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    IExternalApiService,
    ApiResult,
    Balance,
    Position,
    Trade,
    AccountInfo,
    ExternalCredentials,
    OrderStatus,
    OrderSide
} from '@trade-bot/shared';
import { kodiakIntegrationService } from '../../../infrastructure/external/kodiak-integration.service';
import { logger } from '../../../core/logging';
import {
    KodiakBalance,
    KodiakPosition,
    KodiakTrade,
    KodiakAccountInfo,
    KodiakApiAccountInfoResponse
} from '../../../infrastructure/external/kodiak-integration.service';
import {
    mapKodiakBalanceToDomain,
    mapKodiakPositionToDomain,
    mapKodiakTradeToDomain,
    mapKodiakAccountInfoToDomain
} from './kodiak.mappers';

/**
 * External API Adapter
 *
 * Implements the IExternalApiService interface using the existing Kodiak integration service.
 * Provides a clean abstraction layer for external exchange API operations.
 */
export class ExternalApiAdapter implements IExternalApiService {

    /**
     * Get user balance from external exchange
     */
    async getBalance(userId: string): Promise<ApiResult<Balance>> {
        try {
            const kodiakResult = await kodiakIntegrationService.getBalance(userId);

            if (!kodiakResult.success) {
                return {
                    success: false,
                    error: kodiakResult.error || 'Failed to get balance from external API',
                    timestamp: Date.now()
                };
            }

            // Convert Kodiak balance format to domain Balance
            const kodiakBalance = kodiakResult.data;
            if (!kodiakBalance) {
                logger.warn('Kodiak balance data is null or undefined', { userId });
                return {
                    success: false,
                    error: 'No balance data received from external API',
                    timestamp: Date.now()
                };
            }
            const domainBalance = mapKodiakBalanceToDomain(kodiakBalance);

            return {
                success: true,
                data: domainBalance,
                timestamp: Date.now()
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `External API balance request failed: ${errorMessage}`,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Get user positions from external exchange
     */
    async getPositions(userId: string): Promise<ApiResult<Position[]>> {
        try {
            const kodiakResult = await kodiakIntegrationService.getPositions(userId);

            if (!kodiakResult.success) {
                return {
                    success: false,
                    error: kodiakResult.error || 'Failed to get positions from external API',
                    timestamp: Date.now()
                };
            }

            // Convert Kodiak positions to domain Position objects
            // kodiakResult.data is already an array of positions
            const kodiakPositions = Array.isArray(kodiakResult.data) ? kodiakResult.data : [];
            const domainPositions = kodiakPositions
                .map(mapKodiakPositionToDomain)
                .filter((pos): pos is Position => pos !== null);

            return {
                success: true,
                data: domainPositions,
                timestamp: Date.now()
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `External API positions request failed: ${errorMessage}`,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Get user trade history from external exchange
     */
    async getTrades(userId: string, limit: number = 50): Promise<ApiResult<Trade[]>> {
        try {
            const kodiakResult = await kodiakIntegrationService.getTrades(userId, limit);

            if (!kodiakResult.success) {
                return {
                    success: false,
                    error: kodiakResult.error || 'Failed to get trades from external API',
                    timestamp: Date.now()
                };
            }

            // Convert Kodiak trades to domain Trade objects
            const kodiakTrades = Array.isArray(kodiakResult.data) ? kodiakResult.data : [];
            const domainTrades = kodiakTrades
                .map(mapKodiakTradeToDomain)
                .filter((trade): trade is Trade => trade !== null);

            return {
                success: true,
                data: domainTrades,
                timestamp: Date.now()
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `External API trades request failed: ${errorMessage}`,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Get account information from external exchange
     */
    async getAccountInfo(userId: string): Promise<ApiResult<AccountInfo>> {
        try {
            const kodiakResult = await kodiakIntegrationService.getAccountInfo(userId);

            if (!kodiakResult.success) {
                return {
                    success: false,
                    error: kodiakResult.error || 'Failed to get account info from external API',
                    timestamp: Date.now()
                };
            }

            // Convert Kodiak account info to domain AccountInfo
            const kodiakAccountInfoResponse = kodiakResult.data as KodiakApiAccountInfoResponse | undefined;
            if (!kodiakAccountInfoResponse) {
                logger.warn('Kodiak account info data is null or undefined', { userId });
                return {
                    success: false,
                    error: 'No account info data received from external API',
                    timestamp: Date.now()
                };
            }

            // Convert KodiakApiAccountInfoResponse to KodiakAccountInfo
            const kodiakAccountInfo: KodiakAccountInfo = {
                totalBalance: '0', // Not available in account info response
                totalPnl24H: kodiakAccountInfoResponse.total_pnl_24_h || '0',
                totalPnl30D: kodiakAccountInfoResponse.total_pnl_30_d || '0',
                totalPnlAll: kodiakAccountInfoResponse.total_pnl_all || '0',
                tradingVolume24H: kodiakAccountInfoResponse.trading_volume_last_24_hours || '0',
                accountType: kodiakAccountInfoResponse.account_type || 'UNKNOWN',
                balances: [] // Not available in account info response
            };

            const domainAccountInfo = mapKodiakAccountInfoToDomain(kodiakAccountInfo);

            return {
                success: true,
                data: domainAccountInfo,
                timestamp: Date.now()
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `External API account info request failed: ${errorMessage}`,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Test connectivity to external API
     */
    async testConnectivity(credentials: ExternalCredentials): Promise<ApiResult<boolean>> {
        try {
            // Convert domain credentials to Kodiak format
            const kodiakCredentials = {
                accountId: credentials.accountId,
                apiKey: credentials.apiKey,
                secretKey: credentials.secretKey
            };

            const result = await kodiakIntegrationService.testConnectivity(kodiakCredentials);

            return {
                success: result.success,
                data: result.success,
                error: result.error,
                timestamp: Date.now()
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Connectivity test failed: ${errorMessage}`,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Invalidate cached data for a user
     */
    async invalidateUserCache(userId: string): Promise<void> {
        try {
            await kodiakIntegrationService.invalidateUserCache(userId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(`Cache invalidation failed: ${errorMessage}`);
            // Don't throw - cache invalidation failures shouldn't break business logic
        }
    }

    /**
     * Validate wallet is connected to correct chain
     */
    async validateWalletChain(walletAddress: string, chainId: number): Promise<boolean> {
        try {
            // For now, assume all wallets are on correct chain
            // In production, this would query the blockchain RPC
            logger.debug("Wallet chain validation", { walletAddress, requiredChain: chainId });
            return true; // Placeholder - implement actual chain validation
        } catch (error) {
            logger.error("Wallet chain validation failed", { walletAddress, error: (error as Error).message });
            return false;
        }
    }

    /**
     * Check NFT ownership
     */
    async checkNFTOwnership(walletAddress: string, contractAddress: string): Promise<boolean> {
        try {
            // Placeholder implementation
            // In production, this would use ethers.js or web3.js to query NFT contract
            logger.debug("Checking NFT ownership", { walletAddress, contractAddress });
            return false; // Placeholder - implement actual NFT checking
        } catch (error) {
            logger.error("NFT ownership check failed", {
                walletAddress,
                contractAddress,
                error: (error as Error).message
            });
            return false;
        }
    }

    /**
     * Check token balance
     */
    async checkTokenBalance(walletAddress: string, tokenAddress: string, minAmount: bigint): Promise<boolean> {
        try {
            // Placeholder implementation
            // In production, this would use ethers.js to query ERC-20 contract
            logger.debug("Checking token balance", { walletAddress, tokenAddress, minAmount: minAmount.toString() });
            return false; // Placeholder - implement actual token balance checking
        } catch (error) {
            logger.error("Token balance check failed", {
                walletAddress,
                tokenAddress,
                error: (error as Error).message
            });
            return false;
        }
    }

}

// Export singleton instance
export const externalApiAdapter = new ExternalApiAdapter();