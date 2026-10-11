/**
 * Trading Engine Entry Point
 *
 * Bootstraps the engine: connects to Redis, initializes identity,
 * starts the bot manager, and begins listening for commands.
 *
 * @format
 */

import "dotenv/config";
import { getRedisStreamOperations } from "./infrastructure/redis/streams";
import { logger } from "./utils/logger";
import { BotManager } from "./application/bot-manager";
import { listenForCommands } from "./protocol/command-consumer";
import { startHeartbeat, stopAll } from "./application/lifecycle-coordinator";
import { loadOrCreateEngineIdentity } from "./domain/engine-identity";
import { LedgerTradeReporter } from "./application/trade-reporter";

let activeBotManager: BotManager | null = null;

async function main(): Promise<void> {
  const streamOps = getRedisStreamOperations();

  try {
    logger.info("Starting Trading Engine");

    // Connect to Redis
    await streamOps.connect();
    await streamOps.createConsumerGroup(
      "tradebot:engine:commands",
      "engine-workers"
    );

    // Initialize engine identity
    const identity = loadOrCreateEngineIdentity();
    logger.info("Engine identity loaded", {
      engineId: identity.engineId,
      epoch: identity.epoch,
    });

    // F1: re-deliver fills journaled by the previous process (Redis outage or
    // crash between fill detection and stream acceptance) under this
    // process's identity, before any command starts trading. Never rejects;
    // a still-unreachable Redis simply leaves the journal intact for the
    // bot-session-start replay.
    await new LedgerTradeReporter(
      streamOps,
      identity.engineId,
      identity.epoch
    ).replayPendingFills();

    // Create bot manager
    activeBotManager = new BotManager(identity);

    // Start heartbeat (stop function reserved for shutdown wiring)
    startHeartbeat(
      streamOps,
      identity.engineId,
      identity.epoch,
      () => activeBotManager?.activeBotIds ?? []
    );

    // Start listening for commands
    await listenForCommands(activeBotManager, streamOps);
  } catch (error) {
    logger.error("Failed to start Trading Engine", {
      error: error instanceof Error ? error.message : String(error),
    });
    // eslint-disable-next-line no-process-exit -- entrypoint must exit non-zero on fatal startup failure
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down engine`, {
    engineId: activeBotManager?.activeBotIds,
  });
  if (activeBotManager) {
    const streamOps = getRedisStreamOperations();
    const identity = loadOrCreateEngineIdentity();
    await stopAll(
      activeBotManager.getBotRuntimes(),
      streamOps,
      identity.engineId,
      identity.epoch,
      "graceful_shutdown"
    );
  }
  // eslint-disable-next-line no-process-exit -- graceful engine shutdown must terminate the process after cleanup
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void main();
