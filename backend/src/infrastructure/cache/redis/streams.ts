/**
 * ===========================================
 * 🌊 REDIS STREAM OPERATIONS
 * ===========================================
 *
 * Handles Redis Stream operations for engine-backend communication.
 * Provides reliable command and event passing with consumer groups.
 *
 * RESPONSIBILITIES:
 * - Publish commands and events to streams
 * - Consume messages from streams
 * - Consumer group management
 * - Stream trimming and cleanup
 *
 * @format
 */

import { RedisConnectionManager } from "./connection-manager";
import { redisLogger as logger } from "../../../core/logging/context-aware-logger.service";
import type { EngineCommand, EngineEvent } from "@trade-bot/shared";
//import * as redis from "redis";
//import { TypedString } from "ethers/lib.commonjs/abi/typed";

// Stream names
export const ENGINE_COMMANDS_STREAM = "engine:commands";
export const ENGINE_EVENTS_STREAM = "engine:events";

// Consumer group names
export const ENGINE_COMMANDS_CONSUMER_GROUP = "engine-commands-group";
export const ENGINE_EVENTS_CONSUMER_GROUP = "engine-events-group";

// Consumer names
export const BACKEND_CONSUMER_NAME = "backend-consumer";
export const ENGINE_CONSUMER_NAME = "engine-consumer";

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
    constructor(private connectionManager: RedisConnectionManager) { }

    /**
     * Publish a message to a stream
     */
    async publish(stream: string, message: EngineCommand | EngineEvent): Promise<{ success: boolean; id?: string; error?: string }> {
        try {
            const client = this.connectionManager.getClient();
            const id = await client.xAdd(stream, "*", {
                data: JSON.stringify(message),
            });

            logger.debug("Message published to stream", { stream, id, type: message.type });
            return { success: true, id };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Stream publish error", error as Error, { stream, type: message.type, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Read messages from a stream
     */
    async read(stream: string, options: StreamReadOptions = {}): Promise<{ success: boolean; messages?: StreamMessage[]; error?: string }> {
        try {
            const client = this.connectionManager.getClient();

            if (options.consumerGroup && options.consumerName) {
                // Read from consumer group - always use ">" to get new messages
                const result = await client.xReadGroup(
                    options.consumerGroup,
                    options.consumerName,
                    [{ key: stream, id: ">" }],
                    {
                        BLOCK: options.block || 0,
                        COUNT: options.count || 10,
                    }
                );

                if (!result) {
                    logger.warn("Failed to read from consumer group", {
                        stream,
                        consumerGroup: options.consumerGroup
                    });
                    return { success: true, messages: [] }; // Return success with empty messages instead of false
                }

                const messages = result.flatMap(group =>
                    group.messages.map(msg => ({
                        id: msg.id,
                        data: JSON.parse(msg.message.data),
                    }))
                );

                logger.debug("Messages read from stream (consumer group)", {
                    stream,
                    consumerGroup: options.consumerGroup,
                    count: messages.length,
                });

                return { success: true, messages };
            } else {
                // Read directly from stream
                const result = await client.xRead(
                    { key: stream, id: "0" },
                    {
                        BLOCK: options.block || 0,
                        COUNT: options.count || 10,
                    }
                );

                if (!result) {
                    logger.warn("Failed to read from stream", { stream })
                    return { success: true, messages: [] }; // Return success with empty messages instead of false
                }

                const messages = result.flatMap(group =>
                    group.messages.map(msg => ({
                        id: msg.id,
                        data: JSON.parse(msg.message.data),
                    }))
                );

                logger.debug("Messages read from stream", {
                    stream,
                    count: messages.length,
                });

                return { success: true, messages };
            }
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Stream read error", error as Error, { stream, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Acknowledge a message in a consumer group
     */
    async ack(stream: string, consumerGroup: string, messageIds: string | string[]): Promise<{ success: boolean; count?: number; error?: string }> {
        try {
            const client = this.connectionManager.getClient();
            const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
            const count = await client.xAck(stream, consumerGroup, ids);

            logger.debug("Messages acknowledged", { stream, consumerGroup, count });
            return { success: true, count };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Stream acknowledge error", error as Error, { stream, consumerGroup, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Create a consumer group
     */
    async createConsumerGroup(stream: string, consumerGroup: string, startId: string = "0"): Promise<{ success: boolean; error?: string }> {
        try {
            const client = this.connectionManager.getClient();
            await client.xGroupCreate(stream, consumerGroup, startId, { MKSTREAM: true });
            logger.info("Consumer group created", { stream, consumerGroup });
            return { success: true };
        } catch (error) {
            const errorMessage = (error as Error).message;
            if (errorMessage.includes("BUSYGROUP")) {
                logger.error("Consumer group already exists", error as Error, { stream, consumerGroup });
                return { success: true };
            }
            logger.error("Consumer group creation error", error as Error, { stream, consumerGroup, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Trim a stream to maintain size
     */
    async trim(stream: string, maxLength: number, approximate: boolean = true): Promise<{ success: boolean; trimmedCount?: number; error?: string }> {
        try {
            const client = this.connectionManager.getClient();

            // Get current length before trim
            let lengthBefore;
            try {
                const infoBefore = await client.xInfoStream(stream);
                lengthBefore = infoBefore.length;
            } catch (error) {
                // If stream doesn't exist, there's nothing to trim
                if ((error as Error).message.includes("no such key")) {
                    return { success: true, trimmedCount: 0 };
                }
                throw error;
            }

            // Trim the stream
            try {
                if (approximate) {
                    await client.sendCommand(['XTRIM', stream, 'MAXLEN', maxLength.toString(), '~']);
                } else {
                    await client.sendCommand(['XTRIM', stream, 'MAXLEN', maxLength.toString()]);
                }
            } catch (trimError) {
                logger.error("XTRIM command failed", trimError as Error, {
                    stream,
                    maxLength,
                    approximate,
                    error: (trimError as Error).message,
                    stack: (trimError as Error).stack
                });
                throw trimError;
            }

            // Get current length after trim
            const infoAfter = await client.xInfoStream(stream);
            const lengthAfter = infoAfter.length;

            const trimmedCount = lengthBefore - lengthAfter;
            logger.debug("Stream trimmed", { stream, maxLength, trimmedCount });
            return { success: true, trimmedCount };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Stream trim error", error as Error, { stream, maxLength, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Get stream information
     */
    async info(stream: string): Promise<{ success: boolean; length?: number; firstId?: string; lastId?: string; error?: string }> {
        try {
            const client = this.connectionManager.getClient();
            const info = await client.xInfoStream(stream);

            return {
                success: true,
                length: info.length,
                firstId: info["first-entry"]?.id,
                lastId: info["last-entry"]?.id,
            };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Stream info error", error as Error, { stream, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Delete a message from a stream
     */
    async delete(stream: string, messageId: string): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
        try {
            const client = this.connectionManager.getClient();
            const deletedCount = await client.xDel(stream, messageId);

            logger.debug("Message deleted", { stream, messageId });
            return { success: true, deletedCount };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Stream delete error", error as Error, { stream, messageId, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
}