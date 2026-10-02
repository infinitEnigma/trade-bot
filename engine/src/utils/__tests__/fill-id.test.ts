/**
 * synthesizeFillId — deterministic fill identity for the Phase 4 ledger.
 *
 * @format
 */

import { synthesizeFillId } from "../fill-id";

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
