/** @format */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authService } from '../services/auth';

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
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    // If no token in header, try to get from httpOnly cookie
    if (!token) {
      token = req.cookies?.accessToken;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        code: -1001,
        message: 'Unauthorized - no token provided'
      });
      return;
    }

    // Verify token
    const payload = await authService.validateToken(token);
    if (!payload) {
      res.status(403).json({
        success: false,
        code: -1002,
        message: 'Unauthorized - invalid token'
      });
      return;
    }

    req.user = payload;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);

    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        code: -1003,
        message: 'Unauthorized - token expired'
      });
      return;
    }

    res.status(500).json({
      success: false,
      code: -1000,
      message: 'Authentication error'
    });
  }
}
