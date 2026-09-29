/** @format */

import { httpClient } from "./client";

/**
 * One-shot silent session refresh (L14).
 *
 * The WebSocket handshake authenticates with the `accessToken` httpOnly cookie,
 * so an access token that is merely *expired* makes every handshake fail
 * definitively (`WS_INVALID_TOKEN`) even though the session could still be
 * renewed. Before treating that as a dead session the WS client spends exactly
 * one HTTP round-trip proving it.
 *
 * The body-based `POST /api/auth/refresh` cannot be used here: it reads
 * `req.body.refreshToken`, and the browser cannot read the httpOnly refresh
 * cookie (the app never calls that route — login/refresh are cookie-driven).
 * The cookie-based equivalent is an authenticated request: the backend auth
 * middleware rotates the access/refresh cookies itself when it sees an expired
 * (or missing) access token next to a valid refresh token — see
 * `auth.middleware.ts` → `finalizeRefreshedSession()`. `GET /api/auth/me` is
 * the cheapest such endpoint and answers `{ success: true, data: user }`.
 *
 * @returns `true` when the session is valid again (the caller may retry the
 * handshake), `false` when it is not. A definitively-dead refresh token
 * (`401` + code `-1002`) is additionally routed to `/login` by the shared HTTP
 * client's response interceptor (`forceReauthentication`).
 */
export async function refreshSessionOnce(): Promise<boolean> {
  try {
    const response = await httpClient.getClient().get("/api/auth/me");
    return response.data?.success !== false;
  } catch (error) {
    console.warn("📡 Silent session refresh failed", error);
    return false;
  }
}
