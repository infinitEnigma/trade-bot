/**
 * Pure Strategy Service - Clean Architecture Implementation
 *
 * Business logic for strategy operations including creation, retrieval, updating, and deletion.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IStrategyRepository: Strategy data access abstraction
 * - IBotInstanceRepository: Bot instance data access abstraction
 * - ILogger: Logging abstraction
 *
 * @format
 */

import {
  IStrategyRepository,
  IBotInstanceRepository,
  ILogger,
  Strategy,
  StrategyConfig,
  StrategyFillTotals,
  StrategyType,
  StrategyVenue,
} from "@trade-bot/shared";
import { ILifecycleRepository } from "../bots/lifecycle/lifecycle-repository.port";

export interface StrategyServiceDependencies {
  strategyRepository: IStrategyRepository;
  botInstanceRepository: IBotInstanceRepository;
  logger: ILogger;
  /**
   * Lifecycle persistence port (review P1): `updateStrategyGuarded` locks the
   * strategy row through it so a start/attach cannot interleave with the edit.
   * The PostgreSQL adapter is wired by the DI container.
   */
  lifecycleRepository: ILifecycleRepository;
}

/**
 * Ledger-backed strategy performance metrics (Phase 1). Served by
 * `GET /api/strategies/:id/performance` — a lifetime aggregate over the fill
 * ledger, NOT a per-session figure (session totals reset on restart; these
 * do not).
 */
export interface StrategyPerformanceMetrics {
  /** Ledger fill rows attributed to the strategy (fills = trades, A8). */
  totalTrades: number;
  /** Realised PnL net of fees over KNOWN fills only (F2). */
  totalPnL: number;
  /**
   * Fills booked with unknown PnL. Non-zero ⇒ `totalPnL` sums known fills
   * only and is INCOMPLETE (unknown direction, never a lower bound) — every
   * render site must surface the count instead of implying net PnL.
   */
  unknownPnlFills: number;
  /** winningFills / knownPnlFills × 100; 0 when no known fills exist. */
  winRate: number;
  /** totalPnL / knownPnlFills; 0 when none. */
  avgTrade: number;
  /** MAX known pnl; null when no known fill exists (never a fabricated 0). */
  bestTrade: number | null;
  /** MIN known pnl; null when no known fill exists. */
  worstTrade: number | null;
  /** SUM(fee) over fills whose fee was known. */
  totalFees: number;
  /** Fills whose fee the venue could not source — totalFees excludes them. */
  unknownFeeFills: number;
  /** ISO-8601 of the oldest attributed fill; null when none. */
  firstFillAt: string | null;
  /** ISO-8601 of the newest attributed fill; null when none. */
  lastFillAt: string | null;
}

export class StrategyService {
  constructor(private deps: StrategyServiceDependencies) {}

  /**
   * Get all strategies for a user
   */
  async getStrategies(userId: string): Promise<Strategy[]> {
    try {
      const strategies =
        await this.deps.strategyRepository.getStrategies(userId);
      this.deps.logger.debug("Strategies retrieved successfully", {
        userId,
        count: strategies.length,
      });
      return strategies;
    } catch (error) {
      this.deps.logger.error("Failed to get strategies", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw new Error("Failed to get strategies");
    }
  }

  /**
   * Get strategy by ID
   */
  async getStrategy(id: string): Promise<Strategy | null> {
    try {
      const strategy = await this.deps.strategyRepository.getStrategy(id);
      this.deps.logger.debug("Strategy retrieved successfully", {
        strategyId: id,
      });
      return strategy;
    } catch (error) {
      this.deps.logger.error("Failed to get strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      throw new Error("Failed to get strategy");
    }
  }

  /**
   * Create a new strategy
   */
  async createStrategy(
    userId: string,
    strategyData: Omit<Strategy, "id" | "userId" | "createdAt" | "updatedAt">
  ): Promise<Strategy> {
    try {
      const strategy = await this.deps.strategyRepository.createStrategy({
        userId,
        ...strategyData,
      });
      this.deps.logger.info("Strategy created successfully", {
        strategyId: strategy.id,
        userId,
      });
      return strategy;
    } catch (error) {
      this.deps.logger.error("Failed to create strategy", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        strategyData,
      });
      throw new Error("Failed to create strategy");
    }
  }

  /**
   * Full-replacement update (migration 026). The caller supplies the complete
   * strategy — name, type, full config, and the atomic venue pair. Partial
   * config patches are rejected: a partial would be serialized over the whole
   * JSONB column and silently erase omitted fields.
   */
  async updateStrategy(
    id: string,
    updates: {
      name: string;
      type: StrategyType;
      config: StrategyConfig;
      exchange: StrategyVenue["exchange"];
      environment: StrategyVenue["environment"];
    }
  ): Promise<Strategy | null> {
    try {
      StrategyService.assertCompleteConfig(updates.type, updates.config);
      await this.deps.strategyRepository.updateStrategy(id, updates);
      const updatedStrategy =
        await this.deps.strategyRepository.getStrategy(id);
      this.deps.logger.info("Strategy updated successfully", {
        strategyId: id,
      });
      return updatedStrategy;
    } catch (error) {
      this.deps.logger.error("Failed to update strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
        updates,
      });
      if ((error as Error & { statusCode?: number }).statusCode) throw error;
      throw new Error("Failed to update strategy");
    }
  }

