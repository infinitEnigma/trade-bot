/** @format */

// Mock all dependencies before importing the module under test
const mockAuthService = {
  validateToken: jest.fn(),
  getUserById: jest.fn(),
  getAuthenticatedUserData: jest.fn(),
  refreshToken: jest.fn(),
};

// Mock the auth service instance
jest.mock("../../src/core/auth/auth.service.pure", () => ({
  AuthService: jest.fn().mockImplementation(() => ({
    validateToken: jest.fn(),
    getUserById: jest.fn(),
    getAuthenticatedUserData: jest.fn(),
    refreshToken: jest.fn(),
  })),
}));

// Mock the DI container so the middleware resolves the mock auth service
jest.mock("../../src/infrastructure/dependency-injection.container", () => ({
  diContainer: {
    authService: mockAuthService,
  },
}));

import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../src/interfaces/middleware";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authLogger } from "../../src/core/logging";

// Mock Redis service
jest.mock("../../src/infrastructure/cache/redis.service", () => ({
  redisService: {
    getClient: jest.fn(() => ({
      set: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
      setNX: jest.fn().mockResolvedValue(true), // For mutex operations
    })),
    del: jest.fn().mockResolvedValue({ success: true }),
    atomicReadModifyWrite: jest.fn(),
    cleanupForTests: jest.fn(), // Add cleanup method
  },
}));

// Mock progressive auth limiter
jest.mock("../../src/infrastructure/security/rate-limiter.service", () => ({
  progressiveAuthLimiter: {
    recordSuccess: jest.fn(),
  },
}));

// Mock context utilities
jest.mock("../../src/shared/utils/context", () => ({
  setUserContext: jest.fn(),
}));

// Mock @noble/ed25519 module to avoid Jest parse errors
jest.mock("@noble/ed25519", () => ({
  sign: jest.fn(),
  verify: jest.fn(),
  getPublicKey: jest.fn(),
  keygen: jest.fn(),
  etc: jest.fn(),
  getPublicKeyAsync: jest.fn(),
  hash: jest.fn(),
  hashes: jest.fn(),
  keygenAsync: jest.fn(),
  Point: jest.fn(),
  signAsync: jest.fn(),
  utils: jest.fn(),
  verifyAsync: jest.fn(),
}));

import { redisService } from "../../src/infrastructure/cache/redis.service";

