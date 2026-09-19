/**
 * Session cookie handling — extracted from `auth.middleware.ts`.
 *
 * Single home for the access/refresh/CSRF cookie shapes written after a
 * successful token refresh, plus the clearing helper used when the client
 * must discard auth state (definitive -1002 refresh failure).
 */

import { Response } from "express";
import Tokens from "csrf";

// Cookie lifetimes (ms)
export const ACCESS_COOKIE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
export const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CSRF_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const csrfTokens = new Tokens();

const secureCookies = (): boolean => process.env.NODE_ENV === "production";

export interface RefreshedSessionCookies {
  accessToken: string;
  refreshToken: string;
}

/**
 * Write rotated session cookies after a successful refresh. Returns the fresh
 * CSRF token pair so callers/tests can assert on rotation if needed.
 */
export const setRefreshedSessionCookies = (
  res: Response,
  tokens: RefreshedSessionCookies
): { csrfSecret: string; csrfToken: string } => {
  // Set new httpOnly cookies
  res.cookie("accessToken", tokens.accessToken, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });

  res.cookie("refreshToken", tokens.refreshToken, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });

  // Refresh CSRF token and secret
  const csrfSecret = csrfTokens.secretSync();
  const csrfToken = csrfTokens.create(csrfSecret);

  res.cookie("csrfSecret", csrfSecret, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    maxAge: CSRF_COOKIE_MAX_AGE_MS,
  });

  res.cookie("csrfToken", csrfToken, {
    httpOnly: false, // Client needs to read this
    secure: secureCookies(),
    sameSite: "strict",
    maxAge: CSRF_COOKIE_MAX_AGE_MS,
  });

  return { csrfSecret, csrfToken };
};

/**
 * Clear all session cookies. Used when the refresh token is definitively
 * invalid (-1002) so the browser stops resubmitting a dead cookie and the
 * frontend can force a clean re-login.
 */
export const clearSessionCookies = (res: Response): void => {
  for (const name of [
    "accessToken",
    "refreshToken",
    "csrfSecret",
    "csrfToken",
  ]) {
    res.clearCookie(name, {
      httpOnly: name !== "csrfToken",
      secure: secureCookies(),
      sameSite: "strict",
    });
  }
};
