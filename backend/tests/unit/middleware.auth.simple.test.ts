/** @format */

import { authMiddleware, AuthenticatedRequest } from '../../src/interfaces/middleware';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Simple test that just verifies the middleware structure
describe('Auth Middleware - Simple Tests', () => {
    let req: Partial<AuthenticatedRequest>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        req = { cookies: {}, headers: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

    it('should be a function', () => {
        expect(typeof authMiddleware).toBe('function');
    });

    it('should reject requests without token', () => {
        authMiddleware(req as Request, res as Response, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            code: -1001,
            message: 'Unauthorized - no token provided'
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('should reject requests with empty token', () => {
        (req as any).cookies.accessToken = '';
        authMiddleware(req as Request, res as Response, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            code: -1001,
            message: 'Unauthorized - no token provided'
        });
        expect(next).not.toHaveBeenCalled();
    });
});