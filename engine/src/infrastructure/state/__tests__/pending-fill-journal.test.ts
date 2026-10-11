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

  it("drops malformed entries instead of replaying garbage", () => {
    fs.writeFileSync(
      path.join(tmpDir, JOURNAL),
      JSON.stringify([entry("f-1"), { fillId: 42 }, null, "junk"])
    );

    expect(listPendingFills().map(e => e.fillId)).toEqual(["f-1"]);
  });

  it("returns empty when both the journal and its fallback are unusable", () => {
    fs.writeFileSync(path.join(tmpDir, JOURNAL), "not json at all");

    expect(listPendingFills()).toEqual([]);
  });
});
