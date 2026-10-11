/**
 * Pending-fill journal (F1): the durable engine-side outbox that makes a
 * detected fill survive a Redis outage or a crash mid-publish. These tests
 * pin the storage guarantees — write-before-publish, clear-only-after-
 * acknowledgement, corruption fallback — that the reporter's replay relies
 * on.
 *
 * @format
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  clearPendingFill,
  journalPendingFill,
  listPendingFills,
  pendingFillCount,
  pendingFillStatus,
  readPendingFills,
  PendingFillEntry,
} from "../pending-fill-journal";

const JOURNAL = "pending-fills.json";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pending-fill-journal-"));
  process.env.GRID_SNAPSHOT_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry(fillId: string, overrides: Partial<PendingFillEntry> = {}) {
  return {
    fillId,
    payload: {
      botId: "bot-1",
      symbol: "PERP_BTC_USDC",
      side: "BUY" as const,
      price: 100,
      quantity: 1,
      status: "FILLED" as const,
      clientOrderId: "bot1-00-B",
      exchangeOrderId: "idx-1",
      fillId,
      executedAt: "2026-10-03T10:00:00.000Z",
    },
    queuedAt: "2026-10-03T10:00:01.000Z",
    ...overrides,
  };
}

describe("pending-fill journal", () => {
  it("journals a fill and lists it back (round-trip)", () => {
    expect(journalPendingFill(entry("f-1"))).toBe(true);
    expect(listPendingFills()).toEqual([entry("f-1")]);
    // Durable on disk — a fresh read (i.e. a restarted process) sees it.
    expect(fs.existsSync(path.join(tmpDir, JOURNAL))).toBe(true);
  });

  it("lists empty when no journal exists (never throws)", () => {
    expect(listPendingFills()).toEqual([]);
    // Verified-clean: absent files are EMPTY, not UNKNOWN — safe to trade.
    expect(readPendingFills().status).toBe("EMPTY");
    expect(pendingFillStatus()).toEqual({ pending: 0, unknown: false });
    expect(pendingFillCount()).toBe(0);
  });

  it("appends multiple fills and clears only the acknowledged one", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2"));

    expect(clearPendingFill("f-1")).toBe(true);

    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-2"]);
  });

  it("replaces an entry in place when the same fillId is re-journaled", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(
      entry("f-1", { payload: { ...entry("f-1").payload, quantity: 0.4 } })
    );

    const listed = listPendingFills();
    expect(listed).toHaveLength(1);
    expect(listed[0].payload.quantity).toBe(0.4);
  });

  it("treats clearing an absent fill as success (idempotent)", () => {
    expect(clearPendingFill("never-journaled")).toBe(true);
  });

  it("falls back to the previous version when the primary is corrupt", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2")); // f-1 moves to .prev by durableWrite
    fs.writeFileSync(path.join(tmpDir, JOURNAL), "{not json");

    // f-2's write promoted the good f-1 journal to .prev; recovery returns
    // that last good version rather than silently dropping replays.
    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
  });

  it("recovers from .prev when the primary file is absent", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2")); // f-1 moves to .prev by durableWrite
    // Crash between temp-write and rename can leave no primary at all —
    // the .prev copy must still be consulted, not treated as empty.
    fs.unlinkSync(path.join(tmpDir, JOURNAL));

    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
  });

  it("quarantines malformed entries instead of silently dropping them", () => {
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([entry("f-1"), { fillId: 42 }, null, "junk"])
    );

    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
    // The corrupt bytes are preserved for manual reconciliation (venue
    // history), not discarded: a .corrupt-* sibling must exist.
    const quarantined = fs
      .readdirSync(tmpDir)
      .filter(f => f.startsWith(`${JOURNAL}.corrupt-`));
    expect(quarantined).toHaveLength(1);
  });

  it("quarantines a wholly corrupt primary before falling back to .prev", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2")); // f-1 moves to .prev by durableWrite
    fs.writeFileSync(path.join(tmpDir, JOURNAL), "{not json");

    // Recovery still returns the last good version — and the corrupt bytes
    // are quarantined for manual reconciliation, not silently discarded.
    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
    const quarantined = fs
      .readdirSync(tmpDir)
      .filter(f => f.startsWith(`${JOURNAL}.corrupt-`));
    expect(quarantined).toHaveLength(1);
  });

  it("reports UNKNOWN (not empty) when both the journal and its fallback are unusable", () => {
    fs.writeFileSync(path.join(tmpDir, JOURNAL), "not json at all");

    // Iteration still yields [] (nothing trustworthy to replay)...
    expect(listPendingFills()).toEqual([]);
    // ...but the integrity gate MUST see UNKNOWN and fail closed: an
    // unreadable journal is never "no pending fills".
    expect(readPendingFills().status).toBe("UNKNOWN");
    expect(pendingFillStatus()).toEqual({ pending: 0, unknown: true });
  });

  it("unions the previous copy when the primary is partially corrupt", () => {
    // f-1 lands in .prev when f-2 is journaled (durableWrite promotion).
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2"));
    // Overwrite the primary with f-2 VALID plus a corrupt row: a partial
    // corruption must still merge the .prev copy (f-1) so a fill present
    // only there is never omitted from replay. Primary wins on conflicts.
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([entry("f-2"), { fillId: 42 }])
    );

    const listed = listPendingFills().map(e => e.fillId);
    expect(listed).toContain("f-1"); // recovered from .prev
    expect(listed).toContain("f-2"); // recovered from the valid primary row
    expect(readPendingFills().status).toBe("PENDING");
  });

  it("marks UNKNOWN when a partially corrupt primary has no good .prev", () => {
    // Primary has a corrupt row but zero valid entries, and there is no
    // trustworthy .prev: nothing recoverable -> UNKNOWN, fail closed.
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([{ fillId: 42 }, null])
    );

    expect(listPendingFills()).toEqual([]);
    expect(readPendingFills().status).toBe("UNKNOWN");
    expect(pendingFillStatus().unknown).toBe(true);
  });
});
