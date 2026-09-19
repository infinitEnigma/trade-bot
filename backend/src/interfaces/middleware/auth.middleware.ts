/** @format */

import { Request, Response, NextFunction } from "express";
import {
  AuthResult,
  LegacyAuthResult,
  AuthService,
} from "../../core/auth/auth.service.pure";
import { jwtTokenAdapter } from "../../infrastructure/adapters/token/jwt-token.adapter";
import { serviceProvider } from "../../core/service-provider";

// Lazy service resolution (avoids circular imports; pure service is authoritative).
// Resolved through the service provider at call time instead of a require() grab.
const getAuthService = (): AuthService => serviceProvider.getAuthService();

import { setUserContext } from "../../shared/utils/context";
//import { roleManagementService } from "../../core/auth/role-management.service";
import { authLogger } from "../../core/logging";
import { progressiveAuthLimiter } from "../../infrastructure/security/rate-limiter.service";
import { acquireRefreshMutex, releaseRefreshMutex } from "./auth-refresh-mutex";
import {
  clearSessionCookies,
  setRefreshedSessionCookies,
} from "./auth-session-cookies";
import {
  hydrateSessionUser,
  isLightweightEndpoint,
} from "./auth-session-hydrator";
import {
  AUTH_ERROR_CODES,
  isDefinitiveRefreshFailure,
} from "./auth-error-codes";

// Re-export the extracted helpers so existing deep imports keep working.
export {
  isLightweightEndpoint,
  LIGHTWEIGHT_ENDPOINT_PREFIXES,
} from "./auth-session-hydrator";
export { RELEASE_LOCK_SCRIPT } from "./auth-refresh-mutex";
export { AUTH_ERROR_CODES } from "./auth-error-codes";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    userLevel: string;
    roles: string[];
  };
}

