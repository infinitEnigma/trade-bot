/** @format */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authService } from "../services/auth";
import { redisService } from "../infrastructure/cache/redis.service";
import { setUserContext } from "../utils/context";
import { roleManagementService } from "../services/role-management";
import logger from "../services/logger";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    userLevel: string;
    roles: string[];
  };
}

// Exponential backoff retry for token refresh with Redis mutex
async function retryTokenRefresh(refreshToken: string, req: AuthenticatedRequest, maxRetries = 3): Promise<any> {
  let lastError: any = null;
  let userId: string | undefined;

  // Extract userId from the token for mutex key
  try {
    const decoded = jwt.decode(refreshToken) as any;
    userId = decoded?.userId;
  } catch (e) {
    logger.warn("Could not decode refresh token for mutex", {
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
        logger.debug("Token refresh mutex already held, waiting", {
          userId,
          mutexKey,
        });

        // Wait a bit and try once more
        await new Promise(resolve => setTimeout(resolve, 100));

        const retryLockResult = await redisService.getClient().set(mutexKey, "1", {
          NX: true,
          EX: 30,
        });
        lockAcquired = retryLockResult === "OK";

        if (!lockAcquired) {
          logger.debug("Token refresh mutex still held, queuing request", {
            userId,
            mutexKey,
          });
          // Return early - another request is already refreshing
          return {
            success: false,
            message: "Token refresh already in progress",
          };
        }
      }
    } catch (lockError) {
      logger.warn("Failed to acquire token refresh mutex", {
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
        logger.debug(`Token refresh attempt ${attempt + 1}/${maxRetries}`, {
          userId,
          lockAcquired,
        });

        const result = await authService.refreshToken(refreshToken);

        if (result.success && result.tokens) {
          logger.info(`Token refresh succeeded on attempt ${attempt + 1}`, {
            userId: result.user?.id,
            lockAcquired,
          });
          return result;
        }

        // If it's a validation error, don't retry
        if (result.message?.includes('invalid') || result.message?.includes('expired') || result.message?.includes('invalidated')) {
          logger.debug("Token validation error, not retrying", {
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
          logger.debug(`Waiting ${delay}ms before retry`, {
            attempt: attempt + 1,
            userId,
            lockAcquired,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error) {
        lastError = error;
        logger.warn(`Token refresh attempt ${attempt + 1} failed`, {
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
    logger.error("All token refresh attempts failed", {
      attempts: maxRetries,
      lastError: lastError instanceof Error ? lastError.message : String(lastError),
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
        logger.debug("Released token refresh mutex", {
          userId,
          mutexKey,
        });
      } catch (unlockError) {
        logger.warn("Failed to release token refresh mutex", {
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
    // Get token from Authorization header or httpOnly cookie
    const authHeader = req.headers["authorization"];
    let token = authHeader && authHeader.split(" ")[1];

    // If no token in header, try to get from httpOnly cookie
    if (!token) {
      token = req.cookies?.accessToken;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        code: -1001,
        message: "Unauthorized - no token provided",
      });
      return;
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

    // Load complete user data with roles and credentials in single query (N+1 optimization)
    const userData = await authService.getAuthenticatedUserData(payload.userId);
    if (!userData) {
      logger.error("Failed to load user data in auth middleware - user not found", {
        userId: payload.userId,
      });
      res.status(401).json({
        success: false,
        code: -1007,
        message: "Unauthorized - user data not found",
      });
      return;
    }

    const userRoles = userData.roles;

    req.user = {
      ...payload,
      roles: userRoles
    };

    // Set user context for logging and tracing
    setUserContext(payload.userId, payload.userLevel);

    next();
  } catch (error) {
    logger.error("Auth middleware error", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Handle token expiration - attempt automatic refresh
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug("Access token expired, attempting automatic refresh");

      try {
        // Get refresh token from httpOnly cookie
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
          logger.debug("No refresh token available");
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
          logger.error("Token refresh failed after retries", {
            message: refreshResult.message,
            userId: req.user?.userId,
          });
          res.status(401).json({
            success: false,
            code: -1004,
            message: "Unauthorized - token refresh failed after multiple attempts",
          });
          return;
        }

        logger.info("Token automatically refreshed", {
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

        // Verify the new access token and set user on request
        const newPayload = await authService.validateToken(
          refreshResult.tokens.accessToken
        );
        if (!newPayload) {
          logger.error("New access token validation failed after refresh");
          res.status(500).json({
            success: false,
            code: -1005,
            message: "Token refresh succeeded but validation failed",
          });
          return;
        }

        // Load complete user data for refreshed token (N+1 optimization)
        const refreshedUserData = await authService.getAuthenticatedUserData(newPayload.userId);
        if (!refreshedUserData) {
          logger.error("Failed to load refreshed user data - user not found", {
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
          roles: refreshedUserRoles
        };
        next();
      } catch (refreshError) {
        logger.error("Token refresh process failed", {
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
