/** @format */

import { Router, Request, Response } from "express";
//import Joi from "joi";
import { serviceProvider } from "../../../core/service-provider";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth.middleware";
import { UserRole, UserLevel } from "@trade-bot/shared";
import { createErrorResponse, ValidationError } from "@trade-bot/shared";
import { getCorrelationId } from "../../../shared/utils/context";
import { validators } from "../../middleware/validation.middleware";
import { authLogger } from "../../../core/logging";
import { progressiveAuthLimiter } from "../../../infrastructure/security/rate-limiter.service";
import { query } from "../../../database/pool";

// Select service implementation based on feature flags
const authService = serviceProvider.getAuthService();

const router = Router();

// POST /api/auth/register
router.post(
  "/register",
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
      if (!result.tokens) {
        authLogger.error("Registration successful but tokens missing");
        const internalError = new ValidationError("Registration successful but tokens missing");
        return res.status(internalError.statusCode).json(
          createErrorResponse(internalError, getCorrelationId())
        );
      }

      res.cookie("accessToken", result.tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 4 * 60 * 60 * 1000, // 4 hours
      });

      res.cookie("refreshToken", result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.status(201).json({
        success: true,
        data: { user: result.user },
      });
    } catch (err) {
      authLogger.error("Registration error", err instanceof Error ? err : undefined, {
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
  validators.login,
  async (req: Request, res: Response) => {
    authLogger.info("Login attempt", { email: req.body?.email });
    try {
      const result = await authService.login({ email: req.body.email, password: req.body.password });
      authLogger.info("Login result", {
        email: req.body.email,
        success: result.success,
        message: result.success ? "success" : result.message,
      });

      if (!result.success) {
        const authError = new ValidationError(result.message || "Invalid credentials");

        // Record failed login attempt for progressive backoff
        // This will be handled by the rate limiter middleware automatically
        // when progressiveBackoff is enabled for auth endpoints

        return res.status(authError.statusCode).json(
          createErrorResponse(authError, getCorrelationId())
        );
      }

      authLogger.info("Login successful", {
        email: result.user?.email,
        userId: result.user?.id,
      });

      // Clear failure counter on successful auth
      const identifier = `ip:${req.ip}`;
      await progressiveAuthLimiter.recordSuccess(identifier);

      // Set httpOnly cookies for security
      if (!result.tokens) {
        authLogger.error("Login successful but tokens missing");
        const internalError = new ValidationError("Login successful but tokens missing");
        return res.status(internalError.statusCode).json(
          createErrorResponse(internalError, getCorrelationId())
        );
      }

      // Check if user is VERIFIED and automatically check admin qualification
      if (result.user?.userLevel === UserLevel.VERIFIED) {
        try {
          const roleQualificationService = serviceProvider.getRoleQualificationService();
          const adminQualification = await roleQualificationService.checkQualification(
            result.user.id,
            UserRole.SYSTEM_ADMIN
          );

          if (adminQualification.qualified) {
            const roleManagementService = serviceProvider.getRoleManagementService();
            await roleManagementService.assignRole(
              result.user.id,
              UserRole.SYSTEM_ADMIN,
              'system',
              adminQualification.criteria as unknown as JSON
            );

            authLogger.info("User automatically qualified for SYSTEM_ADMIN role on login", {
              userId: result.user.id,
            });
          }
        } catch (error) {
          authLogger.warn("Failed to automatically check admin qualification on login", {
            userId: result.user?.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      res.cookie("accessToken", result.tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 4 * 60 * 60 * 1000, // 4 hours
      });

      res.cookie("refreshToken", result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json({
        success: true,
        data: { user: result.user },
      });
    } catch (err) {
      authLogger.error("Login error", err instanceof Error ? err : undefined, {
        email: req.body?.email,
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
      if (!result.tokens) {
        authLogger.error("Token refresh successful but tokens missing");
        const internalError = new ValidationError("Token refresh successful but tokens missing");
        return res.status(internalError.statusCode).json(
          createErrorResponse(internalError, getCorrelationId())
        );
      }

      res.cookie("accessToken", result.tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 4 * 60 * 60 * 1000, // 4 hours
      });

      res.cookie("refreshToken", result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json({
        success: true,
        data: { user: result.user },
      });
    } catch (err) {
      authLogger.error("Token refresh error", err instanceof Error ? err : undefined);
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

    // TODO: Implement token blacklisting in pure auth service
    // For now, we rely on token expiration for security
    // This provides basic logout functionality while maintaining security through short token lifetimes
    if (refreshToken) {
      authLogger.info("Logout requested - tokens will expire naturally", {
        hasRefreshToken: true,
      });
    }

    // Clear httpOnly cookies to remove tokens from client
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

    // Clear CSRF tokens as well for complete session cleanup
    res.clearCookie("csrfToken", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.clearCookie("csrfSecret", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    authLogger.info("User logged out successfully", {
      userId: (req as AuthenticatedRequest)?.user?.userId,
    });

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    authLogger.error("Logout error", err instanceof Error ? err : undefined);
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
      // Defensive check - user should be set by authMiddleware
      if (!req.user) {
        authLogger.warn("Qualification check requested without authenticated user");
        return res.status(401).json({
          success: false,
          error: "Unauthorized - user not authenticated",
        });
      }

      const userId = req.user.userId;
      const userLevel = req.user.userLevel;

      // Only VERIFIED users can check qualifications
      if (userLevel !== UserLevel.VERIFIED) {
        const authError = new ValidationError("Must be VERIFIED to check qualifications");
        return res.status(authError.statusCode).json(
          createErrorResponse(authError, getCorrelationId())
        );
      }

      // Check qualification for QUALIFIED_ALPHA role
      const walletQualificationService = serviceProvider.getWalletQualificationService();
      const result = await walletQualificationService.checkAlphaQualification(userId);

      if (result.qualified) {
        // Assign QUALIFIED_ALPHA role
        const roleManagementService = serviceProvider.getRoleManagementService();
        await roleManagementService.assignRole(
          userId,
          UserRole.QUALIFIED_ALPHA,
          'system',
          result.criteria as unknown as JSON
        );

        authLogger.info("User qualified for QUALIFIED_ALPHA role", {
          userId,
          qualificationCriteria: result.criteria
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
      authLogger.error("Qualification check error", error instanceof Error ? error : undefined, {
        userId: req.user?.userId,
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
      // Defensive check - user should be set by authMiddleware
      if (!req.user) {
        authLogger.warn("Qualification config requested without authenticated user");
        return res.status(401).json({
          success: false,
          error: "Unauthorized - user not authenticated",
        });
      }

      const walletQualificationService = serviceProvider.getWalletQualificationService();
      const config = walletQualificationService.getQualificationConfig();
      res.json({
        success: true,
        config
      });
    } catch (error) {
      authLogger.error("Qualification config error", error instanceof Error ? error : undefined, {
        userId: req.user?.userId
      });
      const internalError = new ValidationError("Failed to get qualification config");
      res.status(internalError.statusCode).json(
        createErrorResponse(internalError, getCorrelationId())
      );
    }
  }
);

// GET /api/auth/me
router.get(
  "/me",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Defensive check - user should be set by authMiddleware
      if (!req.user) {
        authLogger.warn("/me endpoint accessed without authenticated user");
        return res.status(401).json({
          success: false,
          error: "Unauthorized - user not authenticated",
        });
      }

      // Get complete user data including timestamps
      const result = await query<{
        id: string;
        email: string;
        user_level: string;
        created_at: Date;
        updated_at: Date;
      }>(
        "SELECT id, email, user_level, created_at, updated_at FROM users WHERE id = $1",
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        const error = new ValidationError("User not found");
        return res.status(error.statusCode).json(
          createErrorResponse(error, getCorrelationId())
        );
      }

      const userRow = result.rows[0];

      // Get user roles
      const rolesResult = await query<{ role: string }>(
        "SELECT role FROM user_roles WHERE user_id = $1",
        [req.user.userId]
      );

      const roles = rolesResult.rows.map(row => row.role);

      const user = {
        id: userRow.id,
        email: userRow.email,
        userLevel: userRow.user_level,
        roles,
        createdAt: new Date(userRow.created_at),
        updatedAt: new Date(userRow.updated_at),
      };

      authLogger.info("Returning user data from /me endpoint", {
        userId: user.id,
        userLevel: user.userLevel,
        email: user.email,
        rolesCount: roles.length,
      });

      // Prevent caching of user-specific data
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      authLogger.error("Get me error", error instanceof Error ? error : undefined, {
        userId: req.user?.userId,
      });
      const internalError = new ValidationError("Failed to get user data");
      res.status(internalError.statusCode).json(
        createErrorResponse(internalError, getCorrelationId())
      );
    }
  }
);

// POST /api/auth/check-admin-qualification
router.post(
  "/check-admin-qualification",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Defensive check - user should be set by authMiddleware
      if (!req.user) {
        authLogger.warn("Admin qualification check requested without authenticated user");
        return res.status(401).json({
          success: false,
          error: "Unauthorized - user not authenticated",
        });
      }

      const userId = req.user.userId;
      const userLevel = req.user.userLevel;

      // Only VERIFIED users can check admin qualifications
      if (userLevel !== UserLevel.VERIFIED) {
        const authError = new ValidationError("Must be VERIFIED to check admin qualifications");
        return res.status(authError.statusCode).json(
          createErrorResponse(authError, getCorrelationId())
        );
      }

      // Check qualification for SYSTEM_ADMIN role
      const roleQualificationService = serviceProvider.getRoleQualificationService();
      const result = await roleQualificationService.checkQualification(userId, UserRole.SYSTEM_ADMIN);

      if (result.qualified) {
        // Assign SYSTEM_ADMIN role
        const roleManagementService = serviceProvider.getRoleManagementService();
        await roleManagementService.assignRole(
          userId,
          UserRole.SYSTEM_ADMIN,
          'system',
          result.criteria as unknown as JSON
        );

        authLogger.info("User qualified for SYSTEM_ADMIN role", {
          userId,
          qualificationCriteria: result.criteria
        });
      }

      res.json({
        success: true,
        qualified: result.qualified,
        criteria: result.criteria,
        reason: result.reason
      });

    } catch (error) {
      authLogger.error("Admin qualification check error", error instanceof Error ? error : undefined, {
        userId: req.user?.userId,
      });
      const internalError = new ValidationError("Admin qualification check failed");
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
          authLogger.debug("Using existing valid CSRF token");
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

        authLogger.debug("Generated new CSRF token");
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

      authLogger.debug("Generated fresh CSRF token");
    }

    res.json({
      success: true,
      csrfToken: token,
      expiresIn: 24 * 60 * 60, // 24 hours in seconds
    });

  } catch (error) {
    authLogger.error("CSRF token retrieval error", error instanceof Error ? error : undefined);
    const internalError = new ValidationError("Failed to get CSRF token");
    res.status(internalError.statusCode).json(
      createErrorResponse(internalError, getCorrelationId())
    );
  }
});

export { router as authRoutes };