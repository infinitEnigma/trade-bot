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

/**
 * One file's read outcome.
 * - `missing`:    genuine absence (ENOENT) — the file does not exist.
 * - `unreadable`: the file exists but could not be read (permissions, IO,
 *   EISDIR, ...). NEVER treated as absence: an unreadable copy is on-disk
 *   state we cannot verify, so it can never contribute to a verified-clean
 *   EMPTY (finding 1).
 * - `ok`:         read + parsed as an array; `corrupt` counts dropped rows.
 * - `unusable`:   the read succeeded but the bytes are not a usable JSON array.
 */
type FileReadOutcome =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "ok"; entries: PendingFillEntry[]; corrupt: number }
  | { kind: "unusable" };

function readJournalFileOutcome(file: string): FileReadOutcome {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (error) {
    // Only a genuine ENOENT means "this copy does not exist". Any OTHER read
    // failure (permissions, IO, the path being a directory, ...) means the
    // file exists but we could not read it — that is NOT absence, and must
    // never let the caller conclude EMPTY (finding 1). It is logged loudly
    // and surfaced as `unreadable` so the caller decides from the full picture.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    logger.error("Pending-fill journal file unreadable", {
      file,
      error: messageOf(error),
    });
    return { kind: "unreadable" };
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
 * Union the valid entries from both copies (primary wins on a fillId
 * conflict). Used only to populate the recovered set on an UNKNOWN result —
 * for reconciliation/replay visibility, never as proof of completeness.
 */
function unionValidEntries(
  primary: FileReadOutcome,
  previous: FileReadOutcome
): PendingFillEntry[] {
  const merged = new Map<string, PendingFillEntry>();
  if (previous.kind === "ok") {
    for (const e of previous.entries) merged.set(e.fillId, e);
  }
  if (primary.kind === "ok") {
    for (const e of primary.entries) merged.set(e.fillId, e);
  }
  return [...merged.values()];
}

/** Emit an UNKNOWN result with the recovered set, logged loudly (fail-closed). */
function unknownResult(
  file: string,
  entries: PendingFillEntry[]
): JournalReadResult {
  logger.error(
    "Pending-fill journal integrity unknown - refusing to treat as empty",
    { file, recovered: entries.length }
  );
  return { status: "UNKNOWN", entries };
}

/**
 * Read the journal with integrity. The governing invariant: if the system
 * cannot PROVE that every potentially undelivered fill is accounted for, the
 * status is UNKNOWN and every trading gate must fail closed. Returns:
 * - EMPTY: verified clean — a fully-usable non-corrupt primary with no
 *   entries, or genuine absence (ENOENT) of both copies. Safe to trade.
 * - PENDING: a trustworthy, COMPLETE copy was recovered (a clean primary, or
 *   a genuinely-absent primary whose `.prev` is clean). Every fill is
 *   accounted for; replay what is listed.
 * - UNKNOWN: the on-disk state cannot be proven complete — a partially
 *   corrupt, wholly unusable, or unreadable copy (findings 1 & 2), or a
 *   fallback that is itself corrupt/unreadable. `entries` still carries
 *   whatever was recovered for reconciliation/replay visibility, but the
 *   corrupt/unreadable bytes may be fills present in NEITHER copy, so callers
 *   MUST fail closed: never trade, never report "no pending fills".
 */
