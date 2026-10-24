/** @format */

/**
 * Fail-closed relative age for a run (or any timestamp) rendered as
 * "just now / Xs ago / Xm ago / Xh ago / Xd ago".
 *
 * - null/undefined/invalid timestamps render as '' so the caller can show '—'
 *   instead of a fabricated date.
 * - Timestamps in the future are treated as unknown, not "just now": a clock
 *   skew or a bad seed must never produce a confident-looking future age.
 * - The comparison is epoch-millisecond based, so the client's local tz
 *   cannot shift the result.
 *
 * @param timestamp ISO-8601 string, epoch ms, or Date (created_at from the
 *                  runs[] payload)
 * @param now       Epoch ms for "now" (defaults to Date.now())
 */
export function formatRelativeDate(
  timestamp: string | number | Date | null | undefined,
  now: number = Date.now()
): string {
  if (
    timestamp === null ||
    timestamp === undefined ||
    !isValidTimestamp(timestamp)
  ) {
    return "";
  }
  const then =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = now - then;
  if (diffMs < 0) return "";
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds < 5) return "just now";
  return `${seconds}s ago`;
}

/**
 * Accepts an ISO-8601 string, epoch ms, or Date; rejects null/undefined/blank.
 */
export function isValidTimestamp(
  value: string | number | Date | null | undefined
): boolean {
  if (value === null || value === undefined) return false;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ms);
}
