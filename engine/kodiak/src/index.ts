import 'dotenv/config';
import { logger } from './utils/logger';
import {
    getRedisStreamOperations,
    ENGINE_COMMANDS_STREAM,
    ENGINE_EVENTS_STREAM,
    ENGINE_COMMANDS_CONSUMER_GROUP,
} from './infrastructure/redis/streams';
import {
    BotActualState,
    BotCommand,
    BotEvent,
    BotEventType,
    EngineEvent,
    StartBotCommandPayload,
    createBotEvent,
    isBotCommand,
    isStartBotCommand,
    isStopBotCommand,
    isStatusRequestCommand,
} from '@trade-bot/shared';
import { GridTradingStrategy } from './strategies/grid';
import { OrderlyClient, createOrderlyClient } from './services/orderly';

// ===========================================
// CONFIGURATION
// ===========================================

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const BOT_ENGINE_API_KEY = process.env.BOT_ENGINE_API_KEY || '';
const TICK_INTERVAL_MS = 5000;

/** Bounded size for the command deduplication set (at-least-once delivery). */
const DEDUP_SET_MAX_SIZE = 10_000;

// ===========================================
// BOT RUNTIME
// ===========================================

interface BotRuntime {
    botId: string;
    strategyId: string;
    userId: string;
    state: BotActualState;
    strategy: GridTradingStrategy;
    intervalId: NodeJS.Timeout;
    orderlyClient: OrderlyClient;
}

interface FetchCredentialsResult {
    accountId: string;
    accessKey: string;
    secretKey: string;
}

/**
 * Out-of-band credential fetch: after COMMAND_ACCEPTED the engine pulls the
 * user's Kodiak credentials from the authenticated backend endpoint.
 * Secrets never travel through the Redis Streams control plane.
 */
