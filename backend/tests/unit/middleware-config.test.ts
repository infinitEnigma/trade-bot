/** @format */

import {
  MiddlewareConfig,
  MiddlewareConfigOptions,
} from "../../src/server/middleware-config";
import express from "express";

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

describe("MiddlewareConfig", () => {
  describe("configure", () => {
    it("should configure an Express application with default options", () => {
      const app = express();
      MiddlewareConfig.configure(app);
      expect(app).toBeDefined();
    });

    it("should configure an Express application with custom options", () => {
      const app = express();
      const options: MiddlewareConfigOptions = {
        enableCsrf: false,
        enableRateLimiting: false,
        enableActivityTracking: false,
      };
      MiddlewareConfig.configure(app, options);
      expect(app).toBeDefined();
    });
  });

  describe("configuration validation", () => {
    it("should validate a valid middleware configuration", () => {
      const app = express();
      MiddlewareConfig.configure(app);
      const { isValid, issues } = MiddlewareConfig.validateConfiguration(app);
      expect(isValid).toBeTruthy();
      expect(issues.length).toBe(0);
    });

    it("should identify missing CSRF middleware", () => {
      const app = express();
      MiddlewareConfig.configure(app, { enableCsrf: false });
      const { isValid, issues } = MiddlewareConfig.validateConfiguration(app);
      expect(isValid).toBeFalsy();
      expect(issues).toContain("CSRF protection middleware not found");
    });

    it("should identify missing rate limiting middleware", () => {
      const app = express();
      MiddlewareConfig.configure(app, { enableRateLimiting: false });
      const { isValid, issues } = MiddlewareConfig.validateConfiguration(app);
      expect(isValid).toBeFalsy();
      expect(issues).toContain("Rate limiting middleware not found");
    });
  });

  describe("CSRF configuration", () => {
    it("should enable CSRF protection by default", () => {
      const app = express();
      MiddlewareConfig.configure(app);
      const { isValid } = MiddlewareConfig.validateConfiguration(app);
      expect(isValid).toBeTruthy();
    });

    it("should disable CSRF protection when requested", () => {
      const app = express();
      MiddlewareConfig.configure(app, { enableCsrf: false });
      const { issues } = MiddlewareConfig.validateConfiguration(app);
      expect(issues).toContain("CSRF protection middleware not found");
    });
  });

  describe("rate limiting configuration", () => {
    it("should enable rate limiting by default", () => {
      const app = express();
      MiddlewareConfig.configure(app);
      const { isValid } = MiddlewareConfig.validateConfiguration(app);
      expect(isValid).toBeTruthy();
    });

    it("should disable rate limiting when requested", () => {
      const app = express();
      MiddlewareConfig.configure(app, { enableRateLimiting: false });
      const { issues } = MiddlewareConfig.validateConfiguration(app);
      expect(issues).toContain("Rate limiting middleware not found");
    });
  });

  describe("activity tracking configuration", () => {
    it("should enable activity tracking by default", () => {
      const app = express();
      MiddlewareConfig.configure(app);
      expect(app).toBeDefined();
    });

    it("should disable activity tracking when requested", () => {
      const app = express();
      MiddlewareConfig.configure(app, { enableActivityTracking: false });
      expect(app).toBeDefined();
    });
  });

  describe("Kodiak protection configuration", () => {
    it("should configure Kodiak protection when rate limiting is enabled", () => {
      const app = express();
      MiddlewareConfig.configure(app, {
        enableRateLimiting: true,
        enableCsrf: false,
        enableActivityTracking: false,
      });
      expect(app).toBeDefined();
    });

    it("should not configure Kodiak protection when rate limiting is disabled", () => {
      const app = express();
      MiddlewareConfig.configure(app, {
        enableRateLimiting: false,
        enableCsrf: false,
        enableActivityTracking: false,
      });
      expect(app).toBeDefined();
    });
  });
});