  /**
   * Validate that `config` is complete for `type` (migration 026). Mirrors
   * the route Joi schemas — the three layers (API, service, repository
   * contract) enforce the same rules so Joi never accepts what the service
   * rejects, and the service never persists an incomplete config.
   */
  static assertCompleteConfig(
    type: StrategyType,
    config: StrategyConfig
  ): void {
    const fail = (message: string): never => {
      const error = new Error(message);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    };
    if (!config || typeof config.symbol !== "string" || !config.symbol.trim()) {
      fail("Strategy config is missing symbol");
    }
    if (type === StrategyType.GRID) {
      if (
        !Number.isInteger(config.gridSize) ||
        (config.gridSize as number) < 2
      ) {
        fail("GRID config requires gridSize (integer >= 2)");
      }
      if (
        typeof config.gridRange !== "number" ||
        !((config.gridRange as number) > 0)
      ) {
        fail("GRID config requires gridRange (positive number)");
      }
      if (
        typeof config.orderQuantity !== "number" ||
        !((config.orderQuantity as number) > 0)
      ) {
        fail("GRID config requires orderQuantity (positive number)");
      }
    } else if (type === StrategyType.TREND_FOLLOWING) {
      if (
        typeof config.entryThreshold !== "number" ||
        typeof config.exitThreshold !== "number"
      ) {
        fail(
          "TREND_FOLLOWING config requires entryThreshold and exitThreshold"
        );
      }
    }
  }

