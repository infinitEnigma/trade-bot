/** @format */

import { Request, Response, NextFunction } from "express";
import { selectAuthService } from "../../core/service-selector";
import { AuthResult, LegacyAuthResult } from "../../core/auth/auth.service.pure";
import { jwtTokenAdapter } from "../../infrastructure/adapters/token/jwt-token.adapter";
import Tokens from "csrf";

const authService = selectAuthService();
import { redisService } from "../../infrastructure/cache/redis.service";
import { setUserContext } from "../../shared/utils/context";
//import { roleManagementService } from "../../core/auth/role-management.service";
import { authLogger } from "../../core/logging";
import { progressiveAuthLimiter } from "../../infrastructure/security/rate-limiter.service";

// Initialize CSRF tokens for refresh
const csrfTokens = new Tokens();

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
  let lockAcquired = false;

  // Try to acquire mutex if we have a userId
  if (mutexKey) {
    try {
      // Use SETNX (set if not exists) with short TTL for mutex
      const lockResult = await redisService.getClient().set(mutexKey, "1", {
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

        const result = await authService.refreshToken(refreshToken);

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
        await redisService.del(mutexKey);
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
            if (refreshResult.message === "Token refresh already in progress") {
              authLogger.debug("Token refresh already in progress", {
                userId: req.user?.userId || 'unknown',
              });
              res.status(401).json({
                success: false,
                code: -1004,
                message: "Token refresh already in progress",
              });
            } else {
              authLogger.error("Token refresh failed after retries", undefined, {
                message: refreshResult.message,
                userId: req.user?.userId || 'unknown',
              });
              res.status(401).json({
                success: false,
                code: -1004,
                message: "Unauthorized - token refresh failed after multiple attempts",
              });
            }
            return;
          }

          authLogger.info("Token automatically refreshed", {
            userId: refreshResult.user?.id,
            email: refreshResult.user?.email,
          });

          // Set new httpOnly cookies
          res.cookie("accessToken", refreshResult.tokens.accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 4 * 60 * 60 * 1000, // 4 hours
          });

          res.cookie("refreshToken", refreshResult.tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          });

          // Refresh CSRF token and secret
          const newCsrfSecret = csrfTokens.secretSync();
          const newCsrfToken = csrfTokens.create(newCsrfSecret);

          res.cookie('csrfSecret', newCsrfSecret, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
          });

          res.cookie('csrfToken', newCsrfToken, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
          });

          // Verify the new access token and set user on request
          const newPayload = await authService.validateToken(
            refreshResult.tokens.accessToken
          );
          if (!newPayload) {
            authLogger.error("New access token validation failed after refresh", new Error("Token validation failed"));
            res.status(500).json({
              success: false,
              code: -1005,
              message: "Token refresh succeeded but validation failed",
            });
            return;
          }

          // Check if this is a lightweight endpoint for refreshed token too
          const isLightweightEndpointRefresh = req.path.startsWith('/api/user/kodiak/status') ||
            req.path.startsWith('/api/user/kodiak/trades') ||
            req.path.startsWith('/api/user/kodiak/positions') ||
            req.path.startsWith('/api/user/kodiak/balance');

          if (isLightweightEndpointRefresh) {
            // For lightweight endpoints, just verify user exists without loading full data
            const userExists = await authService.getUserById(newPayload.userId);
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
            const refreshedUserData = await authService.getAuthenticatedUserData(newPayload.userId);
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

            const refreshedUserRoles = refreshedUserData.roles;

            req.user = {
              ...newPayload,
              userLevel: refreshedUserData.user.userLevel, // Always use current userLevel from database
              roles: refreshedUserRoles
            };
          }

          // Set user context for logging and tracing
          setUserContext(newPayload.userId, newPayload.userLevel);

          // Clear failure counter on successful auth
          const identifier = `ip:${req.ip}`;
          await progressiveAuthLimiter.recordSuccess(identifier);

          next();
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
    const payload = await authService.validateToken(token);
    if (!payload) {
      res.status(403).json({
        success: false,
        code: -1002,
        message: "Unauthorized - invalid token",
      });
      return;
    }

    // Check if this is a lightweight endpoint that doesn't need full user data
    const isLightweightEndpoint = req.path.startsWith('/api/user/kodiak/status') ||
      req.path.startsWith('/api/user/kodiak/trades') ||
      req.path.startsWith('/api/user/kodiak/positions') ||
      req.path.startsWith('/api/user/kodiak/balance');

    if (isLightweightEndpoint) {
      // For lightweight endpoints, just verify user exists without loading full data
      const userExists = await authService.getUserById(payload.userId);
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
      const userData = await authService.getAuthenticatedUserData(payload.userId);
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
          if (refreshResult.message === "Token refresh already in progress") {
            authLogger.debug("Token refresh already in progress", {
              userId: req.user?.userId || 'unknown',
            });
            res.status(401).json({
              success: false,
              code: -1004,
              message: "Token refresh already in progress",
            });
          } else {
            authLogger.error("Token refresh failed after retries", undefined, {
              message: refreshResult.message,
              userId: req.user?.userId || 'unknown',
            });
            res.status(401).json({
              success: false,
              code: -1004,
              message: "Unauthorized - token refresh failed after multiple attempts",
            });
          }
          return;
        }

        authLogger.info("Token automatically refreshed", {
          userId: refreshResult.user?.id,
          email: refreshResult.user?.email,
        });

        // Set new httpOnly cookies
        res.cookie("accessToken", refreshResult.tokens.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 4 * 60 * 60 * 1000, // 4 hours
        });

        res.cookie("refreshToken", refreshResult.tokens.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });

        // Refresh CSRF token and secret
        const newCsrfSecret = csrfTokens.secretSync();
        const newCsrfToken = csrfTokens.create(newCsrfSecret);

        res.cookie('csrfSecret', newCsrfSecret, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        res.cookie('csrfToken', newCsrfToken, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        // Verify the new access token and set user on request
        const newPayload = await authService.validateToken(
          refreshResult.tokens.accessToken
        );
        if (!newPayload) {
          authLogger.error("New access token validation failed after refresh", new Error("Token validation failed"));
          res.status(500).json({
            success: false,
            code: -1005,
            message: "Token refresh succeeded but validation failed",
          });
          return;
        }

        // Check if this is a lightweight endpoint for refreshed token too
        const isLightweightEndpointRefresh = req.path.startsWith('/api/user/kodiak/status') ||
          req.path.startsWith('/api/user/kodiak/trades') ||
          req.path.startsWith('/api/user/kodiak/positions') ||
          req.path.startsWith('/api/user/kodiak/balance');

        if (isLightweightEndpointRefresh) {
          // For lightweight endpoints, just verify user exists without loading full data
          const userExists = await authService.getUserById(newPayload.userId);
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
          const refreshedUserData = await authService.getAuthenticatedUserData(newPayload.userId);
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

          const refreshedUserRoles = refreshedUserData.roles;

          req.user = {
            ...newPayload,
            userLevel: refreshedUserData.user.userLevel, // Always use current userLevel from database
            roles: refreshedUserRoles
          };
        }

        // Set user context for logging and tracing
        setUserContext(newPayload.userId, newPayload.userLevel);

        // Clear failure counter on successful auth
        const identifier = `ip:${req.ip}`;
        await progressiveAuthLimiter.recordSuccess(identifier);

        next();
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
