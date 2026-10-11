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

  it("recovers fills from .prev but reports UNKNOWN when the primary is corrupt (finding 2)", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2")); // f-1 moves to .prev by durableWrite
    fs.writeFileSync(path.join(tmpDir, JOURNAL), "{not json");

    // Recovery still surfaces the last good version's fills for reconciliation
    // rather than silently dropping replays...
    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
    // ...but a corrupt primary may have held fills added AFTER .prev was
    // written, so completeness is unprovable: UNKNOWN, and the gate must fail
    // closed even though .prev looked healthy (finding 2).
    expect(readPendingFills().status).toBe("UNKNOWN");
    expect(pendingFillStatus().unknown).toBe(true);
  });

  it("recovers from .prev as PENDING when the primary file is absent", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2")); // f-1 moves to .prev by durableWrite
    // Crash between temp-write and rename can leave no primary at all —
    // the .prev copy must still be consulted, not treated as empty. This is
    // the one case .prev IS the last complete state, so recovery is PENDING.
    fs.unlinkSync(path.join(tmpDir, JOURNAL));

    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
    expect(readPendingFills().status).toBe("PENDING");
    expect(pendingFillStatus().unknown).toBe(false);
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

  it("quarantines a wholly corrupt primary, recovers from .prev but reports UNKNOWN", () => {
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2")); // f-1 moves to .prev by durableWrite
    fs.writeFileSync(path.join(tmpDir, JOURNAL), "{not json");

    // A single read re-quarantines the corrupt primary on each call, so derive
    // both the recovered set and the status from ONE read. Recovery still
    // surfaces the last good version's fills for reconciliation — and the
    // corrupt bytes are quarantined for manual reconciliation, not silently
    // discarded. The status is UNKNOWN (finding 2): a wholly corrupt primary
    // cannot prove it held nothing beyond .prev.
    const result = readPendingFills();
    expect(result.entries.map(e => e.fillId)).toEqual(["f-1"]);
    expect(result.status).toBe("UNKNOWN");
    const quarantined = fs
      .readdirSync(tmpDir)
      .filter(f => f.startsWith(`${JOURNAL}.corrupt-`));
    expect(quarantined.length).toBeGreaterThanOrEqual(1);
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

  it("unions the previous copy when the primary is partially corrupt but reports UNKNOWN", () => {
    // f-1 lands in .prev when f-2 is journaled (durableWrite promotion).
    journalPendingFill(entry("f-1"));
    journalPendingFill(entry("f-2"));
    // Overwrite the primary with f-2 VALID plus a corrupt row: recovery must
    // still merge the .prev copy (f-1) so a fill present only there is never
    // omitted. Primary wins on conflicts.
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([entry("f-2"), { fillId: 42 }])
    );

    const listed = listPendingFills().map(e => e.fillId);
    expect(listed).toContain("f-1"); // recovered from .prev
    expect(listed).toContain("f-2"); // recovered from the valid primary row
    // Finding 2: a corrupt row may be a fill present in NEITHER copy, so
    // partial corruption can never PROVE completeness — even with a good
    // .prev the status is UNKNOWN and the gate must fail closed. The recovered
    // entries remain visible above for reconciliation, but never authorise
    // trading.
    expect(readPendingFills().status).toBe("UNKNOWN");
    expect(pendingFillStatus().unknown).toBe(true);
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

  it("marks UNKNOWN when a partially corrupt primary recovers some rows but has no .prev (finding 2)", () => {
    // One valid row + one corrupt row, no .prev. The valid row IS recovered
    // for reconciliation, but the corrupt row may be a fill present in NEITHER
    // copy, so completeness is unprovable: UNKNOWN, never PENDING.
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([entry("f-1"), { fillId: 42 }])
    );

    // Recovered for reconciliation visibility...
    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
    // ...but the gate must fail closed: "recovered" is not "proven complete".
    expect(readPendingFills().status).toBe("UNKNOWN");
    expect(pendingFillStatus().unknown).toBe(true);
  });

  it("treats a hard read failure (non-ENOENT) as UNREADABLE, not absence (finding 1)", () => {
    // A directory at the journal path makes readFileSync throw EISDIR (not
    // ENOENT): the file EXISTS but cannot be read. Two unreadable copies must
    // be UNKNOWN — never a clean EMPTY that would open the session-start gate.
    fs.mkdirSync(path.join(tmpDir, JOURNAL));
    fs.mkdirSync(path.join(tmpDir, `${JOURNAL}.prev`));

    expect(readPendingFills().status).toBe("UNKNOWN");
    expect(pendingFillStatus().unknown).toBe(true);
    expect(listPendingFills()).toEqual([]);
  });

  it("refuses to journal while integrity is UNKNOWN, preserving evidence (finding 3)", () => {
    // Partially corrupt primary, no good .prev -> UNKNOWN.
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([entry("f-1"), { fillId: 42 }])
    );
    const before = fs.readFileSync(path.join(tmpDir, JOURNAL), "utf-8");

    expect(readPendingFills().status).toBe("UNKNOWN");
    // A write here would rebuild the journal from the recovered subset and drop
    // the corrupt fill's evidence. It must be refused so the strategy halts.
    expect(journalPendingFill(entry("f-2"))).toBe(false);
    // The original bytes are untouched — evidence preserved for reconciliation.
    expect(fs.readFileSync(path.join(tmpDir, JOURNAL), "utf-8")).toBe(before);
  });

  it("refuses to clear while integrity is UNKNOWN, preserving evidence (finding 3)", () => {
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([entry("f-1"), { fillId: 42 }])
    );
    const before = fs.readFileSync(path.join(tmpDir, JOURNAL), "utf-8");

    // A redundant replay is always safe (backend dedups), but rewriting the
    // journal from the recovered subset is not: refuse and keep the evidence.
    expect(clearPendingFill("f-1")).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, JOURNAL), "utf-8")).toBe(before);
  });
});
