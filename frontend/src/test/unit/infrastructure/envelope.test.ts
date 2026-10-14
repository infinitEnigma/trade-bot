/** @format */

/**
 * `unwrapRows` — venue-envelope row extraction (F3 sweep, prod 2026-10-14).
 *
 * The `/api/market/*` payloads disagree across venues AND across envelope
 * depth, so every accepted shape is pinned here: bare array, `{ rows }`,
 * `{ data: [...] }`, and the nested `{ success, data: { rows } }` envelope.
 */
import { unwrapRows } from "../../../infrastructure/api/envelope";

describe("unwrapRows (venue envelopes)", () => {
  const rows = [{ symbol: "ETH" }, { symbol: "BTC" }];

  it("returns a bare array as-is (Kodiak data: [...])", () => {
    expect(unwrapRows(rows)).toEqual(rows);
  });

  it("reads a single { rows } envelope (Lighter positions/trades)", () => {
    expect(unwrapRows({ rows })).toEqual(rows);
    expect(unwrapRows({ success: true, rows })).toEqual(rows);
  });

  it("peels data envelopes both shallow and nested", () => {
    expect(unwrapRows({ data: rows })).toEqual(rows);
    expect(unwrapRows({ success: true, data: { rows } })).toEqual(rows);
    expect(
      unwrapRows({ success: true, data: { success: true, data: { rows } } })
    ).toEqual(rows);
  });

  it("degrades to [] instead of throwing on anything unrecognised", () => {
    expect(unwrapRows(undefined)).toEqual([]);
    expect(unwrapRows(null)).toEqual([]);
    expect(unwrapRows({ success: false, error: "venue down" })).toEqual([]);
    expect(unwrapRows("boom")).toEqual([]);
    // A nested data that itself holds no rows: empty, never a crash.
    expect(unwrapRows({ data: { success: true, error: "x" } })).toEqual([]);
    // Non-array rows must not pass the Array.isArray gate as a truthy object.
    expect(unwrapRows({ rows: { not: "an array" } })).toEqual([]);
  });
});
