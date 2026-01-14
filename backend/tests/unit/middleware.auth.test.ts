/** @format */

import { authMiddleware, AuthenticatedRequest } from '../../src/middleware/auth';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Mock the authService
jest.mock('../../src/services/auth', () => ({
  authService: {
    validateToken: jest.fn(),
  },
}));

import { authService } from '../../src/services/auth';

describe('Auth Middleware', () => {
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

    // Reset all mocks before each test
    jest.clearAllMocks();
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

  it('should accept valid token in cookie', async () => {
    const testUser = { userId: 'test-user-id', email: 'test@example.com' };
    const token = jwt.sign(testUser, process.env.JWT_SECRET || 'test-secret');

    (req as any).cookies.accessToken = token;

    // Mock successful token validation
    (authService.validateToken as jest.Mock).mockResolvedValue(testUser);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith(token);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual(testUser);
  });

  it('should accept valid token in Authorization header', async () => {
    const testUser = { userId: 'test-user-id', email: 'test@example.com' };
    const token = jwt.sign(testUser, process.env.JWT_SECRET || 'test-secret');

    req.headers = { authorization: `Bearer ${token}` };
    (req as any).cookies = {}; // No cookie

    // Mock successful token validation
    (authService.validateToken as jest.Mock).mockResolvedValue(testUser);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith(token);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual(testUser);
  });

  it('should prioritize Authorization header over cookie', async () => {
    const headerUser = { userId: 'header-user', email: 'header@example.com' };

    const headerToken = jwt.sign(headerUser, process.env.JWT_SECRET || 'test-secret');

    (req as any).cookies.accessToken = 'some-cookie-token';
    req.headers = { authorization: `Bearer ${headerToken}` };

    // Mock successful token validation for header token
    (authService.validateToken as jest.Mock).mockResolvedValue(headerUser);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith(headerToken);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual(headerUser); // Header should win
  });

  it('should reject expired token', async () => {
    const expiredToken = jwt.sign(
      { userId: 'test-user', email: 'test@example.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '-1h' } // Already expired
    );

    (req as any).cookies.accessToken = expiredToken;

    // Mock failed token validation (expired token)
    (authService.validateToken as jest.Mock).mockResolvedValue(null);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith(expiredToken);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: 'Unauthorized - invalid token'
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject invalid token', async () => {
    (req as any).cookies.accessToken = 'invalid-token';

    // Mock failed token validation
    (authService.validateToken as jest.Mock).mockResolvedValue(null);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith('invalid-token');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: 'Unauthorized - invalid token'
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject token with wrong secret', async () => {
    const token = jwt.sign(
      { userId: 'test-user', email: 'test@example.com' },
      'wrong-secret'
    );

    (req as any).cookies.accessToken = token;

    // Mock failed token validation
    (authService.validateToken as jest.Mock).mockResolvedValue(null);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith(token);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: 'Unauthorized - invalid token'
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should handle auth service errors gracefully', async () => {
    (req as any).cookies.accessToken = 'some-token';

    // Mock authService to throw an error
    (authService.validateToken as jest.Mock).mockRejectedValue(new Error('Database error'));

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith('some-token');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1000,
      message: 'Authentication error'
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should set user object with correct properties', async () => {
    const testUser = {
      userId: 'user-123',
      email: 'user@example.com',
      userLevel: 'REGISTERED'
    };
    const token = jwt.sign(testUser, process.env.JWT_SECRET || 'test-secret');

    (req as any).cookies.accessToken = token;

    // Mock successful token validation
    (authService.validateToken as jest.Mock).mockResolvedValue(testUser);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.validateToken).toHaveBeenCalledWith(token);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual(testUser);
    expect((req as AuthenticatedRequest).user!.userId).toBe('user-123');
    expect((req as AuthenticatedRequest).user!.email).toBe('user@example.com');
    expect((req as AuthenticatedRequest).user!.userLevel).toBe('REGISTERED');
  });
});
