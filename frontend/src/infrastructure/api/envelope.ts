/** @format */

/**
 * Venue-envelope row extraction (F3 sweep — prod 2026-10-14).
 *
 * `/api/market/*` reader payloads are venue-inconsistent: Kodiak and Lighter
 * disagree both on WHERE the rows live and on HOW MANY envelopes wrap them —
 *   - bare array            `data: [...]`
 *   - single envelope       `data: { rows: [...] }`
 *   - nested venue envelope `data: { success, data: { rows: [...] } }`
 * (`q.filter is not a function` blanked /strategies when a `{ rows }` payload
 * reached a consumer expecting an array; a `.rows`-only reader silently drops
 * whichever shape it was NOT written for).
 *
 * One recursive unwrapper so every consumer only ever sees a real array —
 * never a throw during render, and never a silently-empty table because one
 * envelope level was missed. Anything unrecognised degrades to `[]` (an
 * unreadable payload reads as "no rows", it never crashes the page).
 */
export function unwrapRows<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const envelope = payload as { rows?: unknown; data?: unknown };
    if (Array.isArray(envelope.rows)) return envelope.rows as T[];
    if (envelope.data !== undefined && envelope.data !== null) {
      return unwrapRows<T>(envelope.data);
    }
  }
  return [];
}
