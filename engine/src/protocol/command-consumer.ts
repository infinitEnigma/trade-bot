/**
 * Command Consumer
 *
 * Reads commands from Redis Streams and dispatches them to the BotManager.
 * Handles deduplication (in-memory fast path + Redis-backed durable markers),
 * pending message recovery, and poison message detection.
 *
 * @format
 */

import {
  BotCommand,
  EmergencyStopCommandPayload,
  isBotCommand,
  isBotEmergencyStopCommand,
  isBotStartCommand,
  isBotStopCommand,
  isStatusRequestCommand,
} from "@trade-bot/shared";
import {
  RedisStreamOperations,
  StreamMessage,
  ENGINE_COMMANDS_STREAM,
  ENGINE_COMMANDS_CONSUMER_GROUP,
} from "../infrastructure/redis/streams";
import { logger } from "../utils/logger";
import { BotManager } from "../application/bot-manager";
import { CommandError } from "../application/command-error";

const PENDING_RECOVERY_MIN_IDLE_MS = Number(
  process.env.PENDING_RECOVERY_MIN_IDLE_MS || 60_000
);
const PENDING_STUCK_ALERT_THRESHOLD_MS = Number(
  process.env.PENDING_STUCK_ALERT_THRESHOLD_MS || 30_000
);
const PENDING_POISON_MAX_DELIVERIES = Number(
  process.env.PENDING_POISON_MAX_DELIVERIES || 10
);
const PENDING_INSIGHT_INTERVAL_MS = Number(
  process.env.PENDING_INSIGHT_INTERVAL_MS || 30_000
);

// Durable dedup (Redis marker scope + bounded in-memory fast path) — mirrors
// the backend's engine-protocol.service constants.
const DEDUP_SCOPE = "engine-commands";
const DEDUP_SET_MAX_SIZE = 10_000;

/**
 * Start listening for commands from the backend.
 */
