/** @format */

/**
 * Realized-PnL chart + series contract (review P2).
 *
 * The venue series is a cumulative LEVEL; the card's headline is the window
 * CHANGE. Both must agree, and the curve must sit where the headline says.
 * The normalisation is pure (`toWindowSeries`) and tested directly — recharts
 * renders nothing at jsdom's zero container width, so the plotted values are
 * only observable through it.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RealizedPnlChart } from "./RealizedPnlChart";
import { toWindowSeries } from "../utils/realizedPnlSeries";
import type { PerformanceData } from "../utils/realizedPnlSeries";

const LEVELS: PerformanceData[] = [
  { time: "Oct 8, 09:00", value: 5000 },
  { time: "Oct 8, 10:00", value: 5100 },
  { time: "Oct 8, 11:00", value: 5200 },
];

describe("toWindowSeries", () => {
  it("rebases a level series onto its first observation", () => {
    expect(toWindowSeries(LEVELS)).toEqual([
      { time: "Oct 8, 09:00", value: 0, level: 5000 },
      { time: "Oct 8, 10:00", value: 100, level: 5100 },
      { time: "Oct 8, 11:00", value: 200, level: 5200 },
    ]);
  });

  it("keeps a flat level series flat at zero", () => {
    // No closed PnL in the window: the curve is 0 throughout rather than a
    // straight line at the level — what the card's caption promises.
    expect(
      toWindowSeries([
        { time: "a", value: 5000 },
        { time: "b", value: 5000 },
      ])
    ).toEqual([
      { time: "a", value: 0, level: 5000 },
      { time: "b", value: 0, level: 5000 },
    ]);
  });

  it("reads a falling level series as a negative window change", () => {
    expect(
      toWindowSeries([
        { time: "a", value: 5200 },
        { time: "b", value: 5000 },
      ]).map(point => point.value)
    ).toEqual([0, -200]);
  });

  it("handles the empty and single-point series", () => {
    expect(toWindowSeries([])).toEqual([]);
    expect(toWindowSeries([{ time: "a", value: 5000 }])).toEqual([
      { time: "a", value: 0, level: 5000 },
    ]);
  });
});

describe("RealizedPnlChart", () => {
  it("headlines the window change, matching the normalised curve", () => {
    render(<RealizedPnlChart data={LEVELS} />);

    // The headline is the same quantity the curve now plots: last − first.
    expect(screen.getByText("+$200")).toBeDefined();
    // The absolute levels are not presented as PnL anywhere.
    expect(screen.queryByText("$5,200")).toBeNull();
  });

  it("headlines a negative window change as a loss", () => {
    render(
      <RealizedPnlChart
        data={[
          { time: "Oct 8, 09:00", value: 5200 },
          { time: "Oct 8, 10:00", value: 5000 },
        ]}
      />
    );

    expect(screen.getByText("−$200")).toBeDefined();
  });

  it("explains the empty state without inventing a curve", () => {
    render(<RealizedPnlChart data={[]} />);

    expect(screen.getByText("No realized-PnL data")).toBeDefined();
    expect(screen.getByText(/not account equity/i)).toBeDefined();
  });
});
