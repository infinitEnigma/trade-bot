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
import { LedgerTradeReporter } from "./trade-reporter";
import {
  pendingFillCount,
  pendingFillStatus,
} from "../infrastructure/state/pending-fill-journal";

const ENGINE_HEARTBEAT_INTERVAL_MS = Number(
  process.env.ENGINE_HEARTBEAT_INTERVAL_MS || 10_000
);
const ENGINE_VERSION = "kodiak@1.0.0";
/**
 * Idle retry cadence for journaled fills (F1): a pending entry with no
 * subsequent trigger (no startup, no session start, no new fill) must not
 * wait indefinitely. Skips the pass when the journal is empty.
 */
const PENDING_FILL_RETRY_INTERVAL_MS = Number(
  process.env.PENDING_FILL_RETRY_INTERVAL_MS || 30_000
);

/**
 * Start the heartbeat loop. Periodically publishes ENGINE_HEARTBEAT
 * events with the engine's runtime inventory.
 *
 * Also starts the pending-fill retry loop (F1): every
 * PENDING_FILL_RETRY_INTERVAL_MS the journal is re-played while entries
 * remain, so a quiet bot cannot leave fills pending indefinitely. The
 * heartbeat payload carries `pendingFills` so the backend can alert on a
 * journal that never drains.
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

  let retryInFlight = false;
  // Per-process heartbeat sequence, +1 each beat. Paired with `epoch` by the
  // backend to order journal-integrity writes; resets every restart (a new
  // epoch), which is exactly what makes the (epoch, seq) composite restart-safe.
  let heartbeatSeq = 0;
  const retryId = setInterval(() => {
    if (retryInFlight) return;
    const status = pendingFillStatus();
    if (status.unknown) {
      // Nothing iterable to replay, but the backend must hear about it:
      // UNKNOWN integrity is a distinct alert from "drained".
      logger.error(
        "Fill-journal integrity unknown - operator reconciliation required",
        { engineId, epoch }
      );
    }
    if (status.pending === 0) return;
    retryInFlight = true;
    void new LedgerTradeReporter(streamOps, engineId, epoch)
      .replayPendingFills()
      .catch((error: unknown) => {
        // replayPendingFills never rejects; this is defence in depth.
        logger.error("Periodic pending-fill replay threw", {
          engineId,
          epoch,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        retryInFlight = false;
      });
  }, PENDING_FILL_RETRY_INTERVAL_MS);

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
        pendingFills: pendingFillCount(),
        pendingFillsUnknown: pendingFillStatus().unknown,
        heartbeatSeq: ++heartbeatSeq,
      },
      crypto.randomUUID()
    );
  }, ENGINE_HEARTBEAT_INTERVAL_MS);

  logger.info("Engine heartbeat started", {
    engineId,
    intervalMs: ENGINE_HEARTBEAT_INTERVAL_MS,
    pendingFillRetryMs: PENDING_FILL_RETRY_INTERVAL_MS,
  });

  // Return cleanup function
  return (): void => {
    clearInterval(intervalId);
    clearInterval(retryId);
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
    // D3 sessions: stop every run's strategy too (primary already stopped).
    if (runtime.runs) {
      for (const [, run] of runtime.runs) {
        if (run.strategy === runtime.strategy) continue;
        try {
          await run.strategy.stop();
        } catch (error) {
          logger.error("Error stopping run during shutdown", {
            botId: runtime.botId,
            runId: run.runId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    runtime.stopTick();
    if (runtime.runs) {
      for (const [, run] of runtime.runs) {
        if (run.stopTick !== runtime.stopTick) run.stopTick();
      }
    }
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