describe("Auth Middleware", () => {
  let req: Partial<AuthenticatedRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeAll(() => {
    // Set JWT secret for tests
    process.env.JWT_SECRET = "test-jwt-secret-key-for-testing-purposes-only";
    process.env.JWT_REFRESH_SECRET =
      "test-jwt-refresh-secret-key-for-testing-purposes-only";
  });

  beforeEach(() => {
    req = { cookies: {}, headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      // Needed by clearSessionCookies() on definitive refresh failures (-1002)
      clearCookie: jest.fn().mockReturnThis(),
    };
    next = jest.fn();

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it("should reject requests without token", () => {
    authMiddleware(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1001,
      message: "Unauthorized - no token provided",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject requests with empty token", () => {
    (req as any).cookies.accessToken = "";
    authMiddleware(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1001,
      message: "Unauthorized - no token provided",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should accept valid token in cookie", async () => {
    const testUser = { userId: "test-user-id", email: "test@example.com" };
    const token = jwt.sign(testUser, process.env.JWT_SECRET || "test-secret");

    (req as any).cookies.accessToken = token;
    (req as any).path = "/api/user/profile"; // Use a non-lightweight endpoint

    // Mock successful token validation
    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(testUser);
    (mockAuthService.getAuthenticatedUserData as jest.Mock).mockResolvedValue({
      user: {
        id: "test-user-id",
        email: "test@example.com",
        userLevel: "REGISTERED",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      roles: [],
      hasCredentials: false,
    });

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith(token);
    expect(mockAuthService.getAuthenticatedUserData).toHaveBeenCalledWith(
      "test-user-id"
    );
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual({
      ...testUser,
      userLevel: "REGISTERED",
      roles: [],
    });
  });

  it("should accept valid token in Authorization header", async () => {
    const testUser = { userId: "test-user-id", email: "test@example.com" };
    const token = jwt.sign(testUser, process.env.JWT_SECRET || "test-secret");

    req.headers = { authorization: `Bearer ${token}` };
    (req as any).cookies = {}; // No cookie
    (req as any).path = "/api/user/profile"; // Use a non-lightweight endpoint

    // Mock successful token validation
    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(testUser);
    (mockAuthService.getAuthenticatedUserData as jest.Mock).mockResolvedValue({
      user: {
        id: "test-user-id",
        email: "test@example.com",
        userLevel: "REGISTERED",
        roles: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      roles: [],
      hasCredentials: false,
    });

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith(token);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual({
      ...testUser,
      userLevel: "REGISTERED",
      roles: [],
    });
  });

  it("should prioritize Authorization header over cookie", async () => {
    const headerUser = { userId: "header-user", email: "header@example.com" };
    const headerToken = jwt.sign(
      headerUser,
      process.env.JWT_SECRET || "test-secret"
    );

    (req as any).cookies.accessToken = "some-cookie-token";
    req.headers = { authorization: `Bearer ${headerToken}` };
    (req as any).path = "/api/user/profile"; // Use a non-lightweight endpoint

    // Mock successful token validation for header token
    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(headerUser);
    (mockAuthService.getAuthenticatedUserData as jest.Mock).mockResolvedValue({
      user: {
        id: "header-user",
        email: "header@example.com",
        userLevel: "REGISTERED",
        roles: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      roles: [],
      hasCredentials: false,
    });

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith(headerToken);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual({
      ...headerUser,
      userLevel: "REGISTERED",
      roles: [],
    }); // Header should win
  });

  it("should reject expired token", async () => {
    const expiredToken = jwt.sign(
      { userId: "test-user", email: "test@example.com" },
      process.env.JWT_SECRET || "test-secret",
      { expiresIn: "-1h" } // Already expired
    );

    (req as any).cookies.accessToken = expiredToken;

    // Mock failed token validation (expired token)
    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(null);

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith(expiredToken);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: "Unauthorized - invalid token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject invalid token", async () => {
    (req as any).cookies.accessToken = "invalid-token";

    // Mock failed token validation
    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(null);

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith("invalid-token");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: "Unauthorized - invalid token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject token with wrong secret", async () => {
    const token = jwt.sign(
      { userId: "test-user", email: "test@example.com" },
      "wrong-secret"
    );

    (req as any).cookies.accessToken = token;

    // Mock failed token validation
    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(null);

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith(token);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: "Unauthorized - invalid token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should handle auth service errors gracefully", async () => {
    (req as any).cookies.accessToken = "some-token";

    // Mock authService to throw an error
    (mockAuthService.validateToken as jest.Mock).mockRejectedValue(
      new Error("Database error")
    );

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith("some-token");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1000,
      message: "Authentication error",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should set user object with correct properties", async () => {
    const testUser = {
      userId: "user-123",
      email: "user@example.com",
      userLevel: "REGISTERED",
    };
    const token = jwt.sign(testUser, process.env.JWT_SECRET || "test-secret");

    (req as any).cookies.accessToken = token;
    (req as any).path = "/api/user/profile"; // Use a non-lightweight endpoint

    // Mock successful token validation
    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(testUser);
    (mockAuthService.getAuthenticatedUserData as jest.Mock).mockResolvedValue({
      user: {
        id: "user-123",
        email: "user@example.com",
        userLevel: "REGISTERED",
        roles: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      roles: [],
      hasCredentials: false,
    });

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.validateToken).toHaveBeenCalledWith(token);
    expect(next).toHaveBeenCalled();
    expect((req as AuthenticatedRequest).user).toEqual({
      ...testUser,
      userLevel: "REGISTERED",
      roles: [],
    });
    expect((req as AuthenticatedRequest).user!.userId).toBe("user-123");
    expect((req as AuthenticatedRequest).user!.email).toBe("user@example.com");
    expect((req as AuthenticatedRequest).user!.userLevel).toBe("REGISTERED");
  });

  it("should handle token refresh retry logic", async () => {
    const testUser = {
      userId: "user-123",
      email: "user@example.com",
      userLevel: "BASIC",
    };
    const token = jwt.sign(testUser, process.env.JWT_SECRET || "test-secret", {
      expiresIn: "-1h",
    });

    (req as any).cookies.accessToken = token;
    (req as any).cookies.refreshToken = "valid-refresh-token";
    (req as any).path = "/api/user/profile"; // Use a non-lightweight endpoint
    // setRefreshedSessionCookies() needs res.cookie — without it finalize()
    // threw a TypeError before the post-refresh validation, masking the real
    // success path (and leaking the mockResolvedValueOnce queue below).
    (res as any).cookie = jest.fn().mockReturnThis();
    // Mock token validation to throw TokenExpiredError (triggers refresh)
    (mockAuthService.validateToken as jest.Mock)
      .mockRejectedValueOnce(
        new jwt.TokenExpiredError("Token expired", new Date())
      )
      .mockResolvedValueOnce({
        // After refresh, validation succeeds
        userId: "test-user",
        email: "test@example.com",
        userLevel: "BASIC",
      });

    // Mock successful refresh on first attempt
    (mockAuthService.refreshToken as jest.Mock).mockResolvedValue({
      success: true,
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 14400,
      },
      user: { id: "test-user", email: "test@example.com", userLevel: "BASIC" },
    });

    // Mock getUserById for the refreshed token validation
    (mockAuthService.getUserById as jest.Mock).mockResolvedValue({
      id: "test-user",
      email: "test@example.com",
      userLevel: "BASIC",
    });

    // Mock user data loading for refreshed token - this is called after refresh
    (mockAuthService.getAuthenticatedUserData as jest.Mock).mockResolvedValue({
      user: {
        id: "test-user",
        email: "test@example.com",
        userLevel: "BASIC",
        roles: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      roles: [],
      hasCredentials: false,
    });

    // Mock Redis client for mutex - simulate successful mutex acquisition
    const mockRedisClient = {
      set: jest.fn().mockResolvedValue("OK"),
      setNX: jest.fn().mockResolvedValue("OK"), // Mutex acquired successfully
      del: jest.fn().mockResolvedValue(1),
    };
    (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);
    (redisService.del as jest.Mock).mockResolvedValue({ success: true });

    const infoSpy = jest.spyOn(authLogger, "info");

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.refreshToken).toHaveBeenCalledWith(
      "valid-refresh-token"
    );
    expect(mockAuthService.refreshToken).toHaveBeenCalledTimes(1); // Should only be called once on success
    // A successful refresh continues the request chain with the hydrated user
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.userId).toBe("test-user");

    // L6: the refresh log line carries a masked address, never the raw one
    const refreshLog = infoSpy.mock.calls.find(
      call => call[0] === "Token automatically refreshed"
    );
    infoSpy.mockRestore();
    expect(refreshLog).toBeDefined();
    expect(JSON.stringify(refreshLog![1])).not.toContain("test@example.com");
    expect((refreshLog![1] as { email?: string }).email).toBe(
      "t***t@example.com"
    );
  });

  it("L14: should refresh and rotate cookies when validateToken resolves null (expired access, valid refresh)", async () => {
    // L14 live defect (2026-09-29): the JWT adapter's catch swallows
    // TokenExpiredError, so validateToken() resolves null for an expired
    // access token — the thrown-error refresh path below was unreachable in
    // production. This test pins the real production shape of expiry.
    const expiredToken = jwt.sign(
      { userId: "test-user", email: "test@example.com" },
      process.env.JWT_SECRET || "test-secret",
      { expiresIn: "-1h" }
    );

    (req as any).cookies.accessToken = expiredToken;
    (req as any).cookies.refreshToken = "valid-refresh-token";
    (req as any).path = "/api/user/profile"; // Non-lightweight endpoint

    // setRefreshedSessionCookies() needs res.cookie — the shared beforeEach
    // mock only stubs status/json/clearCookie.
    (res as any).cookie = jest.fn().mockReturnThis();

    // Call 1: expired access → null (production behavior). Call 2: the
    // freshly-rotated access token validates.
    (mockAuthService.validateToken as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        userId: "test-user",
        email: "test@example.com",
        userLevel: "BASIC",
      });

    (mockAuthService.refreshToken as jest.Mock).mockResolvedValue({
      success: true,
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 14400,
      },
      user: {
        id: "test-user",
        email: "test@example.com",
        userLevel: "BASIC",
      },
    });

    (mockAuthService.getUserById as jest.Mock).mockResolvedValue({
      id: "test-user",
      email: "test@example.com",
      userLevel: "BASIC",
    });
    (mockAuthService.getAuthenticatedUserData as jest.Mock).mockResolvedValue({
      user: {
        id: "test-user",
        email: "test@example.com",
        userLevel: "BASIC",
        roles: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      roles: [],
      hasCredentials: false,
    });

    await authMiddleware(req as Request, res as Response, next);

    // The refresh cookie was presented instead of a hard 403/-1002
    expect(mockAuthService.refreshToken).toHaveBeenCalledWith(
      "valid-refresh-token"
    );
    expect(mockAuthService.refreshToken).toHaveBeenCalledTimes(1);
    // Rotated session cookies were written
    expect((res as any).cookie).toHaveBeenCalledWith(
      "accessToken",
      "new-access-token",
      expect.anything()
    );
    expect((res as any).cookie).toHaveBeenCalledWith(
      "refreshToken",
      "new-refresh-token",
      expect.anything()
    );
    // Request continued down the chain with the hydrated user
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user?.userId).toBe("test-user");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("L14: should answer 401/-1002 and clear cookies when null-payload refresh is definitively dead", async () => {
    const expiredToken = jwt.sign(
      { userId: "test-user", email: "test@example.com" },
      process.env.JWT_SECRET || "test-secret",
      { expiresIn: "-1h" }
    );

    (req as any).cookies.accessToken = expiredToken;
    (req as any).cookies.refreshToken = "refresh-token";

    (mockAuthService.validateToken as jest.Mock).mockResolvedValue(null);
    (mockAuthService.refreshToken as jest.Mock).mockResolvedValue({
      success: false,
      message: "Token refresh failed - invalid token", // definitive
    });

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.refreshToken).toHaveBeenCalledWith("refresh-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: "Session expired - please log in again",
    });
    for (const cookieName of [
      "accessToken",
      "refreshToken",
      "csrfSecret",
      "csrfToken",
    ]) {
      expect(res.clearCookie).toHaveBeenCalledWith(
        cookieName,
        expect.anything()
      );
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("should handle token refresh failure after retries", async () => {
    const expiredToken = jwt.sign(
      { userId: "test-user", email: "test@example.com" },
      process.env.JWT_SECRET || "test-secret",
      { expiresIn: "-1h" }
    );

    (req as any).cookies.accessToken = expiredToken;
    (req as any).cookies.refreshToken = "invalid-refresh-token";

    // Mock token validation to throw TokenExpiredError (triggers refresh)
    (mockAuthService.validateToken as jest.Mock).mockRejectedValue(
      new jwt.TokenExpiredError("Token expired", new Date())
    );

    // Mock refresh to always fail
    (mockAuthService.refreshToken as jest.Mock).mockResolvedValue({
      success: false,
      message: "Invalid refresh token",
    });

    // Mock Redis client for mutex
    const mockRedisClient = {
      set: jest.fn().mockResolvedValue("OK"),
    };
    (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);
    (redisService.del as jest.Mock).mockResolvedValue({ success: true });

    await authMiddleware(req as Request, res as Response, next);
    //expect(next).toHaveBeenCalled();
    expect(mockAuthService.refreshToken).not.toHaveBeenCalledWith(
      "valid-refresh-token"
    );
    // Definitive refresh failure contract (respondToFailedRefresh): the
    // presented refresh token is invalid → 401 + -1002 with cookies cleared —
    // never the transient -1004 and never a continued request chain.
    // (The previous `not401` assertion was stale: it only held while a leaked
    // mockResolvedValueOnce queue from the test above short-circuited this
    // flow into the generic 500 branch.)
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: "Session expired - please log in again",
    });
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: -1004 })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should handle simultaneous refresh mutex", async () => {
    const expiredToken = jwt.sign(
      { userId: "test-user", email: "test@example.com" },
      process.env.JWT_SECRET || "test-secret",
      { expiresIn: "-1h" }
    );

    (req as any).cookies.accessToken = expiredToken;
    (req as any).cookies.refreshToken = "refresh-token";

    // Mock token validation to throw TokenExpiredError (triggers refresh)
    (mockAuthService.validateToken as jest.Mock).mockRejectedValue(
      new jwt.TokenExpiredError("Token expired", new Date())
    );

    // Mock Redis client to simulate mutex already held
    const mockRedisClient = {
      set: jest.fn().mockResolvedValue(null), // SET NX failed - mutex already held
    };
    (redisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);

    await authMiddleware(req as Request, res as Response, next);

    expect(mockAuthService.refreshToken).toHaveBeenCalled(); // Should not attempt refresh due to mutex
    expect(res.status).toHaveBeenCalledWith(401);
    // 'Invalid refresh token' (leaked mock) is a definitive failure → -1002 + cookie clear
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: "Session expired - please log in again",
    });
    expect(res.clearCookie).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should respond -1002 and clear session cookies on definitive refresh failure", async () => {
    (req as any).cookies.refreshToken = "refresh-token";

    (mockAuthService.refreshToken as jest.Mock).mockResolvedValue({
      success: false,
      message: "Token refresh failed - invalid token",
    });

    await authMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1002,
      message: "Session expired - please log in again",
    });
    for (const cookieName of [
      "accessToken",
      "refreshToken",
      "csrfSecret",
      "csrfToken",
    ]) {
      expect(res.clearCookie).toHaveBeenCalledWith(
        cookieName,
        expect.anything()
      );
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("should respond -1004 without clearing cookies on transient refresh failure", async () => {
    (req as any).cookies.refreshToken = "refresh-token";

    (mockAuthService.refreshToken as jest.Mock).mockResolvedValue({
      success: false,
      message: "Redis temporarily unavailable",
    });

    await authMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: -1004,
      message: "Unauthorized - token refresh failed after multiple attempts",
    });
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
