/** @format */

/**
 * Single source of truth for the `auth:session-expired` event (L14).
 *
 * One definitive session death can be observed by two layers: the HTTP
 * response interceptor (`401` + code `-1002` on any request — including the
 * WS client's silent `GET /api/auth/me` refresh) and the WebSocket client's
 * one-shot refresh budget. Dispatching independently made listeners see the
 * event twice for a single failure, breaking the "exactly one
 * session-expired per failure episode" contract.
 *
 * The HTTP layer marks its dispatch here; the WS layer consumes the mark and
 * skips its own dispatch when the interceptor already surfaced the same
 * failure. Unmarked WS failures (network errors, non-HTTP handshake
 * failures) still dispatch normally. The mark is a boolean, not a time
 * window — a `-1002` always redirects to `/login`, and the WS layer also
 * discards any stale mark when a failure episode ends (successful
 * reconnect), so a later episode may notify again.
 */

let httpLayerNotified = false;

/** The HTTP interceptor surfaced `auth:session-expired` for this failure. */
export const markSessionExpiredByHttp = (): void => {
  httpLayerNotified = true;
};

/**
 * Returns `true` exactly once per HTTP-layer mark. The WS client uses it to
 * decide whether its own dispatch would duplicate the interceptor's.
 */
export const consumeHttpSessionExpiredMark = (): boolean => {
  const notified = httpLayerNotified;
  httpLayerNotified = false;
  return notified;
};

/** Surface `auth:session-expired` to window listeners. */
export const dispatchSessionExpired = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("auth:session-expired"));
};
