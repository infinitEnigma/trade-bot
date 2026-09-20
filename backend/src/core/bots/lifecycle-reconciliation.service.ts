/**
 * Lifecycle Reconciliation Service
 *
 * Replaces the legacy `BotReconciliationWorker` (which predates the
 * desired/actual lifecycle model and never repaired state drift).
 *
 * Responsibilities (read-only observation + authoritative repairs):
 * - desired=STOPPED, engine still active -> reissue BOT_STOP (bounded).
 * - transitional state stuck with no PENDING command beyond the grace
 *   window -> degrade to UNKNOWN via a CAS transition.
 * - desired=RUNNING, actual ERROR/UNKNOWN -> audit-only marker; NO auto-start.
 *
 * It NEVER writes lifecycle state directly: all repairs go through
 * BotLifecycleService (the sole lifecycle writer) or command dispatch, so
 * every repair is tracked, audited and supervised like a user command.
 *
 * Safety gates (enforced by startup ordering in backend/src/index.ts):
 * - Must start AFTER database migrations/pool are healthy.
 * - Must start AFTER engine protocol, command-timeout sweeper and engine
 *   registry supervision are running.
 *
 * @format
 */

import { contextLogger as logger } from "../logging";
import { botLifecycleService } from "./bot-lifecycle.service";
import { BotLifecycleRepository } from "./lifecycle/bot-lifecycle.repository";
import { BOT_COMMAND_TIMEOUT_MS } from "./lifecycle/types";

/** How often the reconciliation sweep runs. */
const RECONCILE_INTERVAL_MS = Number(
  process.env.LIFECYCLE_RECONCILE_INTERVAL_MS ?? 60_000
);
/** A transitional bot must be stuck for at least this long (3x command timeout). */
const STUCK_GRACE_MS = Number(
  process.env.LIFECYCLE_RECONCILE_STUCK_GRACE_MS ?? 3 * BOT_COMMAND_TIMEOUT_MS
);
/** Max automatic stop-reissues per bot per hour before we stop repairing. */
const MAX_STOP_REISSUES_PER_HOUR = Number(
  process.env.LIFECYCLE_RECONCILE_MAX_STOP_REISSUES ?? 3
);

export interface ReconcileRunResult {
  stopReissued: number;
  markedUnknown: number;
  needsUserAction: number;
  failures: number;
}

export class LifecycleReconciliationService {
  private repository = new BotLifecycleRepository();
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunResult: ReconcileRunResult | null = null;

  start(): void {
    if (this.intervalId) {
      return;
    }
    // Jitter to avoid aligning with other periodic jobs.
    const jitter = Math.floor(
      Math.random() * Math.min(RECONCILE_INTERVAL_MS / 4, 10_000)
    );
    this.intervalId = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        logger.error("Lifecycle reconciliation sweep failed", undefined, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, RECONCILE_INTERVAL_MS + jitter);
    // Do not keep the process alive just for the reconciler.
    this.intervalId.unref();
    logger.info("Lifecycle reconciliation service started", {
      intervalMs: RECONCILE_INTERVAL_MS,
      stuckGraceMs: STUCK_GRACE_MS,
      maxStopReissuesPerHour: MAX_STOP_REISSUES_PER_HOUR,
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Lifecycle reconciliation service stopped");
    }
  }

  getStatus(): { running: boolean; lastRunResult: ReconcileRunResult | null } {
    return {
      running: this.intervalId !== null,
      lastRunResult: this.lastRunResult,
    };
  }

  /**
   * One reconciliation pass. Safe to call manually (tests, admin endpoint).
   */
  async runOnce(): Promise<ReconcileRunResult> {
    if (this.running) {
      return (
        this.lastRunResult ?? {
          stopReissued: 0,
          markedUnknown: 0,
          needsUserAction: 0,
          failures: 0,
        }
      );
    }
    this.running = true;
    const result: ReconcileRunResult = {
      stopReissued: 0,
      markedUnknown: 0,
      needsUserAction: 0,
      failures: 0,
    };

    try {
      // 1. desired=STOPPED but engine still active -> bounded stop reissue.
      const drift = await this.repository.findDesiredStoppedButActiveBots();
      for (const bot of drift) {
        try {
          const reissues = await this.repository.countRecentStopReissues(
            bot.id
          );
          if (reissues >= MAX_STOP_REISSUES_PER_HOUR) {
            logger.warn("Reconcile stop-reissue budget exhausted, deferring", {
              botId: bot.id,
              actualState: bot.actual_state,
              reissuesLastHour: reissues,
            });
            continue;
          }
          await botLifecycleService.reissueStopForReconciliation(
            bot.id,
            "desired-stopped-drift"
          );
          result.stopReissued++;
          logger.warn("Reconciled stop drift: re-issued BOT_STOP", {
            botId: bot.id,
            actualState: bot.actual_state,
            engineId: bot.engine_id,
          });
        } catch (error) {
          result.failures++;
          logger.error("Reconcile stop-reissue failed", undefined, {
            botId: bot.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 2. Transitional states stuck beyond grace with no PENDING command -> UNKNOWN.
      const graceSeconds = Math.round(STUCK_GRACE_MS / 1000);
      const stuck =
        await this.repository.findStuckTransitionalBots(graceSeconds);
      for (const bot of stuck) {
        try {
          const persisted =
            await botLifecycleService.reconcileStuckTransitionToUnknown(
              bot.id,
              "stuck-beyond-grace"
            );
          if (persisted) {
            result.markedUnknown++;
            logger.error(
              "Reconciled stuck transitional bot to UNKNOWN",
              undefined,
              {
                botId: bot.id,
                fromState: bot.actual_state,
              }
            );
          }
        } catch (error) {
          result.failures++;
          logger.error("Reconcile stuck-transition failed", undefined, {
            botId: bot.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 3. desired=RUNNING but unconfirmed -> audit-only (no auto-start).
      const unconfirmed =
        await this.repository.findDesiredRunningUnconfirmedBots();
      for (const bot of unconfirmed) {
        try {
          await botLifecycleService.recordReconcileNeedsUserAction(
            bot.id,
            "desired-running-unconfirmed"
          );
          result.needsUserAction++;
          logger.warn(
            "Reconciled desired-RUNNING bot with unconfirmed engine state (user action required)",
            {
              botId: bot.id,
              actualState: bot.actual_state,
            }
          );
        } catch (error) {
          result.failures++;
          logger.error("Reconcile needs-user-action marker failed", undefined, {
            botId: bot.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.running = false;
    }

    this.lastRunResult = result;
    if (
      result.stopReissued +
        result.markedUnknown +
        result.needsUserAction +
        result.failures >
      0
    ) {
      logger.info("Lifecycle reconciliation sweep completed", { ...result });
    }
    return result;
  }
}

// Singleton instance. Started explicitly by the main server lifecycle only.
export const lifecycleReconciliationService =
  new LifecycleReconciliationService();
