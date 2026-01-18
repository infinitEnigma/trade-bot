/** @format */

import { Router, Request, Response } from "express";
import Joi from "joi";
import { authService } from "../services/auth";
import { walletQualificationService } from "../services/wallet-qualification";
import { roleManagementService } from "../services/role-management";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { UserRole, UserLevel } from "@trade-bot/shared";
import { RateLimiters } from "../services/rate-limiter";
import { createErrorResponse, ValidationError } from "../types/errors";
import { getCorrelationId } from "../utils/context";
import { validators } from "../middleware/validation";
import logger from "../services/logger";

const router = Router();

// POST /api/auth/register
router.post(
  "/register",
  RateLimiters.auth,
  validators.register,
  async (req: Request, res: Response) => {
    try {
      const result = await authService.register(req.body.email, req.body.password);

      if (!result.success) {
        const authError = new ValidationError(result.message || "Registration failed");
        return res.status(authError.statusCode).json(
          createErrorResponse(authError, getCorrelationId())
        );
      }

      // Set httpOnly cookies for security
      res.cookie("accessToken", result.tokens!.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 4 * 60 * 60 * 1000, // 4 hours
      });

      res.cookie("refreshToken", result.tokens!.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.status(201).json({
        success: true,
        user: result.user,
      });
    } catch (err) {
      logger.error("Registration error", {
        error: (err as Error).message,
        email: req.body?.email,
      });
      const internalError = new ValidationError("Registration failed");
      res.status(internalError.statusCode).json(
        createErrorResponse(internalError, getCorrelationId())
      );
    }
  }
);

// POST /api/auth/login
router.post(
  "/login",
  RateLimiters.auth,
  validators.login,
  async (req: Request, res: Response) => {
    logger.info("Login attempt", { email: req.body?.email });
    try {
      const result = await authService.login(req.body.email, req.body.password);
      logger.info("Login result", {
        email: req.body.email,
        success: result.success,
        message: result.success ? "success" : result.message,
      });

      if (!result.success) {
        const authError = new ValidationError(result.message || "Invalid credentials");
        return res.status(authError.statusCode).json(
          createErrorResponse(authError, getCorrelationId())
        );
      }

      logger.info("Login successful", {
        email: result.user?.email,
        userId: result.user?.id,
      });

      // Set httpOnly cookies for security
      res.cookie("accessToken", result.tokens!.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 4 * 60 * 60 * 1000, // 4 hours
      });

      res.cookie("refreshToken", result.tokens!.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json({
        success: true,
        user: result.user,
      });
    } catch (err) {
      logger.error("Login error", {
        email: req.body?.email,
        error: (err as Error).message,
      });
      const internalError = new ValidationError("Login failed");
      res.status(internalError.statusCode).json(
        createErrorResponse(internalError, getCorrelationId())
      );
    }
  }
);

// POST /api/auth/refresh
router.post(
  "/refresh",
  validators.refreshToken,
  async (req: Request, res: Response) => {
    try {
      const result = await authService.refreshToken(req.body.refreshToken);

      if (!result.success) {
        const authError = new ValidationError(result.message || "Invalid refresh token");
        return res.status(authError.statusCode).json(
          createErrorResponse(authError, getCorrelationId())
        );
      }

      // Set httpOnly cookies for security
      res.cookie("accessToken", result.tokens!.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 4 * 60 * 60 * 1000, // 4 hours
      });

      res.cookie("refreshToken", result.tokens!.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json({
        success: true,
        user: result.user,
      });
    } catch (err) {
      logger.error("Token refresh error", {
        error: (err as Error).message,
      });
      const internalError = new ValidationError("Token refresh failed");
      res.status(internalError.statusCode).json(
        createErrorResponse(internalError, getCorrelationId())
      );
    }
  }
);

// POST /api/auth/logout
router.post("/logout", async (req: Request, res: Response) => {
  try {
    // Get refresh token from cookie or body
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    // CRITICAL SECURITY: Blacklist the refresh token to prevent reuse
    if (refreshToken) {
      const blacklistSuccess = await authService.blacklistRefreshToken(refreshToken, 86400); // 24 hours
      if (blacklistSuccess) {
        logger.info("Refresh token blacklisted on logout", {
          tokenHash: authService['hashTokenForStorage'](refreshToken),
        });
      } else {
        logger.warn("Failed to blacklist refresh token on logout", {
          tokenHash: authService['hashTokenForStorage'](refreshToken),
        });
      }
    }

    // Clear httpOnly cookies
    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    logger.error("Logout error", {
      error: (err as Error).message,
    });
    const internalError = new ValidationError("Logout failed");
    res.status(internalError.statusCode).json(
      createErrorResponse(internalError, getCorrelationId())
    );
  }
});

