/**
 * Grid State Persistence
 *
 * Engine-local on-disk persistence of per-bot grid slot state. Loads and saves
 * GridSnapshot JSON files keyed by botId under GRID_SNAPSHOT_DIR.
 *
 * Save failures are swallowed (logged only): a full or read-only disk must never
 * crash a strategy tick. The exchange-side reconcile (findOrderByClientOrderId /
 * checkOrders) remains the authoritative recovery path.
 *
 * @format
 */

import * as fs from "fs";
import * as path from "path";
import { GridSnapshot } from "../../domain/grid-snapshot";
import { logger } from "../../utils/logger";

/** Resolve the snapshot directory - read lazily so tests can override it. */
export function getSnapshotDir(): string {
  return (
    process.env.GRID_SNAPSHOT_DIR || path.join(process.cwd(), ".grid-snapshots")
  );
}

function snapshotFile(botId: string): string {
  return path.join(getSnapshotDir(), `${botId}.json`);
}

/**
 * Load a bot's grid snapshot, or null if none exists / is unreadable / invalid.
 */
export function loadGridSnapshot(botId: string): GridSnapshot | null {
  try {
    const raw = fs.readFileSync(snapshotFile(botId), "utf-8");
    const parsed = JSON.parse(raw) as Partial<GridSnapshot>;
    if (parsed.version !== 1) return null;
    if (parsed.botId !== botId) return null;
    if (!parsed.levels || !Array.isArray(parsed.levels)) return null;
    if (!parsed.symbol || typeof parsed.baselinePrice !== "number") return null;
    if (
      typeof parsed.gridSize !== "number" ||
      typeof parsed.gridRangePercent !== "number"
    )
      return null;
    return parsed as GridSnapshot;
  } catch {
    // No snapshot yet, or corrupt/unreadable - fall back to a fresh grid.
    return null;
  }
}

/**
 * Persist a bot's grid snapshot. Never throws - failures are logged only.
 */
export async function saveGridSnapshot(snapshot: GridSnapshot): Promise<void> {
  const file = snapshotFile(snapshot.botId);
  try {
    fs.mkdirSync(getSnapshotDir(), { recursive: true });
    await fs.promises.writeFile(
      file,
      JSON.stringify(snapshot, null, 2),
      "utf-8"
    );
  } catch (error) {
    logger.error("Failed to persist grid snapshot", {
      botId: snapshot.botId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
