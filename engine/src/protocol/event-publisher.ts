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
    BotEventType,
    BotActualState,
    createBotEvent,
} from '@trade-bot/shared';
import { RedisStreamOperations, ENGINE_EVENTS_STREAM } from '../infrastructure/redis/streams';
import { logger } from '../utils/logger';

/**
 * Publish any event to the engine events stream.
 */
const EVENT_PUBLISH_MAX_RETRIES = Number(process.env.EVENT_PUBLISH_MAX_RETRIES || 3);
const EVENT_PUBLISH_BASE_DELAY_MS = Number(process.env.EVENT_PUBLISH_BASE_DELAY_MS || 250);

const delayMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PublishResult {
    success: boolean;
    error?: string;
}

/**
 * Publish any event to the engine events stream.
 *
 * Publication is retried a bounded number of times (exponential backoff) so a
 * transient Redis blip does not silently lose a control-plane event. On final
 * failure the result is returned (`success: false`) so callers that require an
 * authoritative hand-off (e.g. the STARTING->RUNNING transition) can react
 * instead of letting the event disappear.
 */
export async function publishEvent(
    streamOps: RedisStreamOperations,
    type: BotEventType,
    payload: Record<string, unknown>,
    correlationId: string
): Promise<PublishResult> {
    const event = createBotEvent(type, payload as any, correlationId);

    let lastError: string | undefined;
    for (let attempt = 0; attempt < EVENT_PUBLISH_MAX_RETRIES; attempt++) {
        const result = await streamOps.publish(ENGINE_EVENTS_STREAM, {
            version: event.version,
            messageId: event.messageId,
            correlationId: event.correlationId,
            timestamp: event.timestamp,
            type: event.type,
            payload: event.payload,
        });
        if (result.success) {
            logger.debug('Engine event published', { type, correlationId });
            return { success: true };
        }
        lastError = result.error;
        if (attempt < EVENT_PUBLISH_MAX_RETRIES - 1) {
            const backoffMs = Math.pow(2, attempt) * EVENT_PUBLISH_BASE_DELAY_MS;
            logger.warn('Engine event publish failed, retrying', {
                type,
                attempt: attempt + 1,
                backoffMs,
            });
            await delayMs(backoffMs);
        }
    }

    logger.error('Failed to publish engine event after retries', {
        type,
        correlationId,
        error: lastError,
    });
    return { success: false, error: lastError };
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
): Promise<PublishResult> {
    return publishEvent(streamOps, 'COMMAND_ACCEPTED', {
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
): Promise<PublishResult> {
    return publishEvent(streamOps, 'COMMAND_FAILED', {
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
): Promise<PublishResult> {
    return publishEvent(streamOps, 'STATE_CHANGED', {
        botId,
        from,
        to,
        reason: reason || '',
    }, correlationId);
}
