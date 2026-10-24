/** @format */

import {
  formatRelativeDate,
  isValidTimestamp,
} from "../../../../../shared/utils/relativeTime";

describe("isValidTimestamp", () => {
  it("accepts a valid ISO-8601 string", () => {
    expect(isValidTimestamp("2026-10-12T10:00:00.000Z")).toBe(true);
  });

  it("accepts epoch milliseconds", () => {
    expect(isValidTimestamp(1_700_000_000_000)).toBe(true);
  });

  it("accepts a Date", () => {
    expect(isValidTimestamp(new Date("2026-10-12T10:00:00.000Z"))).toBe(true);
  });

  it("rejects null, undefined and blank strings", () => {
    expect(isValidTimestamp(null)).toBe(false);
    expect(isValidTimestamp(undefined)).toBe(false);
    expect(isValidTimestamp("")).toBe(false);
    expect(isValidTimestamp("   ")).toBe(false);
  });

  it("rejects unparseable strings", () => {
    expect(isValidTimestamp("not a date")).toBe(false);
    // Month 13 / day 45 / hour 99 — any invalid component yields an
    // Invalid Date (JS does not overflow dates like it does with Feb 30).
    expect(isValidTimestamp("2026-13-45T99:99:99.000Z")).toBe(false);
  });
});

describe("formatRelativeDate", () => {
  const FIXED_NOW = 1_700_000_000_000; // 2023-11-14T12:13:20.000Z

  const iso = (ms: number): string => new Date(ms).toISOString();

  it("renders 'just now' for a timestamp under 5s old", () => {
    const ago = Date.now() - 1_000;
    expect(formatRelativeDate(iso(ago), Date.now())).toBe("just now");
  });

  it("renders Xs ago under a minute, and 'just now' under the 5s boundary", () => {
    expect(formatRelativeDate(iso(FIXED_NOW - 45_000), FIXED_NOW)).toBe(
      "45s ago"
    );
    // 4.999s is below the 5-second threshold → "just now".
    expect(formatRelativeDate(iso(FIXED_NOW - 4_999), FIXED_NOW)).toBe(
      "just now"
    );
  });

  it("renders Xm ago under an hour", () => {
    // 58m20s stays in the minutes bucket.
    expect(formatRelativeDate(iso(FIXED_NOW - 3_500_000), FIXED_NOW)).toBe(
      "58m ago"
    );
  });

  it("renders Xh ago under a day", () => {
    expect(formatRelativeDate(iso(FIXED_NOW - 7_200_000), FIXED_NOW)).toBe(
      "2h ago"
    );
  });

  it("renders Xd ago beyond a day", () => {
    expect(formatRelativeDate(iso(FIXED_NOW - 2 * 86_400_000), FIXED_NOW)).toBe(
      "2d ago"
    );
  });

  it("never fabricates a future age", () => {
    expect(formatRelativeDate(iso(FIXED_NOW + 60_000), FIXED_NOW)).toBe("");
  });

  it("renders 'just now' for a timestamp exactly at the boundary", () => {
    // 4.999s -> just now; below the 5s threshold.
    expect(formatRelativeDate(iso(FIXED_NOW - 4_999), FIXED_NOW)).toBe(
      "just now"
    );
  });

  it("returns '' for null, undefined, empty and invalid timestamps", () => {
    expect(formatRelativeDate(null, FIXED_NOW)).toBe("");
    expect(formatRelativeDate(undefined, FIXED_NOW)).toBe("");
    expect(formatRelativeDate("", FIXED_NOW)).toBe("");
    expect(formatRelativeDate("not a date", FIXED_NOW)).toBe("");
  });

  it("accepts a Date instance", () => {
    const then = new Date(FIXED_NOW - 3_600_000);
    // Exactly 1 hour → rounds up to hours (repo convention).
    expect(formatRelativeDate(then, FIXED_NOW)).toBe("1h ago");
  });
});
