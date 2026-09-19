/**
 * Command Timeout Sweeper - periodic supervision for lifecycle commands
 *
 * Runs `BotLifecycleService.sweepTimedOutCommands()` on an interval so that
 * commands accepted by Redis but never processed by the engine (engine down,
 * message lost) transition the bot out of STARTING/STOPPING into ERROR
 * instead of leaving it stuck forever.
 *
 * @format
 */

import { contextLogger as logger } from "../logging";
import { botLifecycleService } from "./bot-lifecycle.service";

const SWEEP_INTERVAL_MS = Number(
  process.env.BOT_COMMAND_SWEEP_INTERVAL_MS ?? 5_000
);

export class CommandTimeoutSweeper {
    private intervalId: NodeJS.Timeout | null = null;

    start(): void {
        if (this.intervalId) {
            return;
        }
        this.intervalId = setInterval(() => {
            void botLifecycleService
                .sweepTimedOutCommands()
                .then(count => {
                    if (count > 0) {
                        logger.warn("Command timeout sweep completed", { timedOut: count });
                    }
                })
                .catch((error: unknown) => {
                    logger.error("Command timeout sweep failed", undefined, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
        }, SWEEP_INTERVAL_MS);
        // Do not keep the process alive just for the sweeper.
        this.intervalId.unref();
    logger.info("Command timeout sweeper started", {
      intervalMs: SWEEP_INTERVAL_MS,
    });
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger.info("Command timeout sweeper stopped");
        }
    }

    getStatus(): { isRunning: boolean; intervalMs: number } {
    return {
      isRunning: this.intervalId !== null,
      intervalMs: SWEEP_INTERVAL_MS,
    };
    }
}

export const commandTimeoutSweeper = new CommandTimeoutSweeper();
