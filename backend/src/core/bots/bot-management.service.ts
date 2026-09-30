/**
 * Pure Bot Management Service - Clean Architecture Implementation
 *
 * READ-side business logic for bot instances: listing, lifecycle snapshots,
 * performance metrics and terminal-history cleanup. This service contains
 * pure business logic and depends only on interfaces from shared.
 *
 * Lifecycle WRITES do not live here. `createAndStartBot()` / `stopBot()`
 * flipped `bot_instances.status` directly — no compare-and-set, no
 * `assertTransition()`, no `bot_lifecycle_events` trail and, worst of all,
 * no command to the engine, so a bot could read RUNNING in the database
 * while nothing was traded (and STOPPED while it still was). Both were
 * superseded by `BotLifecycleService` — the sole owner of lifecycle state —
 * and had zero callers outside their own tests, so they were removed the
 * same way the `emergencyStop()` row-flip stub was. Start/stop goes through
 * `BotLifecycleService.createAndStart()` / `.stop()`.
 *
 * Dependencies (injected):
 * - IBotInstanceRepository: Bot instance data access abstraction
 * - IStrategyRepository: Strategy data access abstraction
 * - IAuditLogRepository: Audit logging abstraction
 * - ILogger: Logging abstraction
 *
 * @format
 */

import {
  BotInstanceRecord,
  IBotInstanceRepository,
  IStrategyRepository,
  IAuditLogRepository,
  ILogger,
} from "@trade-bot/shared";

export interface BotManagementServiceDependencies {
  botInstanceRepository: IBotInstanceRepository;
  strategyRepository: IStrategyRepository;
  auditLogRepository: IAuditLogRepository;
  logger: ILogger;
}

/** Lifecycle snapshot returned by {@link BotManagementService.getBotStatus}. */
export interface BotStatusSnapshot extends BotInstanceRecord {
  statusValidation: {
    isStale: boolean;
    lastHeartbeatAge: number;
    engineHealth: {
      running: boolean;
      lastHealthCheck: number;
      status: string;
    };
  };
}

/** Metrics returned by {@link BotManagementService.getBotPerformance}. */
export interface BotPerformanceMetrics {
  totalTrades: number;
  totalPnL: number;
  winRate: number;
  avgTrade: number;
  bestTrade: number;
  worstTrade: number;
}

export class BotManagementService {
  constructor(private deps: BotManagementServiceDependencies) {}

  /**
   * Get all bot instances for a user
   */
  async getBotInstances(userId: string): Promise<BotInstanceRecord[]> {
    try {
      const botInstances =
        await this.deps.botInstanceRepository.getBotInstances(userId);
      this.deps.logger.debug("Bot instances retrieved successfully", {
        userId,
        count: botInstances.length,
      });
      return botInstances;
    } catch (error) {
      this.deps.logger.error("Failed to get bot instances", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw new Error("Failed to get bot instances");
    }
  }

  /**
   * Get bot instance by ID
   */
  async getBotInstance(id: string): Promise<BotInstanceRecord | null> {
    try {
      const botInstance =
        await this.deps.botInstanceRepository.getBotInstance(id);
      this.deps.logger.debug("Bot instance retrieved successfully", {
        botId: id,
      });
      return botInstance;
    } catch (error) {
      this.deps.logger.error("Failed to get bot instance", {
        error: error instanceof Error ? error.message : String(error),
        botId: id,
      });
      throw new Error("Failed to get bot instance");
    }
  }

  /**
   * Get bot status
   */
  async getBotStatus(botId: string): Promise<BotStatusSnapshot> {
    try {
      const botInstance =
        await this.deps.botInstanceRepository.getBotInstance(botId);
      if (!botInstance) {
        throw new Error("Bot not found");
      }

      const statusInfo = {
        ...botInstance,
        statusValidation: {
          isStale: false,
          lastHeartbeatAge: 0,
          engineHealth: {
            running: true,
            lastHealthCheck: Date.now(),
            status: "healthy",
          },
        },
      };

      this.deps.logger.debug("Bot status retrieved successfully", { botId });
      return statusInfo;
    } catch (error) {
      this.deps.logger.error("Failed to get bot status", {
        error: error instanceof Error ? error.message : String(error),
        botId,
      });
      throw new Error("Failed to get bot status");
    }
  }

  /**
   * Get bot performance metrics
   */
  async getBotPerformance(botId: string): Promise<BotPerformanceMetrics> {
    try {
      const botInstance =
        await this.deps.botInstanceRepository.getBotInstance(botId);
      if (!botInstance) {
        throw new Error("Bot not found");
      }

      const performance = {
        totalTrades: botInstance.total_trades || 0,
        totalPnL: botInstance.total_pnl || 0,
        winRate: 0,
        avgTrade: 0,
        bestTrade: 0,
        worstTrade: 0,
      };

      this.deps.logger.debug("Bot performance retrieved successfully", {
        botId,
      });
      return performance;
    } catch (error) {
      this.deps.logger.error("Failed to get bot performance", {
        error: error instanceof Error ? error.message : String(error),
        botId,
      });
      throw new Error("Failed to get bot performance");
    }
  }

  /**
   * Delete a stopped bot instance (terminal history cleanup).
   *
   * Only bots in a terminal `actual_state` (STOPPED/ERROR/UNKNOWN) can be
   * deleted: they cannot be trading on the engine, so removal is pure
   * history cleanup and can never orphan exposure. Live bots
   * (STARTING/RUNNING/STOPPING) or `desired_state=RUNNING` are refused with
   * an error the route maps to 409 — stop them first.
   */
  async deleteTerminalBot(botId: string, userId: string): Promise<void> {
    try {
      const botInstance =
        await this.deps.botInstanceRepository.getBotInstance(botId);
      if (!botInstance || botInstance.user_id !== userId) {
        throw new Error("Bot not found or does not belong to user");
      }
      const actual = (botInstance.actual_state ?? botInstance.status) as string;
      const desired = (botInstance as { desired_state?: string }).desired_state;
      if (
        desired === "RUNNING" ||
        actual === "STARTING" ||
        actual === "RUNNING" ||
        actual === "STOPPING"
      ) {
        throw new Error(
          "Bot is still active. Stop it before deleting its history."
        );
      }
      await this.deps.botInstanceRepository.deleteBotInstance(botId);
      this.deps.logger.info("Terminal bot deleted", {
        botId,
        userId,
        actualState: actual,
      });
    } catch (error) {
      this.deps.logger.error("Failed to delete terminal bot", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        botId,
      });
      throw error;
    }
  }

  /**
   * Delete every bot instance bound to one strategy (strategy delete helper).
   *
   * The FK `strategies → bot_instances` is ON DELETE CASCADE, but legacy
   * lifecycle children (`bot_lifecycle_events`, `bot_commands`) are cascade
   * too — an explicit per-row delete keeps the audit path and works when
   * the strategy row is already gone (orphaned Terminal history).
   */
  async deleteBotsForStrategy(strategyId: string): Promise<number> {
    const bots =
      await this.deps.botInstanceRepository.getBotInstancesByStrategy(
        strategyId
      );
    for (const bot of bots) {
      await this.deps.botInstanceRepository.deleteBotInstance(bot.id);
    }
    return bots.length;
  }
}

// Export factory function for creating service instances
export function createBotManagementService(
  deps: BotManagementServiceDependencies
): BotManagementService {
  return new BotManagementService(deps);
}
