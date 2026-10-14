/** @format */

/**
 * FreshnessIndicator (Phase 3 slice 5): honest age of a query's last
 * successful fetch — "Never updated" for 0/undefined (never a fabricated
 * age), a fresh chip for a just-now fetch, and a warning-toned stale chip
 * once the age passes the poll cadence. Time is pinned with fake timers so
 * no assertion races the clock.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FreshnessIndicator } from "./FreshnessIndicator";

afterEach(() => {
  vi.useRealTimers();
});

describe("FreshnessIndicator", () => {
  it("reports the never-fetched state distinctly (never a fake age)", () => {
    render(<FreshnessIndicator updatedAt={0} />);
    expect(screen.getByText("Never updated")).toBeDefined();

    render(<FreshnessIndicator />);
    expect(screen.getAllByText("Never updated")).toHaveLength(2);
  });

  it("shows a fresh chip for a just-now fetch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00.000Z"));

    render(<FreshnessIndicator updatedAt={Date.now()} />);
    const chip = screen.getByText("Updated just now");
    expect(chip.className).toContain("text-textMuted");
  });

  it("flags stale data with the warning tone once past the cadence", () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-13T12:00:00.000Z");
    vi.setSystemTime(now);

    render(<FreshnessIndicator updatedAt={now.getTime() - 65_000} />);
    const chip = screen.getByText("Updated 1m ago");
    expect(chip.className).toContain("text-warning");
  });
});