  /**
   * Guarded full-replacement update (migration 026, P0 race). The edit
   * blocker check and the write share one strategy-row `FOR UPDATE` lock so
   * a start/attach racing this PUT cannot interleave: either the edit commits
   * first (admission revalidates the new row) or admission wins (PUT 409s).
   * Only symbol/venue-affecting fields go through the blocker gate — but the
   * write itself is always the full replacement, so the row never holds a
   * half-applied patch.
   */
  async updateStrategyGuarded(
    id: string,
    updates: {
      name: string;
      type: StrategyType;
      config: StrategyConfig;
      exchange: StrategyVenue["exchange"];
      environment: StrategyVenue["environment"];
    }
  ): Promise<Strategy | null> {
    StrategyService.assertCompleteConfig(updates.type, updates.config);
    try {
      await this.deps.lifecycleRepository.inTransaction(async tx => {
        const locked = await this.deps.lifecycleRepository.lockStrategyRow(
          tx,
          id
        );
        if (!locked) {
          const notFound = new Error("Strategy not found");
          (notFound as Error & { statusCode?: number }).statusCode = 404;
          throw notFound;
        }
        const symbolChanged =
          String(
            (updates.config as unknown as { symbol?: unknown }).symbol ?? ""
          ) !== locked.symbol;
        const venueChanged =
          updates.exchange !== locked.exchange ||
          updates.environment !== locked.environment;
        if (symbolChanged || venueChanged) {
          const block = await this.deps.lifecycleRepository.findEditBlockersTx(
            tx,
            id
          );
          if (block.blocked) {
            const locked_err = new Error(
              `Strategy cannot be edited while live: ${block.reason}. Stop the run and resolve orders/exposure first.`
            );
            (locked_err as Error & { statusCode?: number }).statusCode = 409;
            throw locked_err;
          }
        }
        // `tx` is core's opaque LifecycleTx; the shared `updateStrategyTx`
        // types its client as unknown and the adapter narrows to { query } —
        // at runtime it is the same pg client the lifecycle tx wraps.
        await this.deps.strategyRepository.updateStrategyTx?.(id, updates, tx);
        if (!this.deps.strategyRepository.updateStrategyTx) {
          await this.deps.strategyRepository.updateStrategy(id, updates);
        }
      });
      return this.deps.strategyRepository.getStrategy(id);
    } catch (error) {
      this.deps.logger.error("Failed guarded strategy update", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      if ((error as Error & { statusCode?: number }).statusCode) throw error;
      throw new Error("Failed to update strategy");
    }
  }

  /**
   * Delete strategy
   */
  async deleteStrategy(id: string): Promise<void> {
    try {
      // Delete ALL associated bot instances first — live and terminal.
      // getActiveBotInstances only covers live rows (legacy `status`), so a
      // strategy delete through it would leak STOPPED/ERROR/UNKNOWN history
      // that keeps blocking the venue-account revoke (FK RESTRICT, 013).
      // The strategy→bot FK is ON DELETE CASCADE (001), but the explicit
      // per-row delete also clears lifecycle children deterministically.
      const botInstances =
        await this.deps.botInstanceRepository.getBotInstancesByStrategy(id);
      for (const botInstance of botInstances) {
        await this.deps.botInstanceRepository.deleteBotInstance(botInstance.id);
      }

      // Delete the strategy
      await this.deps.strategyRepository.deleteStrategy(id);
      this.deps.logger.info("Strategy deleted successfully", {
        strategyId: id,
      });
    } catch (error) {
      this.deps.logger.error("Failed to delete strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      throw new Error("Failed to delete strategy");
    }
  }

  /**
   * Toggle strategy active status
   */
  async toggleStrategy(id: string, active: boolean): Promise<void> {
    try {
      await this.deps.strategyRepository.toggleStrategy(id, active);
      this.deps.logger.info("Strategy status toggled", {
        strategyId: id,
        active,
      });
    } catch (error) {
      this.deps.logger.error("Failed to toggle strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
        active,
      });
      throw new Error("Failed to toggle strategy");
    }
  }

  /**
   * Lifetime strategy performance from the fill ledger (Phase 1).
   *
   * Replaces the old all-zeros placeholder. The aggregate lives in the
   * repository (single SQL over `bot_trade_fills WHERE strategy_id`); this
   * layer only derives the ratios and enforces the honesty rules:
   * - win rate / avg trade divide by KNOWN-pnl fills only — unknown-PnL fills
   *   are surfaced in `unknownPnlFills`, never counted as losses (F2);
   * - `bestTrade`/`worstTrade` are null when nothing known exists, never 0.
   *
   * Ownership is the route's job (404 before this call) — this method trusts
   * the strategyId it is handed, like the rest of the service.
   */
  async getStrategyPerformance(
    id: string
  ): Promise<StrategyPerformanceMetrics> {
    let totals: StrategyFillTotals | undefined;
    try {
      totals = await this.deps.strategyRepository.getStrategyFillTotals?.(id);
    } catch (error) {
      this.deps.logger.error("Failed to get strategy performance", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      throw new Error("Failed to get strategy performance");
    }
    if (!totals) {
      // Optional-port precedent (updateStrategyTx): absent wiring fails
      // loudly and OUTSIDE the catch above so the reason survives — an
      // all-zero payload would read as "no profit", which is a lie.
      this.deps.logger.error("Strategy fill-totals repository is not wired", {
        strategyId: id,
      });
      throw new Error("Strategy fill-totals repository is not wired");
    }
    // Pure derivation from here — no failure mode left to wrap.
    const known = totals.knownPnlFills;
    return {
      totalTrades: totals.totalFills,
      totalPnL: totals.realizedPnl,
      unknownPnlFills: totals.unknownPnlFills,
      winRate: known > 0 ? (totals.winningFills / known) * 100 : 0,
      avgTrade: known > 0 ? totals.realizedPnl / known : 0,
      bestTrade: totals.bestFill,
      worstTrade: totals.worstFill,
      totalFees: totals.totalFees,
      unknownFeeFills: totals.unknownFeeFills,
      firstFillAt: totals.firstFillAt,
      lastFillAt: totals.lastFillAt,
    };
  }
}

// Export factory function for creating service instances
export function createStrategyService(
  deps: StrategyServiceDependencies
): StrategyService {
  return new StrategyService(deps);
}
