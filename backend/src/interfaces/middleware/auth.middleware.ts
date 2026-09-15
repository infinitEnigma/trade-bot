/** @format */

import { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { AuthResult, LegacyAuthResult, AuthService } from "../../core/auth/auth.service.pure";
import { jwtTokenAdapter } from "../../infrastructure/adapters/token/jwt-token.adapter";
import Tokens from "csrf";
import { serviceProvider } from "../../core/service-provider";

// Lazy service resolution (avoids circular imports; pure service is authoritative).
// Resolved through the service provider at call time instead of a require() grab.
const getAuthService = (): AuthService => serviceProvider.getAuthService();

import { redisService } from "../../infrastructure/cache/redis.service";
import { setUserContext } from "../../shared/utils/context";
//import { roleManagementService } from "../../core/auth/role-management.service";
import { authLogger } from "../../core/logging";
import { progressiveAuthLimiter } from "../../infrastructure/security/rate-limiter.service";

// Initialize CSRF tokens for refresh
const csrfTokens = new Tokens();

// ============================================
// CONSTANTS
// ============================================

// Cookie lifetimes (ms)
const ACCESS_COOKIE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CSRF_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Endpoints served without loading full user data/roles (performance optimization).
// Keep this list integration-scoped (not exchange-scoped) so new exchanges do not
// require changes to the auth middleware.
const LIGHTWEIGHT_ENDPOINT_PREFIXES = [
  "/api/user/kodiak/status",
  "/api/user/kodiak/trades",
  "/api/user/kodiak/positions",
  "/api/user/kodiak/balance",
];

const isLightweightEndpoint = (path: string): boolean =>
  LIGHTWEIGHT_ENDPOINT_PREFIXES.some((prefix) => path.startsWith(prefix));

// Atomic mutex release: only the owner may delete the key. Prevents releasing
// a lock that has expired and already been re-acquired by another request.
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    userLevel: string;
    roles: string[];
  };
}

