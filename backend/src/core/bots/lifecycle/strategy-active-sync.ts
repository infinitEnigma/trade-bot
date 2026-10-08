/**
 * `strategies.active` sync — the strategy badge tracks bot lifecycle
 * (Phase 2, strategy start/stop).
 *
 * `strategies.active` used to be write-once FALSE: the `toggleStrategy`
 * service/repository methods existed but nothing ever called them (no HTTP
 * route, no UI control), so every strategy rendered "Inactive" forever.
 * It is now flipped from the places that actually start/stop execution:
 *
 * - start command dispatched / engine reports RUNNING → `true`
 * - stop command dispatched / emergency stop /
 *   engine reports STOPPED|ERROR (incl. command failures) → `false`
 *
 * Every flip is best-effort: a badge failure is logged and NEVER fails the
 * lifecycle operation it decorates (the bot is the source of truth; the
 * badge is presentation).
 *
 * @format
 */

import { contextLogger as logger } from "../../logging";
import { strategyRepositoryAdapter } from "../../../infrastructure/adapters/repositories/strategy-repository.adapter";
import { BotLifecycleRepository } from "./bot-lifecycle.repository";

export async function syncStrategyActive(
  strategyId: string | null | undefined,
  active: boolean
): Promise<void> {
  if (!strategyId) return;
  try {
    await strategyRepositoryAdapter.toggleStrategy(strategyId, active);
  } catch (error) {
    logger.warn("Failed to sync strategy active flag", {
      strategyId,
      active,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Badge sync for a whole session (022 shim-drop): flip every strategy with
 * a run attached to this bot. A session hosts N runs, so the badge follows
 * the runs — not the retired `bot_instances.strategy_id` column.
 * Best-effort like the single flip: never fails the lifecycle operation.
 */
export async function syncSessionStrategiesActive(
  repository: Pick<BotLifecycleRepository, "getRunsForBot">,
  botId: string,
  active: boolean
): Promise<void> {
  let runs: Array<{ strategy_id: string }>;
  try {
    runs = await repository.getRunsForBot(botId);
  } catch (error) {
    logger.warn("Failed to load session runs for badge sync", {
      botId,
      active,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const strategyIds = [...new Set(runs.map(run => run.strategy_id))];
  await Promise.all(
    strategyIds.map(strategyId => syncStrategyActive(strategyId, active))
  );
}
