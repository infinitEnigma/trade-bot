/** @format */

/**
 * `cleanup_incomplete` marker parsing (P0.1) — lives in utils (not the
 * banner component file) so `react-refresh/only-export-components` stays
 * clean, the same reason `summarizeBotStates` has its own file.
 *
 * Wire contract with the engine's `CLEANUP_INCOMPLETE_MARKER`
 * (`engine/src/application/bot-manager.ts`) and the backend's copy
 * (`backend/src/core/bots/lifecycle/types.ts`) — each package keeps its own
 * constant; the three must stay equal.
 */

export const CLEANUP_INCOMPLETE_MARKER = "cleanup_incomplete";

/**
 * The verified residual after the marker (`…; cleanup_incomplete: <detail>`)
 * in a bot's `force_stop_reason`, or null when the reason carries no marker
 * (a verified-clean stop — consumers render nothing for it).
 */
export function cleanupIncompleteDetail(
  reason: string | null | undefined
): string | null {
  if (typeof reason !== "string") return null;
  const at = reason.indexOf(CLEANUP_INCOMPLETE_MARKER);
  if (at < 0) return null;
  const detail = reason
    .slice(at + CLEANUP_INCOMPLETE_MARKER.length)
    .replace(/^[:;]\s*/, "")
    .trim();
  return detail || "venue cleanup could not be verified";
}
