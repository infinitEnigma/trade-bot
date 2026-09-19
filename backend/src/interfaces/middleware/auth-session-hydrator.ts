/**
 * Session hydration — extracted from `auth.middleware.ts`.
 *
 * Single implementation of the user-loading rule that was duplicated in three
 * places: lightweight endpoints verify existence via `getUserById` (no roles),
 * full endpoints load `getAuthenticatedUserData` (roles + fresh userLevel).
 * Both the fresh-token path and the post-refresh path use this helper.
 */

import { serviceProvider } from "../../core/service-provider";
import { authLogger } from "../../core/logging";

export interface HydratedSessionUser {
    userId: string;
    email: string;
    userLevel: string;
    roles: string[];
}

// Endpoints served without loading full user data/roles (perf optimization).
// Keep this list integration-scoped (not exchange-scoped) so new exchanges do
// not require changes to the auth middleware.
export const LIGHTWEIGHT_ENDPOINT_PREFIXES = [
    "/api/user/kodiak/status",
    "/api/user/kodiak/trades",
    "/api/user/kodiak/positions",
    "/api/user/kodiak/balance",
];

/** Lightweight endpoints: existence check only, no roles loaded. */
export const isLightweightEndpoint = (path: string): boolean =>
  LIGHTWEIGHT_ENDPOINT_PREFIXES.some(prefix => path.startsWith(prefix));

export type HydrationFailureReason = "USER_NOT_FOUND" | "USER_DATA_NOT_FOUND";

export interface HydrationUserFallback {
    userId: string;
    userLevel?: string;
}

/**
 * Load the session user for an authenticated userId.
 *
 * Returns `{ user }` on success or `{ failure }` when the response has
 * already been conceptually decided by the caller (maps to -1008).
 *
 * `fallbackPayload` preserves the legacy fresh-token behavior: when full user
 * data cannot be loaded, fall back to the token payload (defaulting to
 * REGISTERED) instead of failing the request. The post-refresh path passes no
 * fallback and therefore still 401s on missing user data, exactly as before.
 */
export const hydrateSessionUser = async (
    userId: string,
    lightweight: boolean,
  fallbackPayload?: HydrationUserFallback
): Promise<
  { user: HydratedSessionUser } | { failure: HydrationFailureReason }
> => {
    const authService = serviceProvider.getAuthService();
    if (lightweight) {
        // For lightweight endpoints, just verify user exists without loading full data
        const userExists = await authService.getUserById(userId);
        if (!userExists) {
            authLogger.error("User not found for lightweight endpoint", undefined, {
                userId,
            });
            return { failure: "USER_NOT_FOUND" };
        }
        return {
            user: {
                userId,
                email: userExists.email,
                userLevel: userExists.userLevel,
                roles: [], // Lightweight endpoints don't need roles
            },
        };
    }
    // Load complete user data with roles and credentials for complex endpoints
    const userData = await authService.getAuthenticatedUserData(userId);
    if (!userData) {
        if (fallbackPayload) {
            authLogger.warn("User data not found, using token payload only", {
                userId,
            });
            return {
                user: {
                    userId,
                    email: "",
                    // Default to REGISTERED if not in token
                    userLevel: fallbackPayload.userLevel || "REGISTERED",
                    roles: [], // No roles available
                },
            };
        }
        authLogger.error("Failed to load user data - user not found", undefined, {
            userId,
        });
        return { failure: "USER_DATA_NOT_FOUND" };
    }
    return {
        user: {
            userId,
            email: userData.user.email,
            // Always use current userLevel from database
            userLevel: userData.user.userLevel,
            roles: userData.roles,
        },
    };
};
