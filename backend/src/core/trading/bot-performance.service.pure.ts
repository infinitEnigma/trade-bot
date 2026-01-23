/**
 * Pure Bot Performance Service - Clean Architecture Implementation
 *
 * Business logic for bot performance tracking with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - ICacheService: Caching abstraction for performance data
 * - ILogger: Logging abstraction
 * - IBotPerformanceRepository: Performance data access abstraction
 *
 * @format
 */

import {
    ILogger,
    ICacheService,
    CacheResult
} from '@trade-bot/shared';

// Bot performance repository interface (to be implemented)
export interface IBotPerformanceRepository {
    recordTrade(tradeData: {
        botId: string;
        symbol: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        price: number;
        pnl: number;
        fee: number;
        timestamp: number;
    }): Promise<boolean>;

    getTrades(botId: string, timeframe: '1h' | '24h' | '7d' | '30d'): Promise<any[]>;

    getAllTrades(userId: string): Promise<any[]>;

    getBotStats(botId: string): Promise<{
        totalTrades: number;
        totalVolume: number;
        totalPnl: number;
        winTrades: number;
        lossTrades: number;
        firstTrade: number;
        lastTrade: number;
    } | null>;
}

export interface BotPerformanceServiceDependencies {
    botPerformanceRepository: IBotPerformanceRepository;
    cache: ICacheService;
    logger: ILogger;
}

/**
 * Legacy Bot Performance Response - For API compatibility during migration
 */
export interface LegacyBotPerformance {
    totalTrades: number;
    totalVolume: number;
    totalPnl: number;
    winRate: number;
    averageTrade: number;
    sharpeRatio?: number;
    maxDrawdown: number;
}

/**
 * Pure Bot Performance Service
 *
 * Implements bot performance business logic using dependency injection.
 * No direct dependencies on databases, Redis, or external systems.
 */
export class BotPerformanceService {
    private readonly CACHE_TTL = 600; // 10 minutes for performance data
    private readonly CACHE_PREFIX = 'bot:perf';

    constructor(private deps: BotPerformanceServiceDependencies) { }

