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
    AccountInfo,
    ExternalCredentials
} from '../../../../../shared';
import { Trade } from '../../../../../shared/src/types/infrastructure';
import { kodiakIntegrationService } from '../../../infrastructure/external/kodiak-integration.service';

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
            const kodiakBalance = kodiakResult.data!;
            const domainBalance = this.convertKodiakBalanceToDomain(kodiakBalance);

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
                .map(this.convertKodiakPositionToDomain)
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
                .map(this.convertKodiakTradeToDomain)
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
            const kodiakAccountInfo = kodiakResult.data!;
            const domainAccountInfo = this.convertKodiakAccountInfoToDomain(kodiakAccountInfo);

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
            console.warn(`Cache invalidation failed: ${errorMessage}`);
            // Don't throw - cache invalidation failures shouldn't break business logic
        }
    }

    /**
     * Convert Kodiak balance format to domain Balance
     */
    private convertKodiakBalanceToDomain(kodiakBalance: any): Balance {
        try {
            // Extract USD balance (assuming USD is the base currency)
            const usdBalance = kodiakBalance.balances?.find((b: any) => b.asset === 'USDC' || b.asset === 'USD');
            const totalBalance = usdBalance ? parseFloat(usdBalance.free || '0') : 0;

            // For simplicity, assume all balance is available (locked amounts would need separate tracking)
            return Balance.fromTotal(totalBalance, 'USD');
        } catch (error) {
            console.warn('Failed to convert Kodiak balance to domain format, using zero balance');
            return Balance.zero('USD');
        }
    }

    /**
     * Convert Kodiak position format to domain Position
     */
    private convertKodiakPositionToDomain(kodiakPosition: any): Position | null {
        try {
            const symbol = kodiakPosition.symbol;
            const side = kodiakPosition.positionAmt && parseFloat(kodiakPosition.positionAmt) > 0 ? 'LONG' : 'SHORT';
            const quantity = Math.abs(parseFloat(kodiakPosition.positionAmt || kodiakPosition.position_qty || '0'));
            const entryPrice = parseFloat(kodiakPosition.entryPrice || kodiakPosition.average_open_price || '0');
            const markPrice = parseFloat(kodiakPosition.markPrice || '0');
            const leverage = parseFloat(kodiakPosition.leverage || '1');

            if (!symbol || quantity === 0 || entryPrice === 0) {
                return null; // Invalid position data
            }

            return new Position(
                symbol,
                side,
                quantity,
                entryPrice,
                markPrice,
                leverage
            );
        } catch (error) {
            console.warn(`Failed to convert Kodiak position to domain format: ${error}`);
            return null;
        }
    }

    /**
     * Convert Kodiak trade format to Trade interface
     */
    private convertKodiakTradeToDomain(kodiakTrade: any): Trade | null {
        try {
            const id = kodiakTrade.id || kodiakTrade.orderId;
            const userId = 'unknown'; // User ID not available in trade data
            const orderId = kodiakTrade.orderId || id;
            const symbol = kodiakTrade.symbol;
            const side = kodiakTrade.side === 'BUY' ? 'BUY' : 'SELL';
            const quantity = parseFloat(kodiakTrade.qty || '0');
            const price = parseFloat(kodiakTrade.price || '0');
            const fee = parseFloat(kodiakTrade.commission || '0');
            const executedAt = new Date(kodiakTrade.time || Date.now());

            if (!id || !symbol || quantity === 0 || price === 0) {
                return null; // Invalid trade data
            }

            // Return plain object matching Trade interface, not domain class
            return {
                id,
                userId,
                orderId,
                symbol,
                side,
                quantity,
                price,
                fee,
                pnl: undefined, // PnL not available in basic trade data
                status: 'COMPLETED', // External trades are completed
                executedAt
            };
        } catch (error) {
            console.warn(`Failed to convert Kodiak trade to domain format: ${error}`);
            return null;
        }
    }

    /**
     * Convert Kodiak account info to domain AccountInfo
     */
    private convertKodiakAccountInfoToDomain(kodiakAccountInfo: any): AccountInfo {
        try {
            return {
                totalBalance: kodiakAccountInfo.totalBalance || '0',
                totalPnl24H: kodiakAccountInfo.totalPnl24H || '0',
                totalPnl30D: kodiakAccountInfo.totalPnl30D || '0',
                totalPnlAll: kodiakAccountInfo.totalPnlAll || '0',
                accountType: kodiakAccountInfo.accountType || 'UNKNOWN',
                balances: kodiakAccountInfo.balances || []
            };
        } catch (error) {
            console.warn('Failed to convert Kodiak account info to domain format');
            return {
                totalBalance: '0',
                totalPnl24H: '0',
                totalPnl30D: '0',
                totalPnlAll: '0',
                accountType: 'UNKNOWN',
                balances: []
            };
        }
    }
}

// Export singleton instance
export const externalApiAdapter = new ExternalApiAdapter();