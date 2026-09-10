/**
 * Engine Protocol Service - Redis Streams control plane (Backend ⇄ Engine)
 *
 * Implements the protocol defined in `@trade-bot/shared/src/protocol`:
 * - Sends commands to `tradebot:engine:commands`
 * - Consumes events from `tradebot:engine:events` (consumer group, manual ack)
 *
 * Design notes:
 * - Commands persist in the stream until consumed (at-least-once delivery).
 * - Every message carries messageId (dedup) and correlationId (tracing).
 * - Events are acked only AFTER the handler completes.
 * - No credentials/secrets ever flow through this protocol.
 *
 * @format
 */

import {
    BotCommandPayload,
    BotCommandType,
    BotEvent,
    ProtocolMessage,
    createBotCommand,
    isBotEvent,
} from "@trade-bot/shared";
import { RedisStreamOperations, RedisConnectionManager } from "../../infrastructure/cache/redis";
import { redisLogger as logger } from "../../core/logging/context-aware-logger.service";

// ===========================================
// STREAM NAMES & CONSUMER GROUPS
// ===========================================

export const BOT_COMMANDS_STREAM = "tradebot:engine:commands";
export const BOT_EVENTS_STREAM = "tradebot:engine:events";

/** Consumer group the backend uses to read engine events. */
export const BACKEND_EVENTS_CONSUMER_GROUP = "backend-group";
/** Consumer group the engine uses to read backend commands. */
export const ENGINE_COMMANDS_CONSUMER_GROUP = "engine-workers";

/** Bounded size for the backend-side event deduplication set. */
const DEDUP_SET_MAX_SIZE = 10_000;

export interface EngineProtocolServiceDependencies {
    streamOperations?: RedisStreamOperations;
    connectionManager?: RedisConnectionManager;
    consumerName?: string;
}

export interface SendCommandResult {
    success: boolean;
    messageId?: string;
    correlationId?: string;
    error?: string;
}

export type BotEventHandler = (event: BotEvent) => Promise<void> | void;

/**
 * Backend-side half of the engine control protocol.
 *
 * Owns the Redis Streams plumbing for commands/events and the event
 * consumer loop. Lifecycle policy (transitions, persistence) lives in
 * BotLifecycleService; this class knows nothing about it.
 */
export class EngineProtocolService {
    private streamOperations: RedisStreamOperations;
    private connectionManager: RedisConnectionManager;
    private consumerName: string;
    private eventHandler: BotEventHandler | null = null;
    private isListening = false;
    /** Recently processed event messageIds for at-least-once deduplication. */
    private processedMessageIds: Set<string> = new Set();

    constructor(deps: EngineProtocolServiceDependencies = {}) {
        this.connectionManager = deps.connectionManager ?? new RedisConnectionManager();
        this.streamOperations = deps.streamOperations ?? new RedisStreamOperations(this.connectionManager);
        this.consumerName = deps.consumerName ?? "backend-consumer";
    }

    // ===========================================
    // LIFECYCLE
    // ===========================================

    /**
     * Connect to Redis, ensure the consumer group exists and start the
     * event listener loop with the given handler.
     */
    async start(eventHandler: BotEventHandler): Promise<void> {
        if (this.isListening) {
            logger.debug("Engine protocol already listening");
            return;
        }

        this.eventHandler = eventHandler;

        await this.connectionManager.connect();
        await this.streamOperations.createConsumerGroup(BOT_EVENTS_STREAM, BACKEND_EVENTS_CONSUMER_GROUP);

        this.isListening = true;
        // Fire-and-forget: the loop runs for the lifetime of the process.
        void this.eventListenerLoop();
        logger.info("Engine protocol service started", {
            commandsStream: BOT_COMMANDS_STREAM,
            eventsStream: BOT_EVENTS_STREAM,
        });
    }

    /**
     * Stop consuming engine events. In-flight messages are left unacked
     * and will be redelivered on the next start.
     */
    stop(): void {
        this.isListening = false;
        this.eventHandler = null;
        logger.info("Engine protocol service stopped");
    }

    // ===========================================
    // COMMANDS (Backend → Engine)
    // ===========================================

    /**
     * Publish a lifecycle command to the engine.
     * Returns the envelope ids so callers can correlate acknowledgements.
     */
    async sendCommand<P extends BotCommandPayload>(type: BotCommandType, payload: P, correlationId?: string): Promise<SendCommandResult> {
        const command: ProtocolMessage<P> = createBotCommand<P>(type, payload, correlationId);

        const result = await this.streamOperations.publish(BOT_COMMANDS_STREAM, command as unknown as Parameters<RedisStreamOperations["publish"]>[1]);

        if (!result.success) {
            logger.error("Failed to publish bot command", undefined, {
                type,
                botId: (payload as { botId?: string }).botId,
                error: result.error,
            });
            return { success: false, error: result.error, correlationId: command.correlationId };
        }

        logger.info("Bot command published", {
            type,
            botId: (payload as { botId?: string }).botId,
            messageId: command.messageId,
            correlationId: command.correlationId,
            streamId: result.id,
        });

        return {
            success: true,
            messageId: command.messageId,
            correlationId: command.correlationId,
        };
    }
    // ===========================================
    // EVENT CONSUMER LOOP
    // ===========================================

    private async eventListenerLoop(): Promise<void> {
        while (this.isListening) {
            try {
                const result = await this.streamOperations.read(BOT_EVENTS_STREAM, {
                    block: 1000,
                    count: 10,
                    consumerGroup: BACKEND_EVENTS_CONSUMER_GROUP,
                    consumerName: this.consumerName,
                    autoAck: false,
                });

                if (!result.success || !result.messages || result.messages.length === 0) {
                    continue;
                }

                for (const message of result.messages) {
                    await this.processEventMessage(message.id, message.data);
                }
            } catch (error) {
                if (this.isListening) {
                    logger.error("Error reading engine events", undefined, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    // Avoid hot-spinning on persistent Redis failures.
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    }

    private async processEventMessage(streamId: string, data: unknown): Promise<void> {
        if (!isBotEvent(data)) {
            logger.warn("Ignoring malformed engine event", { streamId });
            await this.safeAck(streamId);
            return;
        }

        // Deduplicate redelivered messages (at-least-once delivery).
        if (this.processedMessageIds.has(data.messageId)) {
            logger.debug("Duplicate engine event ignored", { messageId: data.messageId, type: data.type });
            await this.safeAck(streamId);
            return;
        }

        try {
            if (this.eventHandler) {
                await this.eventHandler(data);
            }

            this.processedMessageIds.add(data.messageId);
            if (this.processedMessageIds.size > DEDUP_SET_MAX_SIZE) {
                // Bounded memory: keep only the newest half when the set grows too large.
                this.processedMessageIds = new Set(Array.from(this.processedMessageIds).slice(-DEDUP_SET_MAX_SIZE / 2));
            }

            await this.safeAck(streamId);
        } catch (error) {
            logger.error("Engine event handler failed, message left unacked for redelivery", undefined, {
                streamId,
                messageId: data.messageId,
                eventType: data.type,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async safeAck(streamId: string): Promise<void> {
        const ackResult = await this.streamOperations.ack(BOT_EVENTS_STREAM, BACKEND_EVENTS_CONSUMER_GROUP, streamId);
        if (!ackResult.success) {
            logger.warn("Failed to ack engine event", { streamId, error: ackResult.error });
        }
    }
}

// ===========================================
// SINGLETON
// ===========================================

// Singleton instance (same pattern as botReconciliationWorker)
export const engineProtocolService = new EngineProtocolService();

