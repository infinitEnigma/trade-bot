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

/**
 * Shape check for one entry; corrupt rows are quarantined, never replayed.
 */
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

/**
 * Journal read outcome. A journal whose integrity cannot be verified is
 * NEVER reported as empty: `UNKNOWN` means "files exist but no trustworthy
 * copy could be recovered" and every trading gate must fail closed on it.
 */
export type JournalReadStatus = "EMPTY" | "PENDING" | "UNKNOWN";

export interface JournalReadResult {
  status: JournalReadStatus;
  /** Recovered entries (union of primary + .prev on partial corruption). */
  entries: PendingFillEntry[];
}

/** One file's parse outcome: missing vs parsed vs unusable. */
type FileReadOutcome =
  | { kind: "missing" }
  | { kind: "ok"; entries: PendingFillEntry[]; corrupt: number }
  | { kind: "unusable" };

function readJournalFileOutcome(file: string): FileReadOutcome {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (error) {
    // ENOENT and any other read failure are both "no data from this copy".
    // A hard read error (permissions, IO) is logged loudly: it is not
    // absence, and the caller decides EMPTY vs UNKNOWN from the full picture.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("Pending-fill journal file unreadable", {
        file,
        error: messageOf(error),
      });
    }
    return { kind: "missing" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logger.error("Pending-fill journal is not a JSON array - quarantined", {
        file,
      });
      quarantineCorruptJournal(file, raw);
      return { kind: "unusable" };
    }
    const entries = parsed.filter(isPendingFillEntry);
    const corrupt = parsed.length - entries.length;
    if (corrupt > 0) {
      logger.error(
        "Pending-fill journal has corrupt rows - quarantined, not replayed",
        {
          file,
          total: parsed.length,
          corrupt,
        }
      );
      quarantineCorruptJournal(file, raw);
    }
    return { kind: "ok", entries, corrupt };
  } catch {
    logger.error("Pending-fill journal is not valid JSON - quarantined", {
      file,
    });
    quarantineCorruptJournal(file, raw);
    return { kind: "unusable" };
  }
}

/** Preserve the exact corrupt bytes for manual reconciliation (venue history). */
function quarantineCorruptJournal(file: string, raw: string): void {
  try {
    const quarantine = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.writeFileSync(quarantine, raw, "utf-8");
    logger.error("Quarantined corrupt pending-fill journal", {
      file,
      quarantine,
    });
  } catch (error) {
    logger.error("Failed to quarantine corrupt pending-fill journal", {
      file,
      error: messageOf(error),
    });
  }
}

/**
 * Read the journal with integrity. Union of primary + `.prev` when the
 * primary is partially corrupt (a fill recoverable from the previous copy
 * must never be omitted); `.prev` fallback when the primary is missing or
 * wholly unusable. Returns:
 * - EMPTY: neither file exists — verified clean, safe to trade.
 * - PENDING: recovered entries (possibly empty array with corrupt rows
 *   quarantined but a trustworthy copy present — still replays what's there).
 * - UNKNOWN: files exist but nothing trustworthy could be recovered.
 *   Callers MUST fail closed: never trade, never report "no pending fills".
 */
export function readPendingFills(): JournalReadResult {
  const file = journalPath();
  const primary = readJournalFileOutcome(file);
  const previous = readJournalFileOutcome(`${file}.prev`);

  // Verified clean: nothing was ever journaled.
  if (primary.kind === "missing" && previous.kind === "missing") {
    return { status: "EMPTY", entries: [] };
  }

  // Primary fully usable: consult .prev too when rows were corrupt, so a
  // fill present only in the previous copy is still replayed. Primary wins
  // on fillId conflicts.
  if (primary.kind === "ok" && primary.corrupt === 0) {
    return {
      status: primary.entries.length > 0 ? "PENDING" : "EMPTY",
      entries: primary.entries,
    };
  }
  if (primary.kind === "ok") {
    const merged = new Map<string, PendingFillEntry>();
    if (previous.kind === "ok") {
      for (const e of previous.entries) merged.set(e.fillId, e);
    }
    for (const e of primary.entries) merged.set(e.fillId, e);
    const entries = [...merged.values()];
    if (previous.kind === "ok") {
      logger.warn(
        "Pending-fill journal partially corrupt - merged with previous version",
        { file, recovered: entries.length }
      );
    }
    return {
      status: entries.length > 0 ? "PENDING" : "UNKNOWN",
      entries,
    };
  }

  // Primary missing or unusable: fall back to .prev.
  if (previous.kind === "ok") {
    logger.warn("Pending-fill journal corrupt - reading previous version", {
      file,
      recovered: previous.entries.length,
    });
    return {
      status: previous.entries.length > 0 ? "PENDING" : "UNKNOWN",
      entries: previous.entries,
    };
  }

  // Files exist but nothing trustworthy could be recovered. UNKNOWN, loudly:
  // this is the condition every trading gate must refuse to trade behind.
  // (A verified-empty journal — an `[]` primary with a good read and no
  // corruption — already returned EMPTY at the top of this function.)
  logger.error(
    "Pending-fill journal integrity unknown - refusing to treat as empty",
    { file }
  );
  return { status: "UNKNOWN", entries: [] };
}

/**
 * All journaled fills. Empty when no journal exists; falls back to the
 * `.prev` copy when the primary is missing OR corrupt (mirrors grid
 * snapshots — an absent primary must still attempt recovery, it may mean a
 * crash between temp-write and rename). Corrupt bytes are quarantined for
 * manual reconciliation.
 *
 * NOTE: on UNKNOWN integrity this returns [] for replay-iteration
 * convenience — gates MUST use `readPendingFills().status`, never the
 * length of this array, to decide whether trading may proceed.
 */
export function listPendingFills(): PendingFillEntry[] {
  return readPendingFills().entries;
}

/**
 * Journal integrity for trading gates. `pending` counts recovered entries;
 * `unknown` means files exist but nothing trustworthy could be recovered —
 * gates must fail closed on it, never treat it as "no pending fills".
 */
export interface PendingFillStatus {
  pending: number;
  unknown: boolean;
}

/** Gate-grade journal status: count + integrity in one read. */
export function pendingFillStatus(): PendingFillStatus {
  try {
    const read = readPendingFills();
    return {
      pending: read.entries.length,
      unknown: read.status === "UNKNOWN",
    };
  } catch {
    // A throw from the read path itself is also "integrity unknown".
    return { pending: 0, unknown: true };
  }
}

/**
 * Number of fills currently awaiting ledger delivery. Cheap synchronous
 * read — the heartbeat and the periodic retry loop use it to decide whether
 * a replay pass is worth attempting.
 *
 * NOTE: returns 0 on UNKNOWN integrity (nothing iterable to replay) — gates
 * MUST consult `pendingFillStatus().unknown`, never this count alone.
 */
export function pendingFillCount(): number {
  return pendingFillStatus().pending;
}

/**
 * Durably record a fill before its publish attempt. Returns false when no
 * durable copy could be written (the caller must REJECT the fill: without a
 * journal entry a publish failure leaves no replay path). Re-journaling the
 * same fillId replaces the entry in place.
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
