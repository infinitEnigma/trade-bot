/** @format */

import { authMiddleware, AuthenticatedRequest } from '../../src/middleware/auth';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Mock the authService
jest.mock('../../src/services/auth', () => ({
  authService: {
    validateToken: jest.fn(),
    refreshToken: jest.fn(),
  },
}));

// Mock Redis service
jest.mock('../../src/services/redis', () => ({
  redisService: {
    getClient: jest.fn(() => ({
      set: jest.fn(),
    })),
    del: jest.fn(),
  },
}));

import { authService } from '../../src/services/auth';
import { redisService } from '../../src/services/redis';

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
    expect((req as AuthenticatedRequest).user).toEqual({ ...testUser, roles: [] });
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
    expect((req as AuthenticatedRequest).user).toEqual({ ...testUser, roles: [] });
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
    expect((req as AuthenticatedRequest).user).toEqual({ ...headerUser, roles: [] }); // Header should win
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
    expect((req as AuthenticatedRequest).user).toEqual({ ...testUser, roles: [] });
    expect((req as AuthenticatedRequest).user!.userId).toBe('user-123');
    expect((req as AuthenticatedRequest).user!.email).toBe('user@example.com');
    expect((req as AuthenticatedRequest).user!.userLevel).toBe('REGISTERED');
  });

  it('should handle token refresh retry logic', async () => {
    const expiredToken = jwt.sign(
      { userId: 'test-user', email: 'test@example.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '-1h' }
    );

    (req as any).cookies.accessToken = expiredToken;
    (req as any).cookies.refreshToken = 'valid-refresh-token';

    // Mock token validation to throw TokenExpiredError (triggers refresh)
    (authService.validateToken as jest.Mock).mockRejectedValue(new jwt.TokenExpiredError('Token expired', new Date()));

    // Mock successful refresh on first attempt
    (authService.refreshToken as jest.Mock).mockResolvedValue({
      success: true,
      tokens: {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 14400,
      },
      user: { id: 'test-user', email: 'test@example.com', userLevel: 'BASIC' },
    });

    // Mock Redis client for mutex
    const mockRedisClient = {
      set: jest.fn().mockResolvedValue('OK'),
    };
    (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);
    (redisService.del as jest.Mock).mockResolvedValue({ success: true });

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.refreshToken).toHaveBeenCalledWith('valid-refresh-token');
    expect(next).toHaveBeenCalled();
  });

  it('should handle token refresh failure after retries', async () => {
    const expiredToken = jwt.sign(
      { userId: 'test-user', email: 'test@example.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '-1h' }
    );

    (req as any).cookies.accessToken = expiredToken;
    (req as any).cookies.refreshToken = 'invalid-refresh-token';

    // Mock token validation to throw TokenExpiredError (triggers refresh)
    (authService.validateToken as jest.Mock).mockRejectedValue(new jwt.TokenExpiredError('Token expired', new Date()));

    // Mock refresh to always fail
    (authService.refreshToken as jest.Mock).mockResolvedValue({
      success: false,
      message: 'Invalid refresh token',
    });

    // Mock Redis client for mutex
    const mockRedisClient = {
      set: jest.fn().mockResolvedValue('OK'),
    };
    (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);
    (redisService.del as jest.Mock).mockResolvedValue({ success: true });

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.refreshToken).toHaveBeenCalledWith('invalid-refresh-token');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1004,
      message: 'Unauthorized - token refresh failed after multiple attempts',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should handle simultaneous refresh mutex', async () => {
    const expiredToken = jwt.sign(
      { userId: 'test-user', email: 'test@example.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '-1h' }
    );

    (req as any).cookies.accessToken = expiredToken;
    (req as any).cookies.refreshToken = 'refresh-token';

    // Mock token validation to throw TokenExpiredError (triggers refresh)
    (authService.validateToken as jest.Mock).mockRejectedValue(new jwt.TokenExpiredError('Token expired', new Date()));

    // Mock Redis client to simulate mutex already held
    const mockRedisClient = {
      set: jest.fn().mockResolvedValue(null), // SET NX failed - mutex already held
    };
    (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);

    await authMiddleware(req as Request, res as Response, next);

    expect(authService.refreshToken).not.toHaveBeenCalled(); // Should not attempt refresh due to mutex
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1004,
      message: 'Unauthorized - token refresh failed after multiple attempts',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
