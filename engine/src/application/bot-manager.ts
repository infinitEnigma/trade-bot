/**
 * Bot Manager
 *
 * Manages the lifecycle of trading bots.
 * Coordinates command handling, strategy execution, and event publishing.
 *
 * @format
 */

import { BotActualState, BotCommand, StartBotCommandPayload, StopBotCommandPayload } from '@trade-bot/shared';
import { v4 as uuidv4 } from 'uuid';
import { GridTradingStrategy } from '../strategies/grid';
import { createOrderlyClient, OrderlyClient } from '../exchanges/kodiak/client';
import { RedisStreamOperations } from '../infrastructure/redis/streams';
import { logger } from '../utils/logger';
import { BotRuntime, FetchCredentialsResult, EngineIdentity } from '../domain/bot-runtime';
import { publishEvent, publishAccepted, publishFailed } from '../protocol/event-publisher';
import { fetchCredentials } from '../protocol/credential-fetcher';

const TICK_INTERVAL_MS = 5000;

export class BotManager {
    private bots: Map<string, BotRuntime> = new Map();
    private initializing: Set<string> = new Set();
    private stopRequested: Set<string> = new Set();
    private engineId: string;
    private epoch: number;

    constructor(identity: EngineIdentity) {
        this.engineId = identity.engineId;
        this.epoch = identity.epoch;
        logger.info('BotManager initialized', { engineId: this.engineId, epoch: this.epoch });
    }

    get activeBotIds(): string[] {
        return Array.from(this.bots.keys());
    }

    hasBot(botId: string): boolean {
        return this.bots.has(botId);
    }

    isInitializing(botId: string): boolean {
        return this.initializing.has(botId);
    }

    isStopRequested(botId: string): boolean {
        return this.stopRequested.has(botId);
    }

    /**
     * Request cancellation of a bot being initialized.
     */
    requestStop(botId: string): void {
        this.stopRequested.add(botId);
    }

    /**
     * Get all active bot runtimes.
     */
    getBotRuntimes(): Map<string, BotRuntime> {
        return this.bots;
    }

    /**
     * Publish a state change event for a bot.
     */
    async publishStateChanged(
        streamOps: RedisStreamOperations,
        botId: string,
        from: BotActualState,
        to: BotActualState,
        correlationId: string,
        reason?: string
    ): Promise<void> {
        await publishEvent(streamOps, 'STATE_CHANGED', {
            botId,
            engineId: this.engineId,
            engineEpoch: this.epoch,
            from,
            to,
            reason: reason || '',
        }, correlationId);
    }

    /**
     * Publish COMMAND_ACCEPTED.
     */
    async publishAccepted(
        streamOps: RedisStreamOperations,
        botId: string,
        commandType: string,
        correlationId: string
    ): Promise<void> {
        await publishAccepted(streamOps, botId, commandType, this.engineId, this.epoch, correlationId);
    }

    /**
     * Publish COMMAND_FAILED.
     */
    async publishFailed(
        streamOps: RedisStreamOperations,
        botId: string,
        commandType: string,
        errorCode: string,
        message: string,
        correlationId: string
    ): Promise<void> {
        await publishFailed(streamOps, botId, commandType, this.engineId, this.epoch, errorCode, message, correlationId);
    }

    /**
     * Handle BOT_START command.
     */
    async handleStart(
        streamOps: RedisStreamOperations,
        botId: string,
        userId: string,
        strategyId: string,
        config: Record<string, unknown>,
        correlationId: string
    ): Promise<void> {
        // Race guard
        if (this.initializing.has(botId) || this.bots.has(botId)) {
            logger.warn('Bot already initializing or running', { botId });
            await this.publishFailed(streamOps, botId, 'BOT_START', 'BOT_ALREADY_RUNNING', 'Bot is already running', correlationId);
            return;
        }
        this.initializing.add(botId);
        try {
            await this.doStartBot(streamOps, botId, userId, strategyId, config, correlationId);
        } finally {
            this.initializing.delete(botId);
        }
    }

