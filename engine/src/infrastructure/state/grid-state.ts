/**
 * Grid State Persistence
 *
 * Engine-local on-disk persistence of per-bot grid slot state. Loads and saves
 * GridSnapshot JSON files keyed by botId under GRID_SNAPSHOT_DIR.
 *
 * Writes are durable (temp file → fsync → atomic rename, keeping the previous
 * version as `<botId>.json.prev`) and carry a checksum; load validates the
 * checksum and every level entry, and distinguishes "no snapshot" from
 * "corrupt snapshot" (a corrupt file falls back to the previous version).
 *
 * This file answers "what did the engine think the grid looked like", **not**
 * "what orders exist at the exchange" — reconciliation (Phase 2) is what makes
 * the snapshot safe to trust.
 *
 * Save failures are swallowed (logged only): a full or read-only disk must never
 * crash a strategy tick.
 *
 * @format
 */

import * as fs from "fs";
import * as path from "path";
import {
  GridSnapshot,
  GRID_SNAPSHOT_VERSION,
  computeSnapshotChecksum,
} from "../../domain/grid-snapshot";
import { durableWriteSync } from "./durable-write";
import { logger } from "../../utils/logger";

/** Resolve the snapshot directory - read lazily so tests can override it. */
export function getSnapshotDir(): string {
  return (
    process.env.GRID_SNAPSHOT_DIR || path.join(process.cwd(), ".grid-snapshots")
  );
}

function snapshotFile(botId: string, runId?: string): string {
  // D3 sessions: per-run layout `<botId>/<runId>.json`. Without a runId the
  // legacy flat `<botId>.json` path is used (read fallback only — D3 always
  // writes with a runId).
  if (!runId) return path.join(getSnapshotDir(), `${botId}.json`);
  return path.join(getSnapshotDir(), botId, `${runId}.json`);
}

/** Outcome of reading one snapshot file, distinguishing absent from invalid. */
export type SnapshotLoadResult =
  | { status: "OK"; snapshot: GridSnapshot; migratedFromLegacy?: boolean }
  | { status: "MISSING" }
  | { status: "CORRUPT"; detail: string };

type Validation = { ok: true } | { ok: false; detail: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read + validate a single file (no fallback). */
function readSnapshotFile(file: string, botId: string): SnapshotLoadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "MISSING" };
    }
    return { status: "CORRUPT", detail: `unreadable: ${messageOf(error)}` };
  }

  let parsed: Partial<GridSnapshot>;
  try {
    parsed = JSON.parse(raw) as Partial<GridSnapshot>;
  } catch (error) {
    return { status: "CORRUPT", detail: `invalid JSON: ${messageOf(error)}` };
  }

  const validation = validateSnapshot(parsed, botId);
  if (!validation.ok) return { status: "CORRUPT", detail: validation.detail };

  // Checksum, when present, must match the payload (Phase 3). Absent checksums
  // (files written before this landed) are accepted for backward compatibility.
  if (parsed.checksum !== undefined) {
    const { checksum, ...payload } = parsed as GridSnapshot;
    if (checksum !== computeSnapshotChecksum(payload)) {
      return { status: "CORRUPT", detail: "checksum mismatch" };
    }
  }

  return { status: "OK", snapshot: parsed as GridSnapshot };
}

function validateSnapshot(
  parsed: Partial<GridSnapshot>,
  botId: string
): Validation {
  if (parsed.version !== GRID_SNAPSHOT_VERSION) {
    return { ok: false, detail: `unsupported version ${parsed.version}` };
  }
  if (parsed.botId !== botId) {
    return { ok: false, detail: "botId mismatch" };
  }
  if (typeof parsed.symbol !== "string" || !parsed.symbol) {
    return { ok: false, detail: "missing symbol" };
  }
  if (typeof parsed.baselinePrice !== "number") {
    return { ok: false, detail: "missing baselinePrice" };
  }
  if (
    typeof parsed.gridSize !== "number" ||
    typeof parsed.gridRangePercent !== "number"
  ) {
    return { ok: false, detail: "missing grid dimensions" };
  }
  if (!Array.isArray(parsed.levels)) {
    return { ok: false, detail: "levels is not an array" };
  }
  for (let i = 0; i < parsed.levels.length; i++) {
    const levelValidation = validateLevel(parsed.levels[i], i);
    if (!levelValidation.ok) return levelValidation;
  }
  return { ok: true };
}

