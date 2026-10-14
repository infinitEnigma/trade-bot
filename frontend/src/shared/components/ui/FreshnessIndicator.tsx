/** @format */

import React, { useEffect, useState } from "react";
import { cn } from "../../utils";

/**
 * FreshnessIndicator — Phase 3 slice 5's honest "when was this data last
 * fetched" chip on the workspace's execution tabs. Fed a query's
 * `dataUpdatedAt` (epoch ms; 0/undefined = never resolved) it renders a
 * relative age with a status dot: fresh below the poll cadence, warning
 * beyond it, and a distinct "Never updated" state — never an implied live
 * feed (the WS realtime upgrade is deferred).
 *
 * Ages what it is given via a 1 Hz internal ticker; the data itself arrives
 * however its query refreshes (poll, invalidation, focus).
 */
interface FreshnessIndicatorProps {
  /** Epoch ms of the last successful fetch; 0/undefined = never. */
  updatedAt?: number;
  /** Age beyond which the chip turns warning (ms). Default 20 s (2× poll). */
  staleAfterMs?: number;
}

export const FreshnessIndicator: React.FC<FreshnessIndicatorProps> = ({
  updatedAt,
  staleAfterMs = 20000,
}) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!updatedAt) {
    return <span className="text-xs text-textMuted">Never updated</span>;
  }

  const ageMs = Math.max(0, now - updatedAt);
  const seconds = Math.floor(ageMs / 1000);
  const label =
    seconds < 5
      ? "Updated just now"
      : seconds < 60
        ? `Updated ${seconds}s ago`
        : seconds < 3600
          ? `Updated ${Math.floor(seconds / 60)}m ago`
          : `Updated ${Math.floor(seconds / 3600)}h ago`;
  const stale = ageMs >= staleAfterMs;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        stale ? "text-warning" : "text-textMuted"
      )}
      title={new Date(updatedAt).toLocaleString()}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          stale ? "bg-warning" : "bg-success"
        )}
      />
      {label}
    </span>
  );
};