    /**
     * Record trade execution for performance tracking
     *
     * Business Logic:
     * 1. Validate trade data
     * 2. Calculate derived metrics (PnL, fees)
     * 3. Store trade in repository
     * 4. Invalidate performance caches
     * 5. Log performance event
     */
    async recordTrade(tradeData: {
        botId: string;
        symbol: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        price: number;
        pnl: number;
        fee: number;
        timestamp: number;
    }): Promise<void> {
        try {
            this.deps.logger.debug('Recording trade for performance tracking', {
                botId: tradeData.botId,
                symbol: tradeData.symbol,
                pnl: tradeData.pnl
            });

            // Validate trade data
            this.validateTradeData(tradeData);

            // Record trade in repository
            const success = await this.deps.botPerformanceRepository.recordTrade(tradeData);
            if (!success) {
                throw new Error('Failed to record trade in repository');
            }

            // Invalidate performance caches for this bot
            await this.invalidateBotPerformanceCache(tradeData.botId);

            this.deps.logger.info('Trade recorded successfully', {
                botId: tradeData.botId,
                symbol: tradeData.symbol,
                pnl: tradeData.pnl,
                fee: tradeData.fee
            });

        } catch (error) {
            this.deps.logger.error('Failed to record trade', {
                botId: tradeData.botId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get bot performance metrics
     *
     * Business Logic:
     * 1. Check cache first for performance
     * 2. Query trades for the timeframe
     * 3. Calculate performance metrics
     * 4. Cache result for future requests
     * 5. Return formatted metrics
     */
    async getBotPerformance(botId: string, timeframe: '1h' | '24h' | '7d' | '30d'): Promise<LegacyBotPerformance | null> {
        try {
            const cacheKey = `${this.CACHE_PREFIX}:${botId}:${timeframe}`;

            // Try cache first
            const cachedResult: CacheResult<any> = await this.deps.cache.get(cacheKey);
            if (cachedResult.success && cachedResult.data) {
                this.deps.logger.debug('Bot performance cache hit', { botId, timeframe });
                return this.shouldReturnLegacyFormat()
                    ? this.convertToLegacyFormat(cachedResult.data)
                    : cachedResult.data;
            }

            // Cache miss - calculate performance
            this.deps.logger.debug('Bot performance cache miss, calculating', { botId, timeframe });

            const trades = await this.deps.botPerformanceRepository.getTrades(botId, timeframe);
            if (trades.length === 0) {
                // Cache empty result for short time
                await this.deps.cache.setex(cacheKey, 60, null); // 1 minute
                return null;
            }

            const performance = this.calculatePerformanceMetrics(trades);

            // Cache the result
            const cacheResult = await this.deps.cache.setex(cacheKey, this.CACHE_TTL, performance);
            if (!cacheResult.success) {
                this.deps.logger.warn('Failed to cache bot performance', {
                    botId,
                    timeframe,
                    error: cacheResult.error
                });
            }

            this.deps.logger.debug('Bot performance calculated and cached', {
                botId,
                timeframe,
                totalTrades: performance.totalTrades,
                totalPnl: performance.totalPnl
            });

            return this.shouldReturnLegacyFormat()
                ? this.convertToLegacyFormat(performance)
                : performance;

        } catch (error) {
            this.deps.logger.error('Failed to get bot performance', {
                botId,
                timeframe,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Get performance summary for multiple bots
     *
     * Business Logic:
     * 1. Query all trades for user's bots
     * 2. Group by bot and calculate metrics
     * 3. Identify best/worst performing bots
     * 4. Return aggregated summary
     */
    async getPerformanceSummary(userId: string): Promise<{
        totalBots: number;
        activeBots: number;
        totalPnl: number;
        totalVolume: number;
        bestPerformingBot: string;
        worstPerformingBot: string;
    }> {
        try {
            this.deps.logger.debug('Getting performance summary', { userId });

            const allTrades = await this.deps.botPerformanceRepository.getAllTrades(userId);
            if (allTrades.length === 0) {
                return {
                    totalBots: 0,
                    activeBots: 0,
                    totalPnl: 0,
                    totalVolume: 0,
                    bestPerformingBot: '',
                    worstPerformingBot: ''
                };
            }

            // Group trades by bot
            const botGroups = this.groupTradesByBot(allTrades);

            let totalPnl = 0;
            let totalVolume = 0;
            let bestBot = '';
            let worstBot = '';
            let bestPnl = -Infinity;
            let worstPnl = Infinity;

            for (const [botId, trades] of Object.entries(botGroups)) {
                const metrics = this.calculatePerformanceMetrics(trades);
                totalPnl += metrics.totalPnl;
                totalVolume += metrics.totalVolume;

                if (metrics.totalPnl > bestPnl) {
                    bestPnl = metrics.totalPnl;
                    bestBot = botId;
                }

                if (metrics.totalPnl < worstPnl) {
                    worstPnl = metrics.totalPnl;
                    worstBot = botId;
                }
            }

            const summary = {
                totalBots: Object.keys(botGroups).length,
                activeBots: Object.keys(botGroups).length, // Assume all are active if they have trades
                totalPnl,
                totalVolume,
                bestPerformingBot: bestBot,
                worstPerformingBot: worstBot
            };

            this.deps.logger.debug('Performance summary calculated', summary);
            return summary;

        } catch (error) {
            this.deps.logger.error('Failed to get performance summary', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Calculate risk metrics for bot
     *
     * Business Logic:
     * - Calculate volatility from trade returns
     * - Compute maximum drawdown
     * - Estimate Value at Risk (VaR)
     * - Calculate Expected Shortfall (ES)
     */
    async calculateRiskMetrics(botId: string): Promise<{
        volatility: number;
        maxDrawdown: number;
        valueAtRisk: number;
        expectedShortfall: number;
    }> {
        try {
            this.deps.logger.debug('Calculating risk metrics', { botId });

            // Get all trades for comprehensive risk analysis
            const trades = await this.deps.botPerformanceRepository.getTrades(botId, '30d');
            if (trades.length < 10) {
                // Need minimum trades for meaningful risk metrics
                return {
                    volatility: 0,
                    maxDrawdown: 0,
                    valueAtRisk: 0,
                    expectedShortfall: 0
                };
            }

            // Calculate daily returns
            const dailyReturns = this.calculateDailyReturns(trades);

            // Calculate volatility (standard deviation of returns)
            const volatility = this.calculateVolatility(dailyReturns);

            // Calculate maximum drawdown
            const maxDrawdown = this.calculateMaxDrawdown(trades);

            // Calculate Value at Risk (95% confidence, 1-day)
            const valueAtRisk = this.calculateValueAtRisk(dailyReturns, 0.95);

            // Calculate Expected Shortfall (95% confidence)
            const expectedShortfall = this.calculateExpectedShortfall(dailyReturns, 0.95);

            const riskMetrics = {
                volatility,
                maxDrawdown,
                valueAtRisk,
                expectedShortfall
            };

            this.deps.logger.debug('Risk metrics calculated', { botId, ...riskMetrics });
            return riskMetrics;

        } catch (error) {
            this.deps.logger.error('Failed to calculate risk metrics', {
                botId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Calculate performance metrics from trades
     */
    private calculatePerformanceMetrics(trades: any[]): {
        totalTrades: number;
        totalVolume: number;
        totalPnl: number;
        winRate: number;
        averageTrade: number;
        sharpeRatio?: number;
        maxDrawdown: number;
    } {
        const totalTrades = trades.length;
        const totalVolume = trades.reduce((sum, trade) => sum + (trade.quantity * trade.price), 0);
        const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);

        const winningTrades = trades.filter(trade => trade.pnl > 0);
        const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
        const averageTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;

        // Calculate Sharpe ratio (requires daily returns)
        const dailyReturns = this.calculateDailyReturns(trades);
        const sharpeRatio = dailyReturns.length > 1 ? this.calculateSharpeRatio(dailyReturns) : undefined;

        // Calculate maximum drawdown
        const maxDrawdown = this.calculateMaxDrawdown(trades);

        return {
            totalTrades,
            totalVolume,
            totalPnl,
            winRate,
            averageTrade,
            sharpeRatio,
            maxDrawdown
        };
    }

    /**
     * Calculate daily returns from trades
     */
    private calculateDailyReturns(trades: any[]): number[] {
        // Group trades by day and calculate daily PnL
        const dailyPnL = new Map<string, number>();

        for (const trade of trades) {
            const day = new Date(trade.timestamp).toISOString().split('T')[0];
            dailyPnL.set(day, (dailyPnL.get(day) || 0) + trade.pnl);
        }

        return Array.from(dailyPnL.values());
    }

    /**
     * Calculate volatility (standard deviation of returns)
     */
    private calculateVolatility(returns: number[]): number {
        if (returns.length < 2) return 0;

        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
        return Math.sqrt(variance);
    }

    /**
     * Calculate Sharpe ratio
     */
    private calculateSharpeRatio(returns: number[]): number {
        if (returns.length < 2) return 0;

        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const volatility = this.calculateVolatility(returns);

        // Assume risk-free rate of 0 for simplicity
        return volatility > 0 ? avgReturn / volatility : 0;
    }

    /**
     * Calculate maximum drawdown
     */
    private calculateMaxDrawdown(trades: any[]): number {
        if (trades.length === 0) return 0;

        // Sort trades by timestamp
        const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

        let peak = sortedTrades[0].pnl;
        let maxDrawdown = 0;
        let runningTotal = sortedTrades[0].pnl;

        for (let i = 1; i < sortedTrades.length; i++) {
            runningTotal += sortedTrades[i].pnl;
            if (runningTotal > peak) {
                peak = runningTotal;
            }
            const drawdown = peak - runningTotal;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }

        return maxDrawdown;
    }

    /**
     * Calculate Value at Risk (VaR) at given confidence level
     */
    private calculateValueAtRisk(returns: number[], confidenceLevel: number): number {
        if (returns.length < 10) return 0;

        // Sort returns in ascending order
        const sortedReturns = [...returns].sort((a, b) => a - b);
        const index = Math.floor((1 - confidenceLevel) * sortedReturns.length);
        return Math.abs(sortedReturns[index]);
    }

    /**
     * Calculate Expected Shortfall (ES) at given confidence level
     */
    private calculateExpectedShortfall(returns: number[], confidenceLevel: number): number {
        if (returns.length < 10) return 0;

        const varValue = this.calculateValueAtRisk(returns, confidenceLevel);
        const tailLosses = returns.filter(r => r <= -varValue);
        return tailLosses.length > 0
            ? Math.abs(tailLosses.reduce((sum, r) => sum + r, 0) / tailLosses.length)
            : varValue;
    }

    /**
     * Group trades by bot ID
     */
    private groupTradesByBot(trades: any[]): Record<string, any[]> {
        return trades.reduce((groups, trade) => {
            if (!groups[trade.botId]) {
                groups[trade.botId] = [];
            }
            groups[trade.botId].push(trade);
            return groups;
        }, {} as Record<string, any[]>);
    }

    /**
     * Validate trade data
     */
    private validateTradeData(tradeData: {
        botId: string;
        symbol: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        price: number;
        pnl: number;
        fee: number;
        timestamp: number;
    }): void {
        if (!tradeData.botId || !tradeData.symbol) {
            throw new Error('Bot ID and symbol are required');
        }

        if (tradeData.quantity <= 0 || tradeData.price <= 0) {
            throw new Error('Quantity and price must be positive');
        }

        if (!['BUY', 'SELL'].includes(tradeData.side)) {
            throw new Error('Side must be BUY or SELL');
        }

        if (tradeData.timestamp <= 0) {
            throw new Error('Valid timestamp is required');
        }
    }

    /**
     * Invalidate cached performance data for a bot
     */
    private async invalidateBotPerformanceCache(botId: string): Promise<void> {
        // Invalidate all timeframe caches for this bot
        const timeframes = ['1h', '24h', '7d', '30d'];
        const cachePromises = timeframes.map(timeframe => {
            const cacheKey = `${this.CACHE_PREFIX}:${botId}:${timeframe}`;
            return this.deps.cache.delete(cacheKey);
        });

        await Promise.all(cachePromises);

        this.deps.logger.debug('Bot performance caches invalidated', { botId });
    }

    /**
     * Check if legacy API format should be returned
     */
    private shouldReturnLegacyFormat(): boolean {
        return process.env.LEGACY_TRADING_API === 'true';
    }

    /**
     * Convert performance data to legacy format
     */
    private convertToLegacyFormat(performance: any): LegacyBotPerformance {
        return {
            totalTrades: performance.totalTrades,
            totalVolume: performance.totalVolume,
            totalPnl: performance.totalPnl,
            winRate: performance.winRate,
            averageTrade: performance.averageTrade,
            sharpeRatio: performance.sharpeRatio,
            maxDrawdown: performance.maxDrawdown
        };
    }
}

// Export factory function for creating service instances
export function createBotPerformanceService(deps: BotPerformanceServiceDependencies): BotPerformanceService {
    return new BotPerformanceService(deps);
}