function validateLevel(level: unknown, index: number): Validation {
  if (!level || typeof level !== "object") {
    return { ok: false, detail: `level ${index} is not an object` };
  }
  const entry = level as Record<string, unknown>;
  if (typeof entry.price !== "number" || !Number.isFinite(entry.price)) {
    return { ok: false, detail: `level ${index} has an invalid price` };
  }
  if (typeof entry.filled !== "boolean") {
    return { ok: false, detail: `level ${index} has an invalid filled flag` };
  }
  for (const key of ["buyOrderId", "sellOrderId"] as const) {
    const value = entry[key];
    if (value !== undefined && typeof value !== "string") {
      return { ok: false, detail: `level ${index} has an invalid ${key}` };
    }
  }
  for (const key of ["buyGen", "sellGen"] as const) {
    const value = entry[key];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || (value as number) < 0)
    ) {
      return { ok: false, detail: `level ${index} has an invalid ${key}` };
    }
  }
  // Executed entry price (Phase 5): optional, but a present value must be a
  // sane price — a corrupt one would silently corrupt the exit's PnL.
  if (entry.entryPrice !== undefined) {
    if (
      typeof entry.entryPrice !== "number" ||
      !Number.isFinite(entry.entryPrice) ||
      entry.entryPrice < 0
    ) {
      return { ok: false, detail: `level ${index} has an invalid entryPrice` };
    }
  }
  return { ok: true };
}

/**
 * Load a bot run's grid snapshot, recovering the previous version on
 * corruption. D3 sessions: tries `<botId>/<runId>.json` first, then falls
 * back ONCE to the legacy flat `<botId>.json` (migration-on-read, Act-mode
 * decision 3) — flagged via `migratedFromLegacy` so the caller can persist
 * to the new path immediately. Returns a typed result so callers can tell
 * "no snapshot" from "corrupt".
 */
export function loadGridSnapshotResult(
  botId: string,
  runId?: string
): SnapshotLoadResult {
  const file = snapshotFile(botId, runId);
  const primary = readSnapshotFile(file, botId);
  if (primary.status !== "MISSING" || !runId) {
    if (primary.status !== "CORRUPT") return primary;

    const previous = readSnapshotFile(`${file}.prev`, botId);
    if (previous.status === "OK") {
      logger.warn("Recovered grid snapshot from the previous version", {
        botId,
        runId,
        detail: primary.detail,
      });
      return previous;
    }
    return primary;
  }

  // New path missing but a run was requested: try the legacy flat file once.
  const legacy = readSnapshotFile(snapshotFile(botId), botId);
  if (legacy.status === "OK") {
    logger.warn("Loaded legacy grid snapshot (migration-on-read)", {
      botId,
      runId,
    });
    return { ...legacy, migratedFromLegacy: true };
  }
  if (legacy.status === "CORRUPT") {
    const legacyPrev = readSnapshotFile(`${snapshotFile(botId)}.prev`, botId);
    if (legacyPrev.status === "OK") {
      logger.warn("Recovered legacy grid snapshot from the previous version", {
        botId,
        runId,
        detail: legacy.detail,
      });
      return { ...legacyPrev, migratedFromLegacy: true };
    }
  }
  return primary;
}

/**
 * Load a bot run's grid snapshot, or null if none exists / is unreadable /
 * invalid.
 */
export function loadGridSnapshot(
  botId: string,
  runId?: string
): GridSnapshot | null {
  const result = loadGridSnapshotResult(botId, runId);
  return result.status === "OK" ? result.snapshot : null;
}

/**
 * Persist a bot run's grid snapshot. Never throws - failures are logged only.
 * D3 always writes the per-run path (creating `<botId>/` as needed); the
 * snapshot stamps `runId` so a future load validates ownership.
 */
export async function saveGridSnapshot(snapshot: GridSnapshot): Promise<void> {
  try {
    // Recompute the checksum over the canonical payload so it always matches
    // what is written, regardless of what the caller passed in.
    const { checksum: _ignored, ...payload } = snapshot;
    const stamped: GridSnapshot = {
      ...payload,
      checksum: computeSnapshotChecksum(payload),
    };
    durableWriteSync(
      snapshot.runId
        ? path.join(getSnapshotDir(), snapshot.botId)
        : getSnapshotDir(),
      snapshot.runId ? `${snapshot.runId}.json` : `${snapshot.botId}.json`,
      JSON.stringify(stamped, null, 2)
    );
  } catch (error) {
    logger.error("Failed to persist grid snapshot", {
      botId: snapshot.botId,
      runId: snapshot.runId,
      error: messageOf(error),
    });
  }
}
