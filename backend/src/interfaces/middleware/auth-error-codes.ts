/**
 * Auth error codes — single map for the numeric contract the middleware sends
 * to clients. Previously these -100x literals were scattered across
 * `auth.middleware.ts` and the frontend had to match them by hand.
 *
 * -1002 → refresh definitively invalid/legacy (client MUST clear auth state
 *   and force a clean re-login; retrying is futile — this is the code the
 *   wallet-signing investigation called for).
 * -1003 → access token expired and no refresh cookie present.
 * -1004 → generic refresh failure (transient or already-in-progress).
 * -1005 → refresh succeeded but the new access token failed validation.
 * -1006 → unexpected exception during the refresh process.
 * -1008 → refreshed/validated user no longer exists in the database.
 */
export const AUTH_ERROR_CODES = {
    /** Legacy/definitively-invalid refresh token: re-login required. */
    REFRESH_INVALID_DEFINITIVE: -1002,
    /** Access token expired and no refresh token available. */
    EXPIRED_NO_REFRESH: -1003,
    /** Generic/failed refresh (incl. "already in progress" concurrency). */
    REFRESH_FAILED: -1004,
    /** Refresh succeeded but new access token failed validation. */
    REFRESH_VALIDATION_FAILED: -1005,
    /** Unexpected exception during refresh. */
    REFRESH_ERROR: -1006,
    /** Authenticated/refreshed user not found in DB. */
    USER_NOT_FOUND: -1008,
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/**
 * Messages whose presence in an auth-service refresh failure means the token
 * is definitively dead (expired / invalid / revoked / legacy pre-`type`-claim
 * token from before the security hardening). Retrying or refreshing again
 * cannot succeed — the client must discard auth state and re-authenticate.
 */
const DEFINITIVE_REFRESH_FAILURE_PATTERNS = [
    "invalid",
    "expired",
    "invalidated",
    "revoked",
    "legacy",
    "must re-authenticate",
] as const;

/** True when a refresh failure message describes a definitively-dead token. */
export const isDefinitiveRefreshFailure = (message: string | undefined): boolean => {
    if (!message) {
        return false;
    }
    const lower = message.toLowerCase();
    return DEFINITIVE_REFRESH_FAILURE_PATTERNS.some((pattern) =>
        lower.includes(pattern),
    );
};
