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
import * as fs from 'fs';
import * as path from 'path';
import { GridTradingStrategy } from './strategies/grid';
import { OrderlyClient, createOrderlyClient } from './services/orderly';

// ===========================================
// CONFIGURATION
// ===========================================

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const BOT_ENGINE_API_KEY = process.env.BOT_ENGINE_API_KEY || '';
const TICK_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = Number(process.env.ENGINE_HEARTBEAT_INTERVAL_MS || 10_000);
/** Min idle time before a stuck pending command is reclaimed (XAUTOCLAIM). */
const PENDING_RECOVERY_MIN_IDLE_MS = Number(process.env.PENDING_RECOVERY_MIN_IDLE_MS || 60_000);
const ENGINE_VERSION = 'kodiak@1.0.0';

/**
 * Persistent engine identity: engineId survives restarts (env override or
 * state file) and `epoch` increments on every start, so the backend can
 * reject delayed events from a superseded engine process.
 */
interface EngineIdentity {
    engineId: string;
    epoch: number;
}

const ENGINE_STATE_FILE = process.env.ENGINE_STATE_FILE || path.join(process.cwd(), '.engine-state.json');

function loadOrCreateEngineIdentity(): EngineIdentity {
    let state: { engineId?: string; epoch?: number } = {};
    try {
        state = JSON.parse(fs.readFileSync(ENGINE_STATE_FILE, 'utf-8'));
    } catch {
        // First run or unreadable state file - create a fresh identity.
    }

    const engineId = process.env.ENGINE_ID || state.engineId || 'kodiak-engine-' + crypto.randomUUID().substring(0, 8);
    // Each (re)start of the same engine bumps the epoch.
    const epoch = (state.engineId === engineId ? state.epoch ?? 0 : 0) + 1;

    try {
        fs.writeFileSync(ENGINE_STATE_FILE, JSON.stringify({ engineId, epoch }, null, 2));
    } catch (error) {
        const message = `Could not persist engine identity to ${ENGINE_STATE_FILE}: ${error instanceof Error ? error.message : String(error)}`;
        if (process.env.NODE_ENV === 'production') {
            // Without a persisted epoch the identity loses monotonicity on the
            // next restart (epoch could silently revert) - refuse to start.
            throw new Error(`FATAL: ${message} - engine identity must be persistable in production`);
        }
        logger.error('Engine identity could not be persisted - epoch will reset on restart', {
            file: ENGINE_STATE_FILE,
            error: message,
        });
    }

    return { engineId, epoch };
}

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
    /**
     * Bots whose BOT_STOP arrived while a start was still initializing. The
     * in-flight handleStart checks this at each await boundary and aborts,
     * so a stop can never be "lost" and then resurrected as RUNNING later.
     */
    private stopRequested = new Set<string>();
    private processedMessageIds: Set<string> = new Set();
    private streamOperations: ReturnType<typeof getRedisStreamOperations>;
    readonly engineId: string;
    /** Monotonically increasing per (re)start - rejects superseded processes. */
    readonly epoch: number;
    private heartbeatIntervalId: NodeJS.Timeout | null = null;
    /** Scope for the durable (Redis-backed) command dedup markers. */
    private readonly dedupScope = 'engine-commands';

    constructor() {
        this.streamOperations = getRedisStreamOperations();
        const identity = loadOrCreateEngineIdentity();
        this.engineId = identity.engineId;
        this.epoch = identity.epoch;
    }

    /**
     * Register with the backend and start the heartbeat loop. The backend
     * marks this engine OFFLINE (and its bots UNKNOWN) if heartbeats stop.
     */
    startHeartbeat(): void {
        const startedAt = new Date().toISOString();
        const registerOnce = async (): Promise<void> => {
            await this.streamOperations.publish(ENGINE_EVENTS_STREAM, {
                version: 1,
                messageId: crypto.randomUUID(),
                correlationId: crypto.randomUUID(),
                timestamp: startedAt,
                type: 'ENGINE_REGISTER',
                payload: { engineId: this.engineId, epoch: this.epoch, version: ENGINE_VERSION, startedAt },
            });
            logger.info('Engine registered with backend', { engineId: this.engineId, epoch: this.epoch, version: ENGINE_VERSION });
        };

        void registerOnce();

        this.heartbeatIntervalId = setInterval(() => {
            void this.streamOperations
                .publish(ENGINE_EVENTS_STREAM, {
                    version: 1,
                    messageId: crypto.randomUUID(),
                    correlationId: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    type: 'ENGINE_HEARTBEAT',
                    payload: {
                        engineId: this.engineId,
                        epoch: this.epoch,
                        activeBotIds: [...this.bots.keys()],
                        version: ENGINE_VERSION,
                    },
                })
                .then(result => {
                    if (!result.success) {
                        logger.error('Failed to publish engine heartbeat', { error: result.error });
                    }
                });
        }, HEARTBEAT_INTERVAL_MS);
        // Never keep the process alive just for the heartbeat.
        this.heartbeatIntervalId.unref();
    }

    stopHeartbeat(): void {
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }
    }

    /**
     * Publish a protocol event to the backend.
     */
    private async publishEvent(type: BotEventType, payload: Record<string, unknown>, correlationId: string): Promise<void> {
        const event: BotEvent = createBotEvent(type, payload as never, correlationId);
        const result = await this.streamOperations.publish(ENGINE_EVENTS_STREAM, event);
        if (!result.success) {
            logger.error('Failed to publish engine event', { type, botId: (payload as { botId?: string }).botId, error: result.error });
        }
    }

    private async publishAccepted(botId: string, commandType: string, correlationId: string): Promise<void> {
        await this.publishEvent('COMMAND_ACCEPTED', { botId, commandType, engineId: this.engineId, engineEpoch: this.epoch }, correlationId);
    }

    private async publishFailed(botId: string, commandType: string, correlationId: string, errorCode: string, message: string): Promise<void> {
        await this.publishEvent('COMMAND_FAILED', { botId, commandType, engineId: this.engineId, engineEpoch: this.epoch, errorCode, message }, correlationId);
    }

    private async publishStateChanged(botId: string, from: BotActualState, to: BotActualState, correlationId: string, reason?: string): Promise<void> {
        await this.publishEvent('STATE_CHANGED', { botId, engineId: this.engineId, engineEpoch: this.epoch, from, to, reason }, correlationId);
    }

    /**
     * Handle one command envelope. Never throws: failures are reported via
     * COMMAND_FAILED / STATE_CHANGED events so the message can be acked.
     * Deduplication is durable (Redis-backed with TTL) so a command processed
     * before an engine crash is not re-executed after redelivery.
     */
    async handleCommand(command: BotCommand): Promise<void> {
        // Durable deduplication of redelivered commands (at-least-once delivery).
        if (this.processedMessageIds.has(command.messageId) || (await this.streamOperations.isMessageProcessed(this.dedupScope, command.messageId))) {
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

            await this.markCommandProcessed(command.messageId);
        } catch (error) {
            logger.error('Unexpected error handling command', {
                commandType: command.type,
                botId: (command.payload as { botId?: string }).botId,
                error: error instanceof Error ? error.message : String(error),
            });
            this.processedMessageIds.add(command.messageId);
        }
    }

    private async markCommandProcessed(messageId: string): Promise<void> {
        this.processedMessageIds.add(messageId);
        if (this.processedMessageIds.size > DEDUP_SET_MAX_SIZE) {
            this.processedMessageIds = new Set(Array.from(this.processedMessageIds).slice(-DEDUP_SET_MAX_SIZE / 2));
        }
        await this.streamOperations.markMessageProcessed(this.dedupScope, messageId);
    }

    /**
     * BOT_START: START -> COMMAND_ACCEPTED -> STARTING -> (init) -> RUNNING
     *
     * Cancellation-safe: a BOT_STOP arriving mid-initialization adds the bot
     * to `stopRequested`; every await boundary below checks it and aborts,
     * reporting STARTING -> STOPPED instead of letting the start resurrect.
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
        // A fresh start supersedes any past (already-consumed) stop marker.
        this.stopRequested.delete(botId);

        // Hoisted so cancellation can tear down partial initialization.
        let orderlyClient: OrderlyClient | null = null;
        let gridStrategy: GridTradingStrategy | null = null;
        let intervalId: NodeJS.Timeout | null = null;

        try {
            await this.publishStateChanged(botId, 'STOPPED', 'STARTING', correlationId);
            this.throwIfCancelled(botId);

            // 1. Fetch credentials out-of-band.
            const credentials = await fetchCredentials(botId, correlationId);
            this.throwIfCancelled(botId);

            // 2. Connect an Orderly client for this user.
            orderlyClient = createOrderlyClient(credentials.accountId, credentials.accessKey, credentials.secretKey, process.env.NODE_ENV !== 'production');

            // 3. Resolve current market price.
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

            // 4. Create, initialize and start the strategy.
            gridStrategy = new GridTradingStrategy(
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

            // 5. Trading loop.
            intervalId = setInterval(() => {
                void gridStrategy!.tick().catch(error => {
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
            if (this.stopRequested.has(botId)) {
                // A stop arrived during initialization - abort cleanly. The
                // bot must NOT go RUNNING/ERROR; report the cancellation.
                logger.info('Bot start cancelled by a stop request', { botId });
                if (gridStrategy) {
                    try {
                        await gridStrategy.stop();
                    } catch (stopError) {
                        logger.error('Error stopping cancelled strategy', { botId, error: stopError instanceof Error ? stopError.message : String(stopError) });
                    }
                }
                if (intervalId) {
                    clearInterval(intervalId);
                }
                this.stopRequested.delete(botId);
                await this.publishStateChanged(botId, 'STARTING', 'STOPPED', correlationId, 'cancelled');
            } else {
                const message = error instanceof Error ? error.message : String(error);
                logger.error('Bot start failed', { botId, error: message });
                await this.publishFailed(botId, 'BOT_START', correlationId, 'BOT_START_FAILED', message);
                await this.publishStateChanged(botId, 'STARTING', 'ERROR', correlationId, 'init_failed');
            }
        } finally {
            this.initializing.delete(botId);
        }
    }

    /**
     * Abort a start-in-flight if a stop has been requested since. Called after
     * every await boundary so cancellation is prompt and never resurrects.
     */
    private throwIfCancelled(botId: string): void {
        if (this.stopRequested.has(botId)) {
            throw new Error(`Bot start cancelled by stop request: ${botId}`);
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

        // A start is still initializing - signal cancellation instead of the
        // "unknown bot" no-op. The in-flight handleStart aborts at the next
        // boundary and reports STARTING -> STOPPED, so the bot can't later
        // resurrect as RUNNING after the user asked to stop.
        if (this.initializing.has(botId)) {
            logger.info('Stop requested during initialization - cancelling start', { botId });
            this.stopRequested.add(botId);
            await this.publishStateChanged(botId, 'STARTING', 'STOPPED', correlationId, 'cancelled');
            return;
        }

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
        await this.publishEvent('STATE_CHANGED', { botId, engineId: this.engineId, engineEpoch: this.epoch, from: actualState, to: actualState, reason: 'status_request' }, command.correlationId);
    }

    /**
     * Stop all bots (engine shutdown).
     *
     * Graceful shutdown is made authoritative: each RUNNING bot reports
     * RUNNING -> STOPPING -> STOPPED and each initializing start is cancelled
     * (STARTING -> STOPPED) BEFORE the heartbeat stops. That lets the backend
     * persist a clean STOPPED instead of waiting for the heartbeat timeout to
     * mark the bots UNKNOWN. A crash/disappearance (no state reports) is what
     * should surface as UNKNOWN, not a normal shutdown.
     */
    async stopAll(reason: string): Promise<void> {
        const correlationId = 'engine-shutdown:' + crypto.randomUUID();

        // Report before teardown so the events reach the backend before the
        // heartbeat stops and the engine goes OFFLINE.
        for (const [, runtime] of this.bots) {
            try {
                await this.publishStateChanged(runtime.botId, runtime.state, 'STOPPING', correlationId, 'engine_shutdown');
            } catch (error) {
                logger.error('Error reporting STOPPING for shutdown', { botId: runtime.botId, error: error instanceof Error ? error.message : String(error) });
            }
        }
        // Cancel any start-in-flight so it cannot resurrect during shutdown.
        for (const botId of this.initializing) {
            this.stopRequested.add(botId);
        }

        for (const [, runtime] of this.bots) {
            try {
                await runtime.strategy.stop();
            } catch (error) {
                logger.error('Error stopping bot during shutdown', { botId: runtime.botId, error: error instanceof Error ? error.message : String(error) });
            }
            clearInterval(runtime.intervalId);
            try {
                await this.publishStateChanged(runtime.botId, 'STOPPING', 'STOPPED', correlationId, 'engine_shutdown');
            } catch (error) {
                logger.error('Error reporting STOPPED for shutdown', { botId: runtime.botId, error: error instanceof Error ? error.message : String(error) });
            }
        }
        this.bots.clear();

        // Stopping the heartbeat last so the STOPPED reports flush first.
        this.stopHeartbeat();
        // Leave `stopRequested` markers in place: a start suspended on an await
        // when this ran must still abort rather than resurrect after process exit.
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
                // Acking is manual below: the message survives an engine crash
                // until this consumer explicitly acks after processing.
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
            } else {
                // No new commands: opportunistically recover pending commands
                // that a crashed engine consumer read but never acked. The 60s
                // min-idle ensures only long-stuck messages are claimed.
                const recovered = await streamOperations.claimPending(
                    ENGINE_COMMANDS_STREAM,
                    ENGINE_COMMANDS_CONSUMER_GROUP,
                    'engine-' + botManager.engineId,
                    PENDING_RECOVERY_MIN_IDLE_MS
                );
                if (recovered.success && recovered.messages) {
                    for (const message of recovered.messages) {
                        const data = message.data as unknown;
                        if (isBotCommand(data)) {
                            await botManager.handleCommand(data);
                        }
                        await streamOperations.ack(ENGINE_COMMANDS_STREAM, ENGINE_COMMANDS_CONSUMER_GROUP, message.id);
                    }
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

        // Register with the backend and start heartbeating (ENGINE_REGISTER
        // + periodic ENGINE_HEARTBEAT events carry identity, epoch and liveness).
        botManager.startHeartbeat();

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