// Exponential backoff retry for token refresh with Redis mutex
async function retryTokenRefresh(refreshToken: string, req: AuthenticatedRequest, maxRetries = 3): Promise<AuthResult | LegacyAuthResult> {
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

  const mutexKey = userId ? `mutex:refresh:${userId}` : null;
  // Random owner token so only this request can release its own lock
  const mutexToken = randomBytes(16).toString("hex");
  let lockAcquired = false;

  // Try to acquire mutex if we have a userId
  if (mutexKey) {
    try {
      // Use SETNX (set if not exists) with short TTL for mutex
      const lockResult = await redisService.getClient().set(mutexKey, mutexToken, {
        NX: true,
        EX: 30, // 30 second lock
      });
      lockAcquired = lockResult === "OK";

      if (!lockAcquired) {
        authLogger.debug("Token refresh mutex already held, queuing request", {
          userId,
          mutexKey,
        });
        // Return early - another request is already refreshing
        return {
          success: false,
          message: "Token refresh already in progress",
        };
      }
    } catch (lockError) {
      authLogger.warn("Failed to acquire token refresh mutex", {
        error: lockError instanceof Error ? lockError.message : String(lockError),
        userId,
        mutexKey,
      });
      // Continue without mutex - better to allow refresh than block
    }
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

        // If it's a validation error, don't retry
        if (result.message?.includes('invalid') || result.message?.includes('expired') || result.message?.includes('invalidated')) {
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
    authLogger.error("All token refresh attempts failed", lastError instanceof Error ? lastError : undefined, {
      attempts: maxRetries,
      userId,
      lockAcquired,
    });

    return {
      success: false,
      message: "Token refresh failed after multiple attempts",
    };
  } finally {
    // Always release the mutex if we acquired it
    if (lockAcquired && mutexKey) {
      try {
        // Atomic compare-and-delete: only release the lock we still own
        await redisService.getClient().eval(RELEASE_LOCK_SCRIPT, {
          keys: [mutexKey],
          arguments: [mutexToken],
        });
        authLogger.debug("Released token refresh mutex", {
          userId,
          mutexKey,
        });
      } catch (unlockError) {
        authLogger.warn("Failed to release token refresh mutex", {
          error: unlockError instanceof Error ? unlockError.message : String(unlockError),
          userId,
          mutexKey,
        });
      }
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
      code: -1004,
      message: "Token refresh already in progress",
    });
  } else {
    res.status(401).json({
      success: false,
      code: -1004,
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

  // Set new httpOnly cookies
  res.cookie("accessToken", tokens.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });

  res.cookie("refreshToken", tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });

  // Refresh CSRF token and secret
  const newCsrfSecret = csrfTokens.secretSync();
  const newCsrfToken = csrfTokens.create(newCsrfSecret);

  res.cookie("csrfSecret", newCsrfSecret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: CSRF_COOKIE_MAX_AGE_MS,
  });

  res.cookie("csrfToken", newCsrfToken, {
    httpOnly: false, // Client needs to read this
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: CSRF_COOKIE_MAX_AGE_MS,
  });

  // Verify the new access token and set user on request
  const newPayload = await getAuthService().validateToken(tokens.accessToken);
  if (!newPayload) {
    authLogger.error(
      "New access token validation failed after refresh",
      new Error("Token validation failed")
    );
    res.status(500).json({
      success: false,
      code: -1005,
      message: "Token refresh succeeded but validation failed",
    });
    return;
  }

  if (isLightweightEndpoint(req.path)) {
    // For lightweight endpoints, just verify user exists without loading full data
    const userExists = await getAuthService().getUserById(newPayload.userId);
    if (!userExists) {
      authLogger.error("Refreshed user not found for lightweight endpoint", undefined, {
        userId: newPayload.userId,
        endpoint: req.path,
      });
      res.status(401).json({
        success: false,
        code: -1008,
        message: "Unauthorized - refreshed user not found",
      });
      return;
    }

    req.user = {
      ...newPayload,
      userLevel: userExists.userLevel,
      roles: [] // Lightweight endpoints don't need roles
    };
  } else {
    // Load complete user data for refreshed token (N+1 optimization)
    const refreshedUserData = await getAuthService().getAuthenticatedUserData(newPayload.userId);
    if (!refreshedUserData) {
      authLogger.error("Failed to load refreshed user data - user not found", undefined, {
        userId: newPayload.userId,
      });
      res.status(401).json({
        success: false,
        code: -1008,
        message: "Unauthorized - refreshed user data not found",
      });
      return;
    }

    req.user = {
      ...newPayload,
      userLevel: refreshedUserData.user.userLevel, // Always use current userLevel from database
      roles: refreshedUserData.roles
    };
  }

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
      headers: Object.keys(req.headers).filter(k => ['authorization', 'cookie', 'user-agent'].includes(k)),
      cookies: req.cookies ? Object.keys(req.cookies) : 'no cookies',
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
        authLogger.debug("Access token missing, attempting refresh with refresh token", {
          path: req.path,
          method: req.method,
        });

        try {
          const refreshResult = await retryTokenRefresh(refreshToken, req);
          if (!refreshResult.success || !refreshResult.tokens) {
            authLogger.error("Token refresh failed after retries", undefined, {
              message: refreshResult.message,
              userId: req.user?.userId || 'unknown',
            });
            respondToFailedRefresh(res, refreshResult.message);
            return;
          }

          await finalizeRefreshedSession(req, res, refreshResult, next);
          return;
        } catch (refreshError) {
          authLogger.error("Token refresh process failed", refreshError instanceof Error ? refreshError : undefined, {
            error:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
          });
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

    // Check if this is a lightweight endpoint that doesn't need full user data
    if (isLightweightEndpoint(req.path)) {
      // For lightweight endpoints, just verify user exists without loading full data
      const userExists = await getAuthService().getUserById(payload.userId);
      if (!userExists) {
        authLogger.warn("User not found for lightweight endpoint", {
          userId: payload.userId,
          endpoint: req.path,
        });
        res.status(401).json({
          success: false,
          code: -1007,
          message: "Unauthorized - user not found",
        });
        return;
      }

      req.user = {
        ...payload,
        userLevel: userExists.userLevel,
        roles: [] // Lightweight endpoints don't need roles
      };
    } else {
      // Load complete user data with roles and credentials for complex endpoints
      const userData = await getAuthService().getAuthenticatedUserData(payload.userId);
      if (!userData) {
        authLogger.warn("User data not found, using token payload only", {
          userId: payload.userId,
        });
        // Fall back to token payload for user data
        req.user = {
          ...payload,
          userLevel: payload.userLevel || 'REGISTERED', // Default to REGISTERED if not in token
          roles: [] // No roles available
        };
      } else {
        const userRoles = userData.roles;

        req.user = {
          ...payload,
          userLevel: userData.user.userLevel, // Always use current userLevel from database
          roles: userRoles
        };
      }
    }

    // Set user context for logging and tracing
    setUserContext(payload.userId, payload.userLevel);

    // Clear failure counter on successful auth
    const identifier = `ip:${req.ip}`;
    await progressiveAuthLimiter.recordSuccess(identifier);

    next();
  } catch (error) {
    authLogger.error("Auth middleware error", error instanceof Error ? error : undefined, {
      error: error instanceof Error ? error.message : String(error),
    });

    // Handle token expiration - attempt automatic refresh
    // Check if token is expired by trying to verify it again with the adapter
    if (error instanceof Error && (error.message.includes('jwt expired') || error.name === 'TokenExpiredError')) {
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
            userId: req.user?.userId || 'unknown',
          });
          respondToFailedRefresh(res, refreshResult.message);
          return;
        }

        await finalizeRefreshedSession(req, res, refreshResult, next);
      } catch (refreshError) {
        authLogger.error("Token refresh process failed", refreshError instanceof Error ? refreshError : undefined, {
          error:
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError),
        });
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