async function fetchCredentials(botId: string, correlationId: string): Promise<FetchCredentialsResult> {
    if (!BOT_ENGINE_API_KEY) {
        throw new Error('BOT_ENGINE_API_KEY not configured');
    }
    const url = `${BACKEND_URL}/api/bot/engine/credentials/${encodeURIComponent(botId)}?correlationId=${encodeURIComponent(correlationId)}`;
    const response = await fetch(url, { headers: { 'x-bot-engine-key': BOT_ENGINE_API_KEY } });
    if (!response.ok) {
        throw new Error(`Credential fetch failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as { success: boolean; data?: FetchCredentialsResult; error?: string };
    if (!body.success || !body.data) {
        throw new Error(body.error || 'Credential fetch returned no data');
    }
    return body.data;
}

// === PART 2 (BotManager) appended below ===
// ===========================================
// BOT MANAGER
// ===========================================

class BotManager {
    private bots: Map<string, BotRuntime> = new Map();
    private initializing = new Set<string>();
    private processedMessageIds: Set<string> = new Set();
    private streamOperations: ReturnType<typeof getRedisStreamOperations>;
    readonly engineId: string;

    constructor() {
        this.streamOperations = getRedisStreamOperations();
        this.engineId = 'kodiak-engine-' + Math.random().toString(36).substring(2, 11);
    }

    /**
     * Publish a protocol event to the backend.
     */
    private async publishEvent(type: BotEventType, payload: Record<string, unknown>, correlationId: string): Promise<void> {
        const event: BotEvent = createBotEvent(type, payload as never, correlationId);
        const result = await this.streamOperations.publish(ENGINE_EVENTS_STREAM, event as unknown as EngineEvent);
        if (!result.success) {
            logger.error('Failed to publish engine event', { type, botId: (payload as { botId?: string }).botId, error: result.error });
        }
    }

    private async publishAccepted(botId: string, commandType: string, correlationId: string): Promise<void> {
        await this.publishEvent('COMMAND_ACCEPTED', { botId, commandType, engineId: this.engineId }, correlationId);
    }

    private async publishFailed(botId: string, commandType: string, correlationId: string, errorCode: string, message: string): Promise<void> {
        await this.publishEvent('COMMAND_FAILED', { botId, commandType, engineId: this.engineId, errorCode, message }, correlationId);
    }

    private async publishStateChanged(botId: string, from: BotActualState, to: BotActualState, correlationId: string, reason?: string): Promise<void> {
        await this.publishEvent('STATE_CHANGED', { botId, engineId: this.engineId, from, to, reason }, correlationId);
    }

    /**
     * Handle one command envelope. Never throws: failures are reported via
     * COMMAND_FAILED / STATE_CHANGED events so the message can be acked.
     */
    async handleCommand(command: BotCommand): Promise<void> {
        // Deduplicate redelivered commands (at-least-once delivery).
        if (this.processedMessageIds.has(command.messageId)) {
            logger.debug('Duplicate command ignored', { messageId: command.messageId, type: command.type });
            return;
        }

        try {
            if (isStartBotCommand(command)) {
                await this.handleStart(command);
            } else if (isStopBotCommand(command)) {
                await this.handleStop(command);
            } else if (isStatusRequestCommand(command)) {
                await this.handleStatusRequest(command);
            } else {
                logger.warn('Unknown command type', { type: String((command as { type?: string }).type) });
            }

            this.processedMessageIds.add(command.messageId);
            if (this.processedMessageIds.size > DEDUP_SET_MAX_SIZE) {
                this.processedMessageIds = new Set(Array.from(this.processedMessageIds).slice(-DEDUP_SET_MAX_SIZE / 2));
            }
        } catch (error) {
            logger.error('Unexpected error handling command', {
                commandType: command.type,
                botId: (command.payload as { botId?: string }).botId,
                error: error instanceof Error ? error.message : String(error),
            });
            this.processedMessageIds.add(command.messageId);
        }
    }

    /**
     * BOT_START: START -> COMMAND_ACCEPTED -> STARTING -> (init) -> RUNNING
     */
    private async handleStart(command: BotCommand): Promise<void> {
        const { botId, strategyId, userId, config } = command.payload as StartBotCommandPayload;
        const correlationId = command.correlationId;

        await this.publishAccepted(botId, 'BOT_START', correlationId);

        // Idempotency: never create a second trading loop for a running bot.
        const existing = this.bots.get(botId);
        if (existing && existing.state === 'RUNNING') {
            logger.info('Start command for already-running bot - no-op', { botId });
            await this.publishStateChanged(botId, 'RUNNING', 'RUNNING', correlationId);
            return;
        }
        if (this.initializing.has(botId)) {
            logger.info('Start command while initialization in flight - no-op', { botId });
            return;
        }

        this.initializing.add(botId);
        try {
            await this.publishStateChanged(botId, 'STOPPED', 'STARTING', correlationId);

            // 1. Fetch credentials out-of-band.
            const credentials = await fetchCredentials(botId, correlationId);

            // 2. Connect an Orderly client for this user.
            const orderlyClient = createOrderlyClient(credentials.accountId, credentials.accessKey, credentials.secretKey, process.env.NODE_ENV !== 'production');

            // 3. Resolve current market price.
            const symbol = String(config.symbol || '');
            if (!symbol) {
                throw new Error('Strategy config is missing symbol');
            }
            const ticker = await orderlyClient.getTicker(symbol);
            const currentPrice = Number(ticker.mark_price || ticker.price);
            if (!currentPrice) {
                throw new Error(`Could not resolve current price for ${symbol}`);
            }

            // 4. Create, initialize and start the strategy.
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
            await gridStrategy.start();

            // 5. Trading loop.
            const intervalId = setInterval(() => {
                void gridStrategy.tick().catch(error => {
                    logger.error('Strategy tick error', { botId, error: error instanceof Error ? error.message : String(error) });
                });
            }, TICK_INTERVAL_MS);

            this.bots.set(botId, {
                botId,
                strategyId,
                userId,
                state: 'RUNNING',
                strategy: gridStrategy,
                intervalId,
                orderlyClient,
            });

            await this.publishStateChanged(botId, 'STARTING', 'RUNNING', correlationId);
            logger.info('Bot started', { botId, symbol, engineId: this.engineId });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('Bot start failed', { botId, error: message });
            await this.publishFailed(botId, 'BOT_START', correlationId, 'BOT_START_FAILED', message);
            await this.publishStateChanged(botId, 'STARTING', 'ERROR', correlationId, 'init_failed');
        } finally {
            this.initializing.delete(botId);
        }
    }

    // === PART 3 (stop/status/loop/shutdown) appended below ===

    /**
     * BOT_STOP: -> COMMAND_ACCEPTED -> STOPPING -> (teardown) -> STOPPED
     */
    private async handleStop(command: BotCommand): Promise<void> {
        const botId = (command.payload as { botId: string }).botId;
        const correlationId = command.correlationId;

        await this.publishAccepted(botId, 'BOT_STOP', correlationId);

        const existing = this.bots.get(botId);
        if (!existing) {
            // Idempotency: stopping an unknown/stopped bot is a safe no-op.
            logger.info('Stop command for unknown bot - no-op', { botId });
            await this.publishStateChanged(botId, 'STOPPED', 'STOPPED', correlationId, 'not_running');
            return;
        }

        await this.publishStateChanged(botId, 'RUNNING', 'STOPPING', correlationId, 'normal_stop');
        try {
            await existing.strategy.stop();
        } catch (error) {
            logger.error('Strategy stop error during bot stop', { botId, error: error instanceof Error ? error.message : String(error) });
        }
        clearInterval(existing.intervalId);
        this.bots.delete(botId);

        await this.publishStateChanged(botId, 'STOPPING', 'STOPPED', correlationId, 'normal_stop');
        logger.info('Bot stopped', { botId, engineId: this.engineId });
    }

    /**
     * BOT_STATUS_REQUEST: reply with the bot's state snapshot.
     */
    private async handleStatusRequest(command: BotCommand): Promise<void> {
        const botId = (command.payload as { botId: string }).botId;
        const existing = this.bots.get(botId);
        const actualState: BotActualState = existing ? existing.state : this.initializing.has(botId) ? 'STARTING' : 'STOPPED';
        await this.publishEvent('STATE_CHANGED', { botId, engineId: this.engineId, from: actualState, to: actualState, reason: 'status_request' }, command.correlationId);
    }

    /**
     * Stop all bots (engine shutdown).
     */
    async stopAll(reason: string): Promise<void> {
        for (const [, runtime] of this.bots) {
            try {
                await runtime.strategy.stop();
            } catch (error) {
                logger.error('Error stopping bot during shutdown', { botId: runtime.botId, error: error instanceof Error ? error.message : String(error) });
            }
            clearInterval(runtime.intervalId);
        }
        this.bots.clear();
        logger.info('All bots stopped', { reason });
    }
}

// ===========================================
// COMMAND LOOP & BOOTSTRAP
// ===========================================

async function listenForCommands(botManager: BotManager, streamOperations: ReturnType<typeof getRedisStreamOperations>): Promise<void> {
    logger.info('Listening for engine commands', { engineId: botManager.engineId });

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const result = await streamOperations.read(ENGINE_COMMANDS_STREAM, {
                block: 5000,
                count: 10,
                consumerGroup: ENGINE_COMMANDS_CONSUMER_GROUP,
                consumerName: 'engine-' + botManager.engineId,
                autoAck: true, // reads new (">") entries; acking is manual below
            });

            if (result.success && result.messages && result.messages.length > 0) {
                for (const message of result.messages) {
                    const data = message.data as unknown;
                    if (isBotCommand(data)) {
                        await botManager.handleCommand(data);
                    } else {
                        logger.warn('Ignoring malformed command', { streamId: message.id });
                    }
                    // Ack after processing: message survives an engine crash.
                    await streamOperations.ack(ENGINE_COMMANDS_STREAM, ENGINE_COMMANDS_CONSUMER_GROUP, message.id);
                }
            }
        } catch (error) {
            logger.error('Error reading commands from stream', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

async function main(): Promise<void> {
    activeBotManager = new BotManager();
    const botManager = activeBotManager;
    const streamOperations = getRedisStreamOperations();

    try {
        logger.info('Starting Trading Engine', { engineId: botManager.engineId });

        await streamOperations.connect();
        await streamOperations.createConsumerGroup(ENGINE_COMMANDS_STREAM, ENGINE_COMMANDS_CONSUMER_GROUP);

        await streamOperations.publish(ENGINE_EVENTS_STREAM, {
            version: 1,
            messageId: crypto.randomUUID(),
            correlationId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'ENGINE_STARTED',
            payload: { engineId: botManager.engineId, uptime: 0 },
        } as never);

        await listenForCommands(botManager, streamOperations);
    } catch (error) {
        logger.error('Failed to start Trading Engine', {
            engineId: botManager.engineId,
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
}

// Graceful shutdown on SIGTERM/SIGINT.
let activeBotManager: BotManager | null = null;
const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down engine`, { engineId: activeBotManager?.engineId });
    if (activeBotManager) {
        await activeBotManager.stopAll('graceful_shutdown');
    }
    process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void main();