// POST /api/auth/check-qualification
router.post(
  "/check-qualification",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userLevel = req.user!.userLevel;

      // Only VERIFIED users can check qualifications
      if (userLevel !== UserLevel.VERIFIED) {
        const authError = new ValidationError("Must be VERIFIED to check qualifications");
        return res.status(authError.statusCode).json(
          createErrorResponse(authError, getCorrelationId())
        );
      }

      // Check qualification for QUALIFIED_ALPHA role
      const result = await walletQualificationService.checkAlphaQualification(userId);

      if (result.qualified) {
        // Assign QUALIFIED_ALPHA role
        await roleManagementService.assignRole(
          userId,
          UserRole.QUALIFIED_ALPHA,
          'system',
          result.criteria
        );

        logger.info("User qualified for QUALIFIED_ALPHA role", {
          userId,
          criteria: result.criteria
        });
      }

      res.json({
        success: true,
        qualified: result.qualified,
        walletConnected: result.walletConnected,
        chainValid: result.chainValid,
        criteria: result.criteria,
        reasons: result.reasons,
        config: walletQualificationService.getQualificationConfig()
      });

    } catch (error) {
      logger.error("Qualification check error", {
        userId: req.user!.userId,
        error: (error as Error).message
      });
      const internalError = new ValidationError("Qualification check failed");
      res.status(internalError.statusCode).json(
        createErrorResponse(internalError, getCorrelationId())
      );
    }
  }
);

// GET /api/auth/qualification-config
router.get(
  "/qualification-config",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const config = walletQualificationService.getQualificationConfig();
      res.json({
        success: true,
        config
      });
    } catch (error) {
      logger.error("Qualification config error", {
        error: (error as Error).message
      });
      const internalError = new ValidationError("Failed to get qualification config");
      res.status(internalError.statusCode).json(
        createErrorResponse(internalError, getCorrelationId())
      );
    }
  }
);

// GET /api/auth/csrf-token
router.get("/csrf-token", async (req: Request, res: Response) => {
  try {
    // Get CSRF token from cookies or generate new one
    const existingToken = req.cookies?.csrfToken;
    const existingSecret = req.cookies?.csrfSecret;

    let token: string;

    if (existingToken && existingSecret) {
      // Validate existing token
      const Tokens = await import("csrf");
      const tokensInstance = new Tokens.default();

      try {
        const isValid = tokensInstance.verify(existingSecret, existingToken);
        if (isValid) {
          token = existingToken;
          logger.debug("Using existing valid CSRF token");
        } else {
          throw new Error("Invalid existing token");
        }
      } catch {
        // Generate new token if existing is invalid
        const secret = tokensInstance.secretSync();
        token = tokensInstance.create(secret);

        // Update cookies with new secret/token
        res.cookie('csrfSecret', secret, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        res.cookie('csrfToken', token, {
          httpOnly: false, // Client needs to read this
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        logger.debug("Generated new CSRF token");
      }
    } else {
      // Generate new token
      const Tokens = await import("csrf");
      const tokensInstance = new Tokens.default();
      const secret = tokensInstance.secretSync();
      token = tokensInstance.create(secret);

      // Set cookies
      res.cookie('csrfSecret', secret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      res.cookie('csrfToken', token, {
        httpOnly: false, // Client needs to read this
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      logger.debug("Generated fresh CSRF token");
    }

    res.json({
      success: true,
      csrfToken: token,
      expiresIn: 24 * 60 * 60, // 24 hours in seconds
    });

  } catch (error) {
    logger.error("CSRF token retrieval error", {
      error: (error as Error).message,
    });
    const internalError = new ValidationError("Failed to get CSRF token");
    res.status(internalError.statusCode).json(
      createErrorResponse(internalError, getCorrelationId())
    );
  }
});

export { router as authRoutes };