export async function listenForCommands(
  botManager: BotManager,
  streamOps: RedisStreamOperations
): Promise<void> {
  const processedMessageIds = new Set<string>();
  let lastInsightCheck = Date.now();

  logger.info("Listening for commands", { stream: ENGINE_COMMANDS_STREAM });

  while (true) {
    try {
      const result = await streamOps.read(ENGINE_COMMANDS_STREAM, {
        consumerGroup: ENGINE_COMMANDS_CONSUMER_GROUP,
        consumerName: "engine-consumer",
        block: 5000,
        count: 1,
      });

      if (result.success && result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          await processMessage(streamOps, botManager, msg, processedMessageIds);
        }
      } else {
        // No new messages - try to recover pending
        await recoverPending(streamOps, botManager, processedMessageIds);
      }

      // Periodic insight check
      const now = Date.now();
      if (now - lastInsightCheck > PENDING_INSIGHT_INTERVAL_MS) {
        await checkPendingInsight(streamOps);
        lastInsightCheck = now;
      }
    } catch (error) {
      logger.error("Error reading commands", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Durable (Redis, TTL 24h) plus in-memory fast-path dedup check — the mirror
 * of the backend's `engine-protocol.service` `alreadyProcessed()`. The set
 * alone lost every processed messageId on restart, so a recovered pending
 * command (`recoverPending` / XAUTOCLAIM) was re-dispatched after a crash.
 * Both Redis helpers fail open (`streams.ts`): a double-dispatch beats a
 * silently dropped command.
 */
async function alreadyProcessed(
  streamOps: RedisStreamOperations,
  processedMessageIds: Set<string>,
  messageId: string
): Promise<boolean> {
  if (processedMessageIds.has(messageId)) {
    return true;
  }
  return streamOps.isMessageProcessed(DEDUP_SCOPE, messageId);
}

/**
 * Record a handled messageId in both layers — the mirror of the backend's
 * `markProcessed()`. The in-memory set stays bounded (trimmed to the newest
 * half past DEDUP_SET_MAX_SIZE); the Redis marker is the durable half.
 */
async function markProcessed(
  streamOps: RedisStreamOperations,
  processedMessageIds: Set<string>,
  messageId: string
): Promise<void> {
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > DEDUP_SET_MAX_SIZE) {
    const keep = Array.from(processedMessageIds).slice(-DEDUP_SET_MAX_SIZE / 2);
    processedMessageIds.clear();
    for (const id of keep) {
      processedMessageIds.add(id);
    }
  }
  await streamOps.markMessageProcessed(DEDUP_SCOPE, messageId);
}

/**
 * Validate, deduplicate, dispatch, and ACK a single stream message.
 *
 * Exported for unit tests (the `listenForCommands` loop itself never returns).
 */
export async function processMessage(
  streamOps: RedisStreamOperations,
  botManager: BotManager,
  msg: StreamMessage,
  processedMessageIds: Set<string>
): Promise<void> {
  let data: BotCommand | undefined;
  try {
    data = isBotCommand(msg.data) ? msg.data : undefined;
    if (!data) {
      logger.warn("Ignoring malformed command", { streamId: msg.id });
      await safeAck(streamOps, msg.id);
      return;
    }

    // Dedup check: in-memory fast path + durable Redis marker (24h TTL), so a
    // command recovered from the PEL after a restart is not re-dispatched —
    // the set alone forgot every processed messageId the moment the process
    // died, and XAUTOCLAIM happily redelivers what a dead engine already ran.
    if (
      await alreadyProcessed(streamOps, processedMessageIds, data.messageId)
    ) {
      logger.debug("Duplicate command ignored", { messageId: data.messageId });
      await safeAck(streamOps, msg.id);
      return;
    }

    await handleCommand(botManager, streamOps, data);
    await markProcessed(streamOps, processedMessageIds, data.messageId);
    await safeAck(streamOps, msg.id);
  } catch (error) {
    logger.error("Failed to process command", {
      streamId: msg.id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Business failures (already surfaced to the backend via
    // COMMAND_FAILED / STATE_CHANGED) are authoritative: ACK so the command
    // is not retried forever. Transient infrastructure failures stay
    // pending so recoverPending can reclaim and retry them.
    const retryable =
      !data || !(error instanceof CommandError) ? true : error.retryable;
    if (!retryable && data) {
      await markProcessed(streamOps, processedMessageIds, data.messageId);
      await safeAck(streamOps, msg.id);
      return;
    }

    // L22 safety net: a command that keeps failing past the poison threshold
    // is alert-and-dropped instead of redelivered forever. The insight pass
    // could only *log* the poison entry; this caps it at the point of failure.
    const deliveries = await pendingDeliveries(streamOps, msg.id);
    if (deliveries >= PENDING_POISON_MAX_DELIVERIES) {
      logger.error(
        "Poison command ACKed and dropped after repeated redelivery",
        {
          streamId: msg.id,
          messageId: data?.messageId,
          commandType: data?.type,
          deliveries,
          maxDeliveries: PENDING_POISON_MAX_DELIVERIES,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      if (data) {
        await markProcessed(streamOps, processedMessageIds, data.messageId);
      }
      await safeAck(streamOps, msg.id);
    }
  }
}

/** Redelivery counter for one pending entry; 0 when unknown (keep retrying). */
async function pendingDeliveries(
  streamOps: RedisStreamOperations,
  streamId: string
): Promise<number> {
  try {
    return await streamOps.getPendingDeliveries(
      ENGINE_COMMANDS_STREAM,
      ENGINE_COMMANDS_CONSUMER_GROUP,
      streamId
    );
  } catch {
    return 0;
  }
}

async function handleCommand(
  botManager: BotManager,
  streamOps: RedisStreamOperations,
  command: BotCommand
): Promise<void> {
  // Capture before the type-predicate chain: after the false branches of
  // isBotStartCommand/isBotStopCommand, TypeScript narrows `command` to
  // `never`, so the status/fallback branches must use these.
  const { type: commandType, payload, correlationId } = command;
  // Protocol guards (type + payload.botId) — the legacy flat-shape
  // isStartBotCommand/isStopBotCommand guards can never match a protocol
  // envelope, and using them here silently ACKed every BOT_START/BOT_STOP
  // without dispatching (ENGINE_NO_RESPONSE, ledger L18).
  if (isBotStartCommand(command)) {
    const payload = command.payload;
    await botManager.publishAccepted(
      streamOps,
      payload.botId,
      "BOT_START",
      command.correlationId
    );
    await botManager.handleStart(
      streamOps,
      payload.botId,
      payload.userId,
      payload.strategyId,
      payload.config,
      command.correlationId,
      payload.runs
    );
  } else if (isBotStopCommand(command)) {
    // Parity with BOT_START: the engine must ACK every command it consumes.
    // Without this accept the tracked BOT_STOP row stayed PENDING even when the
    // stop completed, so the backend sweep burned a *successful* stop as
    // COMMAND_NEVER_DELIVERED / STOP_INCOMPLETE (L21).
    await botManager.publishAccepted(
      streamOps,
      command.payload.botId,
      "BOT_STOP",
      command.correlationId
    );
    await botManager.handleStop(
      streamOps,
      command.payload.botId,
      command.correlationId
    );
  } else if (isBotEmergencyStopCommand(command)) {
    // M1: the panic button publishes a real EMERGENCY_STOP command. ACK it
    // (the tracked row stays PENDING until the engine reports) and run the
    // stop + venue-side cleanup selected by the payload action.
    //
    // `command` narrows to `never` here for the same reason as the status
    // branch above, so read the fields off the captured payload — the guard
    // has already validated botId and action.
    const emergency = payload as EmergencyStopCommandPayload;
    await botManager.publishAccepted(
      streamOps,
      emergency.botId,
      "EMERGENCY_STOP",
      correlationId
    );
    await botManager.handleEmergencyStop(
      streamOps,
      emergency.botId,
      emergency.action,
      correlationId
    );
  } else if (isStatusRequestCommand(command)) {
    // Status request handling
    logger.debug("Status request received", { botId: payload.botId });
  } else {
    // Envelope says BOT_* but the payload failed its guard (e.g. missing
    // botId). The command is still ACKed, so log loudly — otherwise this
    // fall-through would be completely invisible (the L18 failure mode).
    logger.warn("Command payload failed type guards", { type: commandType });
  }
}

async function recoverPending(
  streamOps: RedisStreamOperations,
  botManager: BotManager,
  processedMessageIds: Set<string>
): Promise<void> {
  try {
    const result = await streamOps.claimPending(
      ENGINE_COMMANDS_STREAM,
      ENGINE_COMMANDS_CONSUMER_GROUP,
      "engine-consumer",
      PENDING_RECOVERY_MIN_IDLE_MS,
      10
    );

    if (result.success && result.messages && result.messages.length > 0) {
      for (const msg of result.messages) {
        await processMessage(streamOps, botManager, msg, processedMessageIds);
      }
    }
  } catch (error) {
    logger.debug("Pending recovery failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkPendingInsight(
  streamOps: RedisStreamOperations
): Promise<void> {
  try {
    const insight = await streamOps.getPendingInsight(
      ENGINE_COMMANDS_STREAM,
      ENGINE_COMMANDS_CONSUMER_GROUP,
      {
        stuckThresholdMs: PENDING_STUCK_ALERT_THRESHOLD_MS,
        poisonThreshold: PENDING_POISON_MAX_DELIVERIES,
      }
    );
    if (insight.stuckCount > 0) {
      logger.warn("Pending command backlog detected", {
        stuckCount: insight.stuckCount,
      });
    }
    if (insight.poisonIds.length > 0) {
      logger.warn("Poison commands detected", { poisonIds: insight.poisonIds });
    }
  } catch (_error) {
    logger.debug("Pending insight check failed");
  }
}

async function safeAck(
  streamOps: RedisStreamOperations,
  streamId: string
): Promise<void> {
  await streamOps.ack(
    ENGINE_COMMANDS_STREAM,
    ENGINE_COMMANDS_CONSUMER_GROUP,
    streamId
  );
}