// Exponential backoff retry for token refresh with Redis mutex
async function retryTokenRefresh(
  refreshToken: string,
  req: AuthenticatedRequest,
  maxRetries = 3
): Promise<AuthResult | LegacyAuthResult> {
  let lastError: unknown = null;
  let userId: string | undefined;

  // Extract userId from the token for mutex key
  try {
    const decoded = jwtTokenAdapter.decodeTokenUnsafe(refreshToken);
    userId = decoded?.userId;
  } catch (e) {
    authLogger.warn("Could not decode refresh token for mutex", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const mutex = await acquireRefreshMutex(userId);
  const mutexKey = mutex.key;
  const mutexToken = mutex.token;
  const lockAcquired = mutex.acquired;

  // Another request is already refreshing — preserve the concurrency contract
  if (mutexKey && !lockAcquired) {
    return {
      success: false,
      message: "Token refresh already in progress",
    };
  }

  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        authLogger.debug(`Token refresh attempt ${attempt + 1}/${maxRetries}`, {
          userId,
          lockAcquired,
        });

        const result = await getAuthService().refreshToken(refreshToken);

        if (result.success && result.tokens) {
          authLogger.info(`Token refresh succeeded on attempt ${attempt + 1}`, {
            userId: result.user?.id,
            lockAcquired,
          });
          return result;
        }

        // If the token is definitively dead (invalid/expired/revoked/legacy),
        // don't retry — return the original failure message so
        // respondToFailedRefresh can classify it as -1002.
        if (isDefinitiveRefreshFailure(result.message)) {
          authLogger.debug("Token validation error, not retrying", {
            message: result.message,
            attempt: attempt + 1,
            userId,
          });
          return result;
        }

        lastError = result;

        // Wait before retry with exponential backoff
        if (attempt < maxRetries - 1) {
          const delay = Math.min(100 * Math.pow(2, attempt), 2000); // 100ms, 500ms, 2s max
          authLogger.debug(`Waiting ${delay}ms before retry`, {
            attempt: attempt + 1,
            userId,
            lockAcquired,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        lastError = error;
        authLogger.warn(`Token refresh attempt ${attempt + 1} failed`, {
          error: error instanceof Error ? error.message : String(error),
          userId,
          attempt: attempt + 1,
          lockAcquired,
        });

        // Wait before retry with exponential backoff
        if (attempt < maxRetries - 1) {
          const delay = Math.min(100 * Math.pow(2, attempt), 2000); // 100ms, 500ms, 2s max
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    authLogger.error(
      "All token refresh attempts failed",
      lastError instanceof Error ? lastError : undefined,
      {
        attempts: maxRetries,
        userId,
        lockAcquired,
      }
    );

    return {
      success: false,
      message: "Token refresh failed after multiple attempts",
    };
  } finally {
    // Always release the mutex if we acquired it
    if (lockAcquired && mutexKey) {
      await releaseRefreshMutex(
        { key: mutexKey, acquired: lockAcquired, token: mutexToken },
        userId
      );
    }
  }
}

/**
 * Respond to a failed token refresh with the appropriate error body.
 * Preserves the "refresh already in progress" contract for concurrent requests.
 */
function respondToFailedRefresh(res: Response, message?: string): void {
  if (message === "Token refresh already in progress") {
    res.status(401).json({
      success: false,
      code: AUTH_ERROR_CODES.REFRESH_FAILED,
      message: "Token refresh already in progress",
    });
  } else if (isDefinitiveRefreshFailure(message)) {
    // Refresh token is definitively invalid/legacy (e.g. issued before the
    // `type`-claim security hardening). Tell the client to discard auth state
    // and re-login, and stop the browser from resubmitting the dead cookie.
    authLogger.warn("Definitive refresh failure - clearing session cookies", {
      message,
    });
    clearSessionCookies(res);
    res.status(401).json({
      success: false,
      code: AUTH_ERROR_CODES.REFRESH_INVALID_DEFINITIVE,
      message: "Session expired - please log in again",
    });
  } else {
    res.status(401).json({
      success: false,
      code: AUTH_ERROR_CODES.REFRESH_FAILED,
      message: "Unauthorized - token refresh failed after multiple attempts",
    });
  }
}

/**
 * Apply the results of a successful token refresh to the request/response:
 * set new cookies, rotate CSRF, load user data, and continue down the chain.
 * Responds (and returns without calling next()) if session hydration fails.
 */
async function finalizeRefreshedSession(
  req: AuthenticatedRequest,
  res: Response,
  refreshResult: AuthResult | LegacyAuthResult,
  next: NextFunction
): Promise<void> {
  const tokens = refreshResult.tokens;
  if (!tokens) {
    respondToFailedRefresh(res, refreshResult.message);
    return;
  }

  authLogger.info("Token automatically refreshed", {
    userId: refreshResult.user?.id,
    email: refreshResult.user?.email,
  });

  // Set rotated session cookies (access/refresh + fresh CSRF pair)
  setRefreshedSessionCookies(res, tokens);

  // Verify the new access token and set user on request
  const newPayload = await getAuthService().validateToken(tokens.accessToken);
  if (!newPayload) {
    authLogger.error(
      "New access token validation failed after refresh",
      new Error("Token validation failed")
    );
    res.status(500).json({
      success: false,
      code: AUTH_ERROR_CODES.REFRESH_VALIDATION_FAILED,
      message: "Token refresh succeeded but validation failed",
    });
    return;
  }

  const hydration = await hydrateSessionUser(
    newPayload.userId,
    isLightweightEndpoint(req.path)
  );
  if ("failure" in hydration) {
    authLogger.error(
      "Refreshed user not found for hydrator endpoint",
      undefined,
      {
        userId: newPayload.userId,
        endpoint: req.path,
      }
    );
    res.status(401).json({
      success: false,
      code: AUTH_ERROR_CODES.USER_NOT_FOUND,
      message:
        hydration.failure === "USER_NOT_FOUND"
          ? "Unauthorized - refreshed user not found"
          : "Unauthorized - refreshed user data not found",
    });
    return;
  }

  req.user = {
    ...newPayload,
    userLevel: hydration.user.userLevel,
    roles: hydration.user.roles,
  };

  // Set user context for logging and tracing
  setUserContext(newPayload.userId, newPayload.userLevel);

  // Clear failure counter on successful auth
  const identifier = `ip:${req.ip}`;
  await progressiveAuthLimiter.recordSuccess(identifier);

  next();
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Detailed logging for debugging
    authLogger.debug("Auth middleware request details", {
      path: req.path,
      method: req.method,
      headers: Object.keys(req.headers).filter(k =>
        ["authorization", "cookie", "user-agent"].includes(k)
      ),
      cookies: req.cookies ? Object.keys(req.cookies) : "no cookies",
    });

    // Get token from Authorization header or httpOnly cookie
    const authHeader = req.headers["authorization"];
    let token = authHeader && authHeader.split(" ")[1];

    // If no token in header, try to get from httpOnly cookie
    if (!token) {
      token = req.cookies?.accessToken;
    }

    authLogger.debug("Token extraction result", {
      tokenFromHeader: !!authHeader,
      tokenFromCookie: !!req.cookies?.accessToken,
      tokenPresent: !!token,
    });

    if (!token) {
      // Check if refreshToken is available and attempt to refresh
      const refreshToken = req.cookies?.refreshToken;
      if (refreshToken) {
        authLogger.debug(
          "Access token missing, attempting refresh with refresh token",
          {
            path: req.path,
            method: req.method,
          }
        );

        try {
          const refreshResult = await retryTokenRefresh(refreshToken, req);
          if (!refreshResult.success || !refreshResult.tokens) {
            authLogger.error("Token refresh failed after retries", undefined, {
              message: refreshResult.message,
              userId: req.user?.userId || "unknown",
            });
            respondToFailedRefresh(res, refreshResult.message);
            return;
          }

          await finalizeRefreshedSession(req, res, refreshResult, next);
          return;
        } catch (refreshError) {
          authLogger.error(
            "Token refresh process failed",
            refreshError instanceof Error ? refreshError : undefined,
            {
              error:
                refreshError instanceof Error
                  ? refreshError.message
                  : String(refreshError),
            }
          );
          res.status(401).json({
            success: false,
            code: -1006,
            message: "Unauthorized - token refresh error",
          });
          return;
        }
      } else {
        authLogger.warn("Unauthorized - no token provided", {
          path: req.path,
          method: req.method,
        });
        res.status(401).json({
          success: false,
          code: -1001,
          message: "Unauthorized - no token provided",
        });
        return;
      }
    }

    // Verify token
    const payload = await getAuthService().validateToken(token);
    if (!payload) {
      res.status(403).json({
        success: false,
        code: -1002,
        message: "Unauthorized - invalid token",
      });
      return;
    }

    // Check if this is a lightweight endpoint that doesn't need full user data.
    // The token-payload fallback preserves the legacy fresh-token behavior
    // (default REGISTERED) for backwards compatibility.
    const freshHydration = await hydrateSessionUser(
      payload.userId,
      isLightweightEndpoint(req.path),
      { userId: payload.userId, userLevel: payload.userLevel }
    );
    if ("failure" in freshHydration) {
      authLogger.warn("User not found for hydrator endpoint", {
        userId: payload.userId,
        endpoint: req.path,
      });
      res.status(401).json({
        success: false,
        code: AUTH_ERROR_CODES.USER_NOT_FOUND,
        message:
          freshHydration.failure === "USER_NOT_FOUND"
            ? "Unauthorized - user not found"
            : "Unauthorized - refreshed user data not found",
      });
      return;
    }

    req.user = {
      ...payload,
      userLevel: freshHydration.user.userLevel,
      roles: freshHydration.user.roles,
    };

    // Set user context for logging and tracing
    setUserContext(payload.userId, payload.userLevel);

    // Clear failure counter on successful auth
    const identifier = `ip:${req.ip}`;
    await progressiveAuthLimiter.recordSuccess(identifier);

    next();
  } catch (error) {
    authLogger.error(
      "Auth middleware error",
      error instanceof Error ? error : undefined,
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );

    // Handle token expiration - attempt automatic refresh
    // Check if token is expired by trying to verify it again with the adapter
    if (
      error instanceof Error &&
      (error.message.includes("jwt expired") ||
        error.name === "TokenExpiredError")
    ) {
      authLogger.debug("Access token expired, attempting automatic refresh");

      try {
        // Get refresh token from httpOnly cookie
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
          authLogger.debug("No refresh token available");
          res.status(401).json({
            success: false,
            code: -1003,
            message: "Unauthorized - token expired and no refresh token",
          });
          return;
        }

        // Attempt to refresh the token with exponential backoff retry
        const refreshResult = await retryTokenRefresh(refreshToken, req);
        if (!refreshResult.success || !refreshResult.tokens) {
          authLogger.error("Token refresh failed after retries", undefined, {
            message: refreshResult.message,
            userId: req.user?.userId || "unknown",
          });
          respondToFailedRefresh(res, refreshResult.message);
          return;
        }

        await finalizeRefreshedSession(req, res, refreshResult, next);
      } catch (refreshError) {
        authLogger.error(
          "Token refresh process failed",
          refreshError instanceof Error ? refreshError : undefined,
          {
            error:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
          }
        );
        res.status(401).json({
          success: false,
          code: -1006,
          message: "Unauthorized - token refresh error",
        });
        return;
      }

      return;
    }

    res.status(500).json({
      success: false,
      code: -1000,
      message: "Authentication error",
    });
  }
}
