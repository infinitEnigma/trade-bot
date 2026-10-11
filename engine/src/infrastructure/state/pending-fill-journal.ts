/**
 * Pending Fill Journal - durable engine-side outbox for TRADE_EXECUTED (F1).
 *
 * The ledger is only as reliable as event delivery: `reportFill` used to
 * publish to Redis and, on failure, log the payload — a log line is not a
 * durable copy. Because the grid books a fill into its local snapshot before
 * reporting it, restart reconciliation deliberately re-books nothing (the
 * projection already holds the cumulative), so a fill whose publish failed
 * was permanently missing from `bot_trade_fills`.
 *
 * This journal closes that gap: the fill is written HERE, durably, before the
 * publish is attempted, and cleared only after the stream accepts it. A Redis
 * outage or a crash mid-publish leaves the entry; replay (bot-session start +
 * engine startup, see `LedgerTradeReporter.replayPendingFills`) re-publishes
 * it under the live engine identity — the backend's unique fill key makes an
 * over-eager replay a no-op.
 *
 * Storage: one JSON file (`pending-fills.json`) beside the grid snapshots in
 * `GRID_SNAPSHOT_DIR`, written with the same temp-file → fsync → atomic-rename
 * discipline as the snapshots (previous version kept as `.prev`, which doubles
 * as the corruption fallback). All operations are synchronous read-modify-
 * write within one process, so concurrent ticks cannot interleave a write.
 *
 * Only fills are journaled: POSITION_UPDATED / PERFORMANCE_SNAPSHOT are
 * latest-wins telemetry superseded by the next report, never historical truth.
 *
 * @format
 */

import * as fs from "fs";
import * as path from "path";
import { TradeExecutedEventPayload } from "@trade-bot/shared";
import { durableWriteSync } from "./durable-write";
import { getSnapshotDir } from "./grid-state";
import { logger } from "../../utils/logger";

/**
 * The published payload minus engine identity: the journal stores the fill
 * facts only. Replay restamps `engineId`/`engineEpoch` from the live process
 * (the epoch bumps per restart and the backend's authority check must see the
 * current one); the fill identity — and with it the ledger dedup key — is
 * untouched, so replay stays idempotent.
 */
export type PendingFillPayload = Omit<
  TradeExecutedEventPayload,
  "engineId" | "engineEpoch"
>;

export interface PendingFillEntry {
  fillId: string;
  payload: PendingFillPayload;
  /** ISO-8601 time the fill first failed to reach the stream. */
  queuedAt: string;
}

const JOURNAL_FILE = "pending-fills.json";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function journalPath(): string {
  return path.join(getSnapshotDir(), JOURNAL_FILE);
}

/** Shape check for one entry; corrupt rows are dropped, never replayed. */
function isPendingFillEntry(value: unknown): value is PendingFillEntry {
  const entry = value as Partial<PendingFillEntry> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.fillId === "string" &&
    entry.fillId.length > 0 &&
    typeof entry.payload === "object" &&
    entry.payload !== null &&
    typeof (entry.payload as PendingFillPayload).botId === "string" &&
    typeof (entry.payload as PendingFillPayload).clientOrderId === "string"
  );
}

/** Parse one journal file; null when unreadable or structurally invalid. */
function readJournalFile(file: string): PendingFillEntry[] | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isPendingFillEntry);
  } catch {
    return null;
  }
}

/**
 * All journaled fills. Empty when no journal exists; falls back to the
 * `.prev` copy when the primary is corrupt (mirrors grid snapshots), and
 * returns empty — loudly — when both are unusable.
 */
export function listPendingFills(): PendingFillEntry[] {
  const file = journalPath();
  const primary = readJournalFile(file);
  if (primary !== null) return primary;

  const previous = readJournalFile(`${file}.prev`);
  if (previous !== null) {
    logger.warn("Pending-fill journal corrupt - reading previous version", {
      file,
      recovered: previous.length,
    });
    return previous;
  }
  logger.error("Pending-fill journal unreadable - treating as empty", { file });
  return [];
}

/**
 * Durably record a fill before its publish attempt. Returns false when no
 * durable copy could be written (the caller must log loudly: that fill has
 * no replay path). Re-journaling the same fillId replaces the entry in place.
 */
export function journalPendingFill(entry: PendingFillEntry): boolean {
  try {
    const entries = listPendingFills();
    const index = entries.findIndex(e => e.fillId === entry.fillId);
    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }
    durableWriteSync(
      getSnapshotDir(),
      JOURNAL_FILE,
      JSON.stringify(entries, null, 2)
    );
    return true;
  } catch (error) {
    logger.error("Failed to journal pending fill", {
      fillId: entry.fillId,
      botId: entry.payload.botId,
      error: messageOf(error),
    });
    return false;
  }
}

/**
 * Drop a fill from the journal — called only after the stream accepted it.
 * Idempotent: an already-absent entry is a success (a lost clear is safe
 * anyway — the backend dedup key makes the redundant replay a no-op).
 */
export function clearPendingFill(fillId: string): boolean {
  try {
    const entries = listPendingFills();
    const remaining = entries.filter(e => e.fillId !== fillId);
    if (remaining.length === entries.length) return true;
    durableWriteSync(
      getSnapshotDir(),
      JOURNAL_FILE,
      JSON.stringify(remaining, null, 2)
    );
    return true;
  } catch (error) {
    logger.error("Failed to clear pending fill", {
      fillId,
      error: messageOf(error),
    });
    return false;
  }
}
