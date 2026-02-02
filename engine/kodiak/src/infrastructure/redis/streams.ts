import { createClient, RedisClientType } from 'redis';
import { logger } from '../../utils/logger';
import {
    EngineCommand,
    EngineEvent,
    isEngineCommand,
    isEngineEvent,
    isStartEngineCommand,
    isStopEngineCommand,
    isStartBotCommand,
    isStopBotCommand,
    isEmergencyStopCommand,
    isUpdateStrategyConfigCommand
} from '@trade-bot/shared';

// Stream names
export const ENGINE_COMMANDS_STREAM = 'engine:commands';
export const ENGINE_EVENTS_STREAM = 'engine:events';

// Consumer group names
export const ENGINE_COMMANDS_CONSUMER_GROUP = 'engine-commands-group';
export const ENGINE_EVENTS_CONSUMER_GROUP = 'engine-events-group';

// Consumer names
export const BACKEND_CONSUMER_NAME = 'backend-consumer';
export const ENGINE_CONSUMER_NAME = 'engine-consumer';

export interface StreamMessage {
    id: string;
    data: EngineCommand | EngineEvent;
}

export interface StreamReadOptions {
    block?: number; // Milliseconds to block
    count?: number; // Number of messages to read
    consumerGroup?: string;
    consumerName?: string;
    autoAck?: boolean;
}

export class RedisStreamOperations {
    private client: RedisClientType;

    constructor(private redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379') {
        this.client = createClient({
            url: this.redisUrl,
        });

        this.client.on('error', (err) => {
            logger.error('Redis client error', { error: err.message });
        });

        this.client.on('connect', () => {
            logger.info('Redis client connected');
        });
    }

    async connect(): Promise<void> {
        if (!this.client.isOpen) {
            await this.client.connect();
            // Explicitly select database 1 after connecting
            await this.client.select(1);
            logger.info('Redis database 1 selected');
        }
    }

    async disconnect(): Promise<void> {
        if (this.client.isOpen) {
            await this.client.disconnect();
        }
    }

    /**
     * Publish a message to a stream
     */
    async publish(stream: string, message: EngineCommand | EngineEvent): Promise<{ success: boolean; id?: string; error?: string }> {
        try {
            const id = await this.client.xAdd(stream, '*', {
                data: JSON.stringify(message),
            });

            logger.debug('Message published to stream', { stream, id, type: message.type });
            return { success: true, id };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error('Stream publish error', { stream, type: message.type, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Read messages from a stream
     */
    async read(stream: string, options: StreamReadOptions = {}): Promise<{ success: boolean; messages?: StreamMessage[]; error?: string }> {
        try {
            if (options.consumerGroup && options.consumerName) {
                // Read from consumer group
                const result = await this.client.xReadGroup(
                    options.consumerGroup,
                    options.consumerName,
                    { key: stream, id: options.autoAck ? '>' : '0' },
                    {
                        BLOCK: options.block || 0,
                        COUNT: options.count || 10,
                    }
                );

                if (!result) {
                    return { success: true, messages: [] };
                }

                const messages = result.flatMap(group =>
                    group.messages.map(msg => ({
                        id: msg.id,
                        data: JSON.parse(msg.message.data),
                    }))
                );

                logger.debug('Messages read from stream (consumer group)', {
                    stream,
                    consumerGroup: options.consumerGroup,
                    count: messages.length,
                });

                return { success: true, messages };
            } else {
                // Read directly from stream
                const result = await this.client.xRead(
                    { key: stream, id: '0' },
                    {
                        BLOCK: options.block || 0,
                        COUNT: options.count || 10,
                    }
                );

                if (!result) {
                    return { success: true, messages: [] };
                }

                const messages = result.flatMap(group =>
                    group.messages.map(msg => ({
                        id: msg.id,
                        data: JSON.parse(msg.message.data),
                    }))
                );

                logger.debug('Messages read from stream', {
                    stream,
                    count: messages.length,
                });

                return { success: true, messages };
            }
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error('Stream read error', { stream, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Acknowledge a message in a consumer group
     */
    async ack(stream: string, consumerGroup: string, messageIds: string | string[]): Promise<{ success: boolean; count?: number; error?: string }> {
        try {
            const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
            const count = await this.client.xAck(stream, consumerGroup, ids);

            logger.debug('Messages acknowledged', { stream, consumerGroup, count });
            return { success: true, count };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error('Stream acknowledge error', { stream, consumerGroup, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Create a consumer group
     */
    async createConsumerGroup(stream: string, consumerGroup: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.client.xGroupCreate(stream, consumerGroup, '$', { MKSTREAM: true });
            logger.info('Consumer group created', { stream, consumerGroup });
            return { success: true };
        } catch (error) {
            const errorMessage = (error as Error).message;
            if (errorMessage.includes('BUSYGROUP')) {
                logger.debug('Consumer group already exists', { stream, consumerGroup });
                return { success: true };
            }
            logger.error('Consumer group creation error', { stream, consumerGroup, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Trim a stream to maintain size
     */
    async trim(stream: string, maxLength: number, approximate: boolean = true): Promise<{ success: boolean; trimmedCount?: number; error?: string }> {
        try {
            // @ts-ignore - Redis XTRIM API type issue
            const trimmedCount = await this.client.xTrim(stream, 'MAXLEN', approximate ? '~' + maxLength : maxLength);

            logger.debug('Stream trimmed', { stream, maxLength, trimmedCount });
            return { success: true, trimmedCount };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error('Stream trim error', { stream, maxLength, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Get stream information
     */
    async info(stream: string): Promise<{ success: boolean; length?: number; firstId?: string; lastId?: string; error?: string }> {
        try {
            const info = await this.client.xInfoStream(stream);

            return {
                success: true,
                length: info.length,
                firstId: info['first-entry']?.id,
                lastId: info['last-entry']?.id,
            };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error('Stream info error', { stream, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Delete a message from a stream
     */
    async delete(stream: string, messageId: string): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            const deletedCount = await this.client.xDel(stream, messageId);

            logger.debug('Message deleted', { stream, messageId });
            return { success: true, deletedCount };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error('Stream delete error', { stream, messageId, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
}

// Singleton instance
let redisStreamOperations: RedisStreamOperations | null = null;

export function getRedisStreamOperations(): RedisStreamOperations {
    if (!redisStreamOperations) {
        redisStreamOperations = new RedisStreamOperations();
    }
    return redisStreamOperations;
}