    /**
     * Handle BOT_STOP command.
     */
    async handleStop(
        streamOps: RedisStreamOperations,
        botId: string,
        correlationId: string
    ): Promise<void> {
        const existing = this.bots.get(botId);
        if (!existing) {
            logger.warn('Bot not found for stop', { botId });
            await this.publishFailed(streamOps, botId, 'BOT_STOP', 'BOT_NOT_FOUND', 'Bot not found', correlationId);
            return;
        }
        await this.publishStateChanged(streamOps, botId, 'RUNNING', 'STOPPING', correlationId, 'normal_stop');
        try {
            await existing.strategy.stop();
        } catch (error) {
            logger.error('Strategy stop error', { botId, error: error instanceof Error ? error.message : String(error) });
        }
        existing.stopTick();
        this.bots.delete(botId);
        await this.publishStateChanged(streamOps, botId, 'STOPPING', 'STOPPED', correlationId, 'normal_stop');
    }

    /**
     * Core bot initialization.
     */
    private async doStartBot(
        streamOps: RedisStreamOperations,
        botId: string,
        userId: string,
        strategyId: string,
        config: Record<string, unknown>,
        correlationId: string
    ): Promise<void> {
        let tickTimeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanupTick = (): void => {
            if (tickTimeoutId) {
                clearTimeout(tickTimeoutId);
                tickTimeoutId = null;
            }
        };

        try {
            await this.publishStateChanged(streamOps, botId, 'STOPPED', 'STARTING', correlationId);
            this.throwIfCancelled(botId);

            // 1. Fetch credentials
            const credentials = await fetchCredentials(botId, correlationId);
            this.throwIfCancelled(botId);

            // 2. Connect Orderly client
            const orderlyClient = createOrderlyClient(
                credentials.accountId,
                credentials.accessKey,
                credentials.secretKey,
                process.env.NODE_ENV !== 'production'
            );

            // 3. Get market price
            const symbol = String(config.symbol || '');
            if (!symbol) {
                throw new Error('Strategy config is missing symbol');
            }
            this.throwIfCancelled(botId);
            const ticker = await orderlyClient.getTicker(symbol);
            this.throwIfCancelled(botId);
            const currentPrice = Number(ticker.mark_price || ticker.price);
            if (!currentPrice) {
                throw new Error(`Could not resolve current price for ${symbol}`);
            }

            // 4. Create and start strategy
            const gridStrategy = new GridTradingStrategy(
                {
                    symbol,
                    gridSize: Number(config.gridSize) || 10,
                    gridRangePercent: Number(config.gridRange) || 5,
                    orderQuantity: Number(config.orderQuantity) || 1,
                },
                orderlyClient
            );
            await gridStrategy.initialize(currentPrice);
            this.throwIfCancelled(botId);
            await gridStrategy.start();
            this.throwIfCancelled(botId);

            // 5. Trading loop
            let tickRunning = false;
            const scheduleTick = (): void => {
                if (tickTimeoutId) clearTimeout(tickTimeoutId);
                tickTimeoutId = setTimeout(async () => {
                    if (tickRunning) {
                        logger.warn('Previous tick still running, skipping', { botId });
                        scheduleTick();
                        return;
                    }
                    tickRunning = true;
                    try {
                        await gridStrategy!.tick();
                    } catch (error) {
                        logger.error('Strategy tick error', { botId, error: error instanceof Error ? error.message : String(error) });
                    } finally {
                        tickRunning = false;
                    }
                    if (this.bots.has(botId)) scheduleTick();
                }, TICK_INTERVAL_MS);
            };
            scheduleTick();

            // Register bot
            this.bots.set(botId, {
                botId,
                strategyId,
                userId,
                state: 'RUNNING',
                strategy: gridStrategy,
                stopTick: cleanupTick,
                orderlyClient,
            });

            await this.publishStateChanged(streamOps, botId, 'STARTING', 'RUNNING', correlationId, 'started');
        } catch (error) {
            cleanupTick();
            this.bots.delete(botId);
            const err = error instanceof Error ? error : new Error(String(error));
            await this.publishFailed(streamOps, botId, 'BOT_START', 'INIT_FAILED', err.message, correlationId);
            await this.publishStateChanged(streamOps, botId, 'STARTING', 'ERROR', correlationId, err.message);
            throw error;
        }
    }

    private throwIfCancelled(botId: string): void {
        if (this.stopRequested.has(botId)) {
            this.stopRequested.delete(botId);
            throw new Error('Bot initialization cancelled');
        }
    }
}
