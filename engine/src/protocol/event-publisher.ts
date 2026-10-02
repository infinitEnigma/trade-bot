/**
 * Event Publisher
 *
 * Handles publishing engine events to Redis Streams.
 * All events (COMMAND_ACCEPTED, COMMAND_FAILED, STATE_CHANGED,
 * ENGINE_REGISTER, ENGINE_HEARTBEAT, and the ledger family ORDER_INTENT /
 * TRADE_EXECUTED / POSITION_UPDATED / PERFORMANCE_SNAPSHOT) flow through here.
 *
 * @format
 */

import {
  BotEventType,
  BotActualState,
  BotEventPayload,
  createBotEvent,
  OrderIntentEventPayload,
  TradeExecutedEventPayload,
  PositionUpdatedEventPayload,
  PerformanceSnapshotEventPayload,
} from "@trade-bot/shared";
import {
  RedisStreamOperations,
  ENGINE_EVENTS_STREAM,
} from "../infrastructure/redis/streams";
import { logger } from "../utils/logger";

/**
 * Publish any event to the engine events stream.
 */
const EVENT_PUBLISH_MAX_RETRIES = Number(
  process.env.EVENT_PUBLISH_MAX_RETRIES || 3
);
const EVENT_PUBLISH_BASE_DELAY_MS = Number(
  process.env.EVENT_PUBLISH_BASE_DELAY_MS || 250
);

const delayMs = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

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
  payload: BotEventPayload,
  correlationId: string
): Promise<PublishResult> {
  const event = createBotEvent(type, payload, correlationId);

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
      logger.debug("Engine event published", { type, correlationId });
      return { success: true };
    }
    lastError = result.error;
    if (attempt < EVENT_PUBLISH_MAX_RETRIES - 1) {
      const backoffMs = Math.pow(2, attempt) * EVENT_PUBLISH_BASE_DELAY_MS;
      logger.warn("Engine event publish failed, retrying", {
        type,
        attempt: attempt + 1,
        backoffMs,
      });
      await delayMs(backoffMs);
    }
  }

  logger.error("Failed to publish engine event after retries", {
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
  return publishEvent(
    streamOps,
    "COMMAND_ACCEPTED",
    {
      botId,
      commandType,
      engineId,
      engineEpoch,
    },
    correlationId
  );
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
  return publishEvent(
    streamOps,
    "COMMAND_FAILED",
    {
      botId,
      commandType,
      engineId,
      engineEpoch,
      errorCode,
      message,
    },
    correlationId
  );
}

/**
 * Publish STATE_CHANGED event.
 *
 * The payload must carry the emitting engine's identity and epoch; the backend
 * validates authority from them, so callers have to supply both.
 */
export async function publishStateChanged(
  streamOps: RedisStreamOperations,
  botId: string,
  engineId: string,
  engineEpoch: number,
  from: BotActualState,
  to: BotActualState,
  correlationId: string,
  reason?: string
): Promise<PublishResult> {
  return publishEvent(
    streamOps,
    "STATE_CHANGED",
    {
      botId,
      engineId,
      engineEpoch,
      from,
      to,
      reason: reason || "",
    },
    correlationId
  );
}

/**
 * Publish ORDER_INTENT — must be awaited BEFORE `createOrder` so the intent
 * is durable before the venue can accept anything (Phase 4 intent-before-create).
 */
export async function publishOrderIntent(
  streamOps: RedisStreamOperations,
  payload: OrderIntentEventPayload,
  correlationId: string
): Promise<PublishResult> {
  return publishEvent(streamOps, "ORDER_INTENT", payload, correlationId);
}

/** Publish TRADE_EXECUTED — one per detected fill (idempotent downstream). */
export async function publishTradeExecuted(
  streamOps: RedisStreamOperations,
  payload: TradeExecutedEventPayload,
  correlationId: string
): Promise<PublishResult> {
  return publishEvent(streamOps, "TRADE_EXECUTED", payload, correlationId);
}

/** Publish POSITION_UPDATED — the engine's aggregate position view. */
export async function publishPositionUpdated(
  streamOps: RedisStreamOperations,
  payload: PositionUpdatedEventPayload,
  correlationId: string
): Promise<PublishResult> {
  return publishEvent(streamOps, "POSITION_UPDATED", payload, correlationId);
}

/** Publish PERFORMANCE_SNAPSHOT — engine-side counters (telemetry only). */
export async function publishPerformanceSnapshot(
  streamOps: RedisStreamOperations,
  payload: PerformanceSnapshotEventPayload,
  correlationId: string
): Promise<PublishResult> {
  return publishEvent(
    streamOps,
    "PERFORMANCE_SNAPSHOT",
    payload,
    correlationId
  );
}
