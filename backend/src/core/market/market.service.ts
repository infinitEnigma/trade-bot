/**
 * Market Service
 *
 * Handles market-related operations including price updates, Kodiak credentials verification,
 * and market data retrieval. Provides centralized market data management.
 *
 * @format
 */

import logger from "../../core/logging/logger.service";
import { IKodiakCredentialsRepository } from "@trade-bot/shared";
import { kodiakCredentialsRepositoryAdapter } from "../../infrastructure/adapters/repositories/kodiak-credentials-repository.adapter";

export interface MarketServiceDependencies {
    kodiakCredentialsRepository: IKodiakCredentialsRepository;
}

export class MarketService {
    constructor(private deps: MarketServiceDependencies) { }

    /**
     * Check if user has verified Kodiak credentials
     */
    async hasUserKodiakCredentials(userId: string): Promise<boolean> {
        try {
            const credentials = await this.deps.kodiakCredentialsRepository.getCredentials(userId);
            return !!credentials && credentials.verified;
        } catch (error) {
            logger.error("Failed to check user Kodiak credentials", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return false;
        }
    }

    /**
     * Get market prices for symbols
     */
    async getMarketPrices(symbols: string[] = []): Promise<any[]> {
        try {
            // For now, return mock price data
            const mockPrices = [
                { symbol: 'BTC/USDT', price: 50000, change24h: 2.5 },
                { symbol: 'ETH/USDT', price: 3000, change24h: -1.2 },
                { symbol: 'SOL/USDT', price: 100, change24h: 5.8 },
                { symbol: 'ADA/USDT', price: 0.5, change24h: -0.8 }
            ];

            // Filter by symbols if provided
            const filteredPrices = symbols.length > 0
                ? mockPrices.filter(p => symbols.includes(p.symbol))
                : mockPrices;

            logger.debug("Market prices retrieved successfully", {
                count: filteredPrices.length,
                symbols
            });

            return filteredPrices;
        } catch (error) {
            logger.error("Failed to get market prices", {
                error: error instanceof Error ? error.message : String(error),
                symbols
            });
            throw new Error("Failed to get market prices");
        }
    }

    /**
     * Get available trading pairs
     */
    async getAvailableTradingPairs(): Promise<any[]> {
        try {
            // For now, return mock trading pairs
            const tradingPairs = [
                { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', status: 'ACTIVE' },
                { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', status: 'ACTIVE' },
                { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', status: 'ACTIVE' },
                { symbol: 'ADA/USDT', base: 'ADA', quote: 'USDT', status: 'ACTIVE' },
                { symbol: 'DOT/USDT', base: 'DOT', quote: 'USDT', status: 'ACTIVE' }
            ];

            logger.debug("Trading pairs retrieved successfully", {
                count: tradingPairs.length
            });

            return tradingPairs;
        } catch (error) {
            logger.error("Failed to get trading pairs", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error("Failed to get trading pairs");
        }
    }

    /**
     * Get market depth for a symbol
     */
    async getMarketDepth(symbol: string, limit: number = 20): Promise<any> {
        try {
            // For now, return mock market depth data
            const bids = [];
            const asks = [];
            const basePrice = symbol === 'BTC/USDT' ? 50000 : 3000;

            for (let i = 1; i <= limit; i++) {
                bids.push({
                    price: basePrice - (i * 0.1),
                    quantity: Math.random() * 10
                });

                asks.push({
                    price: basePrice + (i * 0.1),
                    quantity: Math.random() * 10
                });
            }

            const marketDepth = {
                symbol,
                bids: bids.sort((a, b) => b.price - a.price),
                asks: asks.sort((a, b) => a.price - b.price)
            };

            logger.debug("Market depth retrieved successfully", {
                symbol,
                bidCount: marketDepth.bids.length,
                askCount: marketDepth.asks.length
            });

            return marketDepth;
        } catch (error) {
            logger.error("Failed to get market depth", {
                error: error instanceof Error ? error.message : String(error),
                symbol
            });
            throw new Error("Failed to get market depth");
        }
    }
}

// Export factory function for creating service instances
export function createMarketService(deps: MarketServiceDependencies): MarketService {
    return new MarketService(deps);
}

// Legacy singleton instance for backward compatibility
export const marketService = createMarketService({
    kodiakCredentialsRepository: kodiakCredentialsRepositoryAdapter
});