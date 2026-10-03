/**
 * synthesizeFillId — deterministic fill identity for the Phase 4 ledger.
 *
 * @format
 */

import { synthesizeFillId, isWholeOrderSegment } from "../fill-id";

describe("synthesizeFillId", () => {
  it("is deterministic for the same order identity (replay dedups)", () => {
    const a = synthesizeFillId("bot-1", "bot1-00-B", "idx-1");
    const b = synthesizeFillId("bot-1", "bot1-00-B", "idx-1");
    expect(a).toBe(b);
  });

  it("changes when any component of the identity changes", () => {
    const base = synthesizeFillId("bot-1", "bot1-00-B", "idx-1");
    expect(synthesizeFillId("bot-2", "bot1-00-B", "idx-1")).not.toBe(base);
    expect(synthesizeFillId("bot-1", "bot1-01-B", "idx-1")).not.toBe(base);
    expect(synthesizeFillId("bot-1", "bot1-00-B", "idx-2")).not.toBe(base);
  });

  it("returns a sha256 hex string (fits the TEXT fill_id column)", () => {
    const fillId = synthesizeFillId("bot-1", "bot1-00-B", "idx-1");
    expect(fillId).toMatch(/^[0-9a-f]{64}$/);
    expect(fillId.length).toBeLessThanOrEqual(255);
  });
});

describe("synthesizeFillId — cumulative-qty segments (Phase 4)", () => {
  const bot = "bot-1";
  const client = "bot1-00-B";
  const exchange = "idx-1";

  it("keeps the legacy byte-identical id for a whole-order fill (A6)", () => {
    // A fill that spans the order from 0 must hash exactly like the
    // pre-Phase-4 synthesis, so rows booked before the upgrade still dedup.
    const whole = synthesizeFillId(bot, client, exchange, {
      from: 0,
      to: 1,
      full: 1,
    });
    expect(whole).toBe(synthesizeFillId(bot, client, exchange));
  });

  it("gives a partial segment a distinct id (A1: no segment collapse)", () => {
    const legacy = synthesizeFillId(bot, client, exchange);
    const partial = synthesizeFillId(bot, client, exchange, {
      from: 0,
      to: 0.0074,
      full: 0.0374,
    });
    expect(partial).not.toBe(legacy);
    expect(partial).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps disjoint segments of one order distinct", () => {
    const first = synthesizeFillId(bot, client, exchange, {
      from: 0,
      to: 0.0074,
      full: 0.0374,
    });
    const second = synthesizeFillId(bot, client, exchange, {
      from: 0.0074,
      to: 0.0374,
      full: 0.0374,
    });
    expect(first).not.toBe(second);
  });

  it("is deterministic for the same segment (restart re-detect dedups)", () => {
    const a = synthesizeFillId(bot, client, exchange, {
      from: 0,
      to: 0.0074,
      full: 0.0374,
    });
    const b = synthesizeFillId(bot, client, exchange, {
      from: 0,
      to: 0.0074,
      full: 0.0374,
    });
    expect(a).toBe(b);
  });

  it("quantizes bounds to 8 dp so float drift cannot mint a second id (A5)", () => {
    const exact = synthesizeFillId(bot, client, exchange, {
      from: 0.0074,
      to: 0.0374,
      full: 0.1,
    });
    // 0.0374 - 0.03 computes to 0.0074000000000000007 in binary float;
    // within 8 dp it must hash to the same segment.
    const drifted = synthesizeFillId(bot, client, exchange, {
      from: 0.0374 - 0.03,
      to: 0.0374,
      full: 0.1,
    });
    expect(drifted).toBe(exact);
  });

  it("treats an unknown (non-positive) full size as a segment, not legacy (A1)", () => {
    // adopt() zeroes record.quantity — if `full` were ever taken from an
    // uninitialized record the id must stay segment-shaped, never collapse
    // every fill onto the shared per-order hash.
    const unknownFull = synthesizeFillId(bot, client, exchange, {
      from: 0,
      to: 1,
      full: 0,
    });
    expect(unknownFull).not.toBe(synthesizeFillId(bot, client, exchange));
  });

  it("isWholeOrderSegment accepts only from≈0 && to≥full", () => {
    expect(isWholeOrderSegment({ from: 0, to: 1, full: 1 })).toBe(true);
    expect(
      isWholeOrderSegment({ from: 0, to: 1 - 1e-9, full: 1 })
    ).toBe(true);
    expect(isWholeOrderSegment({ from: 0, to: 0.4, full: 1 })).toBe(false);
    expect(isWholeOrderSegment({ from: 0.4, to: 1, full: 1 })).toBe(false);
    expect(isWholeOrderSegment({ from: 0, to: 1, full: 0 })).toBe(false);
  });
});
