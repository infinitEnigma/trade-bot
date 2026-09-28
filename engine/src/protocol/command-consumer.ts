/**
 * Command Consumer
 *
 * Reads commands from Redis Streams and dispatches them to the BotManager.
 * Handles deduplication, pending message recovery, and poison message detection.
 *
 * @format
 */

import {
  BotCommand,
  isBotCommand,
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

    // Dedup check
    if (processedMessageIds.has(data.messageId)) {
      logger.debug("Duplicate command ignored", { messageId: data.messageId });
      await safeAck(streamOps, msg.id);
      return;
    }

    await handleCommand(botManager, streamOps, data);
    processedMessageIds.add(data.messageId);
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
      processedMessageIds.add(data.messageId);
      await safeAck(streamOps, msg.id);
    }
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
  const { type: commandType, payload } = command;
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
      command.correlationId
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
