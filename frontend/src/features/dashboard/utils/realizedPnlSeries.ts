/**
 * Realized-PnL series shaping (review P2).
 *
 * The venue's `trade_pnl` series is a cumulative LEVEL (≈ equity ex open
 * positions) — see `usePortfolioSummary`. The dashboard card reports the window
 * CHANGE (last − first). Plotting the raw levels put the curve at an absolute
 * position that read as "realized PnL to date" beside a headline saying
 * "realized over 7d": two definitions in one card, with a tooltip showing
 * "$5,200" next to "+$200".
 *
 * So the curve is normalised to the first observation. Pure and separately
 * tested — recharts renders nothing at jsdom's zero container width, so the
 * plotted values are only observable through this function.
 */

export interface PerformanceData {
  time: string;
  value: number;
}

/** A window-relative point that still carries the venue's own level. */
export interface WindowPnlPoint extends PerformanceData {
  /** The venue's cumulative level this point came from. */
  level: number;
}

/**
 * Turn a level series into "change over the window": each point's distance
 * from the first observation, with the original level kept alongside for the
 * tooltip. The first point is always 0, so the curve, the headline, the
 * tooltip and the axis all describe the same quantity.
 *
 * A flat level series (no closed PnL in the window) becomes all zeroes rather
 * than a straight line at the level — which is what the card's caption
 * promises.
 */
export function toWindowSeries(points: PerformanceData[]): WindowPnlPoint[] {
  if (points.length === 0) return [];
  const firstLevel = points[0].value;
  return points.map(point => ({
    time: point.time,
    value: point.value - firstLevel,
    level: point.value,
  }));
}
