/** @format */

import { Request, Response, NextFunction } from "express";
import Tokens from "csrf";
import { securityLogger as logger } from "../../core/logging/context-aware-logger.service";

// Initialize CSRF tokens
const tokens = new Tokens();

export interface CSRFRequest extends Request {
    csrfToken?: () => string;
}

// CSRF middleware for protecting state-changing operations
export function csrfMiddleware(req: CSRFRequest, res: Response, next: NextFunction): void {
    try {
        // Skip CSRF protection for safe methods
        const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
        if (safeMethods.includes(req.method)) {
            return next();
        }

        // Get CSRF token from various sources
        let token = req.headers['x-csrf-token'] as string ||
            req.headers['csrf-token'] as string ||
            req.body?._csrf ||
            req.query._csrf as string;

        // Also check for token in cookies (less secure but supported)
        if (!token) {
            token = req.cookies?.csrfToken;
        }

        if (!token) {
            logger.warn("CSRF token missing", {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
            });
            res.status(403).json({
                success: false,
                code: -2001,
                message: "CSRF token required for this operation",
            });
            return;
        }

        // Get the secret from cookies (set during login/refresh)
        const secret = req.cookies?.csrfSecret;
        if (!secret) {
            logger.warn("CSRF secret missing from cookies", {
                method: req.method,
                path: req.path,
                ip: req.ip,
            });
            res.status(403).json({
                success: false,
                code: -2002,
                message: "CSRF secret not found - please re-authenticate",
            });
            return;
        }

        // Verify the token
        const isValid = tokens.verify(secret, token);
        if (!isValid) {
            logger.warn("CSRF token verification failed", {
                method: req.method,
                path: req.path,
                ip: req.ip,
                tokenProvided: !!token,
                secretProvided: !!secret,
            });
            res.status(403).json({
                success: false,
                code: -2003,
                message: "Invalid CSRF token",
            });
            return;
        }

        // Token is valid, proceed
        logger.debug("CSRF token verified successfully", {
            method: req.method,
            path: req.path,
        });

        next();
    } catch (error) {
        logger.error("CSRF middleware error", error as Error, {
            method: req.method,
            path: req.path,
        });
        res.status(500).json({
            success: false,
            code: -2000,
            message: "CSRF validation error",
        });
    }
}

// Middleware to set CSRF token and secret in response
export function csrfTokenMiddleware(req: CSRFRequest, res: Response, next: NextFunction): void {
    try {
        // Generate a new secret for this session
        const secret = tokens.secretSync();

        // Set the secret in httpOnly cookie
        res.cookie('csrfSecret', secret, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        // Create a token for the client
        const token = tokens.create(secret);

        // Set token in non-httpOnly cookie for client access
        res.cookie('csrfToken', token, {
            httpOnly: false, // Client needs to read this
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        // Also attach to response for API convenience
        res.locals.csrfToken = token;

        // Add method to request for convenience
        req.csrfToken = () => token;

        next();
    } catch (error) {
        logger.error("CSRF token generation error", error as Error);
        res.status(500).json({
            success: false,
            code: -2004,
            message: "Failed to generate CSRF token",
        });
    }
}

// Utility function to get CSRF token for responses
export function getCsrfToken(req: CSRFRequest): string | null {
    if (req.csrfToken) {
        return req.csrfToken();
    }

    // Fallback to getting from cookies
    const secret = req.cookies?.csrfSecret;
    if (secret) {
        return tokens.create(secret);
    }

    return null;
}
