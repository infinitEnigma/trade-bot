/**
 * Event Publisher
 *
 * Handles publishing engine events to Redis Streams.
 * All events (COMMAND_ACCEPTED, COMMAND_FAILED, STATE_CHANGED,
 * ENGINE_REGISTER, ENGINE_HEARTBEAT) flow through here.
 *
 * @format
 */

import {
    BotEvent,
    BotEventType,
    BotActualState,
    createBotEvent,
} from '@trade-bot/shared';
import { RedisStreamOperations, ENGINE_EVENTS_STREAM } from '../infrastructure/redis/streams';
import { logger } from '../utils/logger';

/**
 * Publish any event to the engine events stream.
 */
export async function publishEvent(
    streamOps: RedisStreamOperations,
    type: BotEventType,
    payload: Record<string, unknown>,
    correlationId: string
): Promise<void> {
    const event = createBotEvent(type, payload as any, correlationId);
    const result = await streamOps.publish(ENGINE_EVENTS_STREAM, {
        version: event.version,
        messageId: event.messageId,
        correlationId: event.correlationId,
        timestamp: event.timestamp,
        type: event.type,
        payload: event.payload,
    });
    if (!result.success) {
        logger.error('Failed to publish engine event', { type, error: result.error });
    }
    logger.debug('Engine event published', { type, correlationId });
}

/**
 * Publish COMMAND_ACCEPTED event.
 */
export async function publishAccepted(
    streamOps: RedisStreamOperations,
    botId: string,
    commandType: string,
    engineId: string,
    engineEpoch: number,
    correlationId: string
): Promise<void> {
    await publishEvent(streamOps, 'COMMAND_ACCEPTED', {
        botId,
        commandType,
        engineId,
        engineEpoch,
    }, correlationId);
}

/**
 * Publish COMMAND_FAILED event.
 */
export async function publishFailed(
    streamOps: RedisStreamOperations,
    botId: string,
    commandType: string,
    engineId: string,
    engineEpoch: number,
    errorCode: string,
    message: string,
    correlationId: string
): Promise<void> {
    await publishEvent(streamOps, 'COMMAND_FAILED', {
        botId,
        commandType,
        engineId,
        engineEpoch,
        errorCode,
        message,
    }, correlationId);
}

/**
 * Publish STATE_CHANGED event.
 */
export async function publishStateChanged(
    streamOps: RedisStreamOperations,
    botId: string,
    from: BotActualState,
    to: BotActualState,
    correlationId: string,
    reason?: string
): Promise<void> {
    await publishEvent(streamOps, 'STATE_CHANGED', {
        botId,
        from,
        to,
        reason: reason || '',
    }, correlationId);
}
