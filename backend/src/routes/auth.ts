/** @format */

import { Router, Request, Response } from "express";
import Joi from "joi";
import { authService } from "../services/auth";
import { RateLimiters } from "../services/rate-limiter";
import logger from "../services/logger";

const router = Router();

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(128).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(128).required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

// POST /api/auth/register
router.post("/register", RateLimiters.auth, async (req: Request, res: Response) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, error: error.details[0].message });
    }

    const result = await authService.register(value.email, value.password);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    // Set httpOnly cookies for security
    res.cookie('accessToken', result.tokens!.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 4 * 60 * 60 * 1000, // 4 hours
    });

    res.cookie('refreshToken', result.tokens!.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
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
    res.status(500).json({ success: false, error: "Registration failed" });
  }
});

// POST /api/auth/login
router.post("/login", RateLimiters.auth, async (req: Request, res: Response) => {
  logger.info("Login attempt", { email: req.body?.email });
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      logger.warn("Login validation error", {
        email: req.body?.email,
        error: error.details[0].message,
      });
      return res
        .status(400)
        .json({ success: false, error: error.details[0].message });
    }

    const result = await authService.login(value.email, value.password);
    logger.info("Login result", {
      email: value.email,
      success: result.success,
      message: result.success ? "success" : result.message,
    });

    if (!result.success) {
      return res.status(401).json({ success: false, error: result.message });
    }

    logger.info("Login successful", {
      email: result.user?.email,
      userId: result.user?.id,
    });

    // Set httpOnly cookies for security
    res.cookie('accessToken', result.tokens!.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 4 * 60 * 60 * 1000, // 4 hours
    });

    res.cookie('refreshToken', result.tokens!.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
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
    res.status(500).json({ success: false, error: "Login failed" });
  }
});

// POST /api/auth/refresh
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { error, value } = refreshSchema.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, error: error.details[0].message });
    }

    const result = await authService.refreshToken(value.refreshToken);

    if (!result.success) {
      return res.status(401).json({ success: false, error: result.message });
    }

    // Set httpOnly cookies for security
    res.cookie('accessToken', result.tokens!.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 4 * 60 * 60 * 1000, // 4 hours
    });

    res.cookie('refreshToken', result.tokens!.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
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
    res.status(500).json({ success: false, error: "Token refresh failed" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req: Request, res: Response) => {
  try {
    // Clear httpOnly cookies
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    logger.error("Logout error", {
      error: (err as Error).message,
    });
    res.status(500).json({ success: false, error: "Logout failed" });
  }
});

export { router as authRoutes };