export function readPendingFills(): JournalReadResult {
  const file = journalPath();
  const primary = readJournalFileOutcome(file);
  const previous = readJournalFileOutcome(`${file}.prev`);

  // (1) A fully-usable, non-corrupt primary IS the authoritative current
  //     state and proves completeness. `.prev` is only ever a fallback for an
  //     untrustworthy primary, so its state is irrelevant here.
  if (primary.kind === "ok" && primary.corrupt === 0) {
    return {
      status: primary.entries.length > 0 ? "PENDING" : "EMPTY",
      entries: primary.entries,
    };
  }

  // (2) A genuinely absent primary (ENOENT) is trustworthy absence — the
  //     documented crash-between-temp-write-and-rename case, where `.prev`
  //     holds the last complete state. Only a fully-clean `.prev` lets us
  //     account for every fill; any other `.prev` state fails closed.
  if (primary.kind === "missing") {
    if (previous.kind === "missing") {
      return { status: "EMPTY", entries: [] };
    }
    if (previous.kind === "ok" && previous.corrupt === 0) {
      logger.warn(
        "Pending-fill journal primary absent - recovered from previous version",
        { file, recovered: previous.entries.length }
      );
      return {
        status: previous.entries.length > 0 ? "PENDING" : "EMPTY",
        entries: previous.entries,
      };
    }
    // `.prev` is itself corrupt or unreadable: recover any valid rows for
    // reconciliation visibility, but integrity is unprovable.
    return unknownResult(file, unionValidEntries(primary, previous));
  }

  // (3) The primary is PRESENT but not fully trustworthy: partially corrupt,
  //     wholly unusable, or unreadable (finding 1 & 2). Its bytes exist on
  //     disk and we cannot prove their full contents, so any fill in them is
  //     potentially unaccounted for. Union `.prev` to recover as much as
  //     possible for reconciliation/replay, but the status is UNKNOWN —
  //     corrupt or unreadable rows may be fills present in NEITHER copy.
  return unknownResult(file, unionValidEntries(primary, previous));
}

/**
 * All journaled fills. Empty when no journal exists; falls back to the
 * `.prev` copy when the primary is missing OR corrupt (mirrors grid
 * snapshots — an absent primary must still attempt recovery, it may mean a
 * crash between temp-write and rename). Corrupt bytes are quarantined for
 * manual reconciliation.
 *
 * NOTE: on UNKNOWN integrity this returns whatever was RECOVERABLE (the
 * primary+`.prev` union) for reconciliation/replay visibility — it is NOT a
 * completeness signal. Gates MUST use `readPendingFills().status`, never the
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
 * Number of fills currently recovered and awaiting ledger delivery. Cheap
 * synchronous read — the heartbeat and the periodic retry loop use it to
 * decide whether a replay pass is worth attempting.
 *
 * NOTE: on UNKNOWN integrity this counts the RECOVERABLE entries (the
 * primary+`.prev` union), not zero — gates MUST consult
 * `pendingFillStatus().unknown`, never this count alone.
 */
export function pendingFillCount(): number {
  return pendingFillStatus().pending;
}

/**
 * Durably record a fill before its publish attempt. Returns false when no
 * durable copy could be written (the caller must REJECT the fill: without a
 * journal entry a publish failure leaves no replay path). Re-journaling the
 * same fillId replaces the entry in place.
 *
 * Fail-closed on UNKNOWN integrity (finding 3): if the current journal cannot
 * be proven complete, appending to the recovered subset and rewriting would
 * OVERWRITE the unrecovered/corrupt fills — destroying the very evidence an
 * operator needs to reconcile. In that state we refuse to write (return false)
 * so `reportFill` throws `UndurableFillError` and the strategy halts rather
 * than silently converting unknown financial state into apparently-healthy
 * state. The original and quarantined bytes are left untouched.
 */
export function journalPendingFill(entry: PendingFillEntry): boolean {
  try {
    const read = readPendingFills();
    if (read.status === "UNKNOWN") {
      logger.error(
        "Refusing to journal pending fill - journal integrity unknown; preserving evidence for reconciliation",
        { fillId: entry.fillId, botId: entry.payload.botId }
      );
      return false;
    }
    const entries = read.entries;
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
 *
 * Fail-closed on UNKNOWN integrity (finding 3): rewriting the journal from the
 * recovered subset would discard unrecovered/corrupt fills, so we refuse to
 * mutate and return false. The entry simply stays for the next (post-
 * reconciliation) replay, which the backend dedups — a redundant replay is
 * always safe, a lost fill never is.
 */
export function clearPendingFill(fillId: string): boolean {
  try {
    const read = readPendingFills();
    if (read.status === "UNKNOWN") {
      logger.error(
        "Refusing to clear pending fill - journal integrity unknown; preserving evidence for reconciliation",
        { fillId }
      );
      return false;
    }
    const entries = read.entries;
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
