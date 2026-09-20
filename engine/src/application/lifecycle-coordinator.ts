/**
 * Lifecycle Coordinator
 *
 * Manages engine registration and heartbeat with the backend.
 * Handles graceful shutdown of all bots.
 *
 * @format
 */

import { RedisStreamOperations } from "../infrastructure/redis/streams";
import { logger } from "../utils/logger";
import { BotRuntime } from "../domain/bot-runtime";
import { publishEvent } from "../protocol/event-publisher";

const ENGINE_HEARTBEAT_INTERVAL_MS = Number(
  process.env.ENGINE_HEARTBEAT_INTERVAL_MS || 10_000
);
const ENGINE_VERSION = "kodiak@1.0.0";

/**
 * Start the heartbeat loop. Periodically publishes ENGINE_HEARTBEAT
 * events with the engine's runtime inventory.
 */
export function startHeartbeat(
  streamOps: RedisStreamOperations,
  engineId: string,
  epoch: number,
  getActiveBotIds: () => string[]
): () => void {
  // Register on startup
  void publishEvent(
    streamOps,
    "ENGINE_REGISTER",
    {
      engineId,
      epoch,
      version: ENGINE_VERSION,
      startedAt: new Date().toISOString(),
    },
    crypto.randomUUID()
  );

  // Start periodic heartbeat
  const intervalId = setInterval(() => {
    void publishEvent(
      streamOps,
      "ENGINE_HEARTBEAT",
      {
        engineId,
        epoch,
        activeBotIds: getActiveBotIds(),
        version: ENGINE_VERSION,
      },
      crypto.randomUUID()
    );
  }, ENGINE_HEARTBEAT_INTERVAL_MS);

  logger.info("Engine heartbeat started", {
    engineId,
    intervalMs: ENGINE_HEARTBEAT_INTERVAL_MS,
  });

  // Return cleanup function
  return (): void => {
    clearInterval(intervalId);
    logger.info("Engine heartbeat stopped", { engineId });
  };
}

/**
 * Stop all bots gracefully. Cancels orders and publishes
 * STOPPED events for each bot.
 */
export async function stopAll(
  bots: Map<string, BotRuntime>,
  streamOps: RedisStreamOperations,
  engineId: string,
  epoch: number,
  reason: string
): Promise<void> {
  const correlationId = crypto.randomUUID();

  for (const [, runtime] of bots) {
    try {
      await runtime.strategy.stop();
    } catch (error) {
      logger.error("Error stopping bot during shutdown", {
        botId: runtime.botId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    runtime.stopTick();
    try {
      await publishEvent(
        streamOps,
        "STATE_CHANGED",
        {
          botId: runtime.botId,
          engineId,
          engineEpoch: epoch,
          from: "STOPPING",
          to: "STOPPED",
          reason,
        },
        correlationId
      );
    } catch (error) {
      logger.error("Error reporting STOPPED for shutdown", {
        botId: runtime.botId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  bots.clear();
}
