/** @format */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authService } from "../services/auth";
import { setUserContext } from "../utils/context";
import logger from "../services/logger";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    userLevel: string;
  };
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

    req.user = payload;

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

        // Attempt to refresh the token
        const refreshResult = await authService.refreshToken(refreshToken);
        if (!refreshResult.success || !refreshResult.tokens) {
          logger.debug("Token refresh failed", {
            message: refreshResult.message,
          });
          res.status(401).json({
            success: false,
            code: -1004,
            message: "Unauthorized - token refresh failed",
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

        req.user = newPayload;
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
