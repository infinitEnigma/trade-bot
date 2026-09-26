/** @format */

import { RouteConfig, RouteConfigOptions } from "../../src/server/route-config";
import express from "express";
import { Server } from "socket.io";

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

describe("RouteConfig", () => {
  describe("register", () => {
    it("should register all routes with default options", () => {
      const app = express();
      RouteConfig.register(app);

      expect(app).toBeDefined();
    });

    it("should register routes without API routes when disabled", () => {
      const app = express();
      const options: RouteConfigOptions = {
        enableApiRoutes: false,
      };

      RouteConfig.register(app, options);

      expect(app).toBeDefined();
    });

    it("should register routes without health routes when disabled", () => {
      const app = express();
      const options: RouteConfigOptions = {
        enableHealthRoutes: false,
      };

      RouteConfig.register(app, options);

      expect(app).toBeDefined();
    });

    it("should register routes without API and health routes when both disabled", () => {
      const app = express();
      const options: RouteConfigOptions = {
        enableApiRoutes: false,
        enableHealthRoutes: false,
      };

      RouteConfig.register(app, options);

      const registeredRoutes = RouteConfig.getRegisteredRoutes(app);
      expect(registeredRoutes.length).toBe(0);
    });

    it("should attach Socket.IO server when provided", () => {
      const app = express();
      const mockIo = {} as Server;

      RouteConfig.register(app, { io: mockIo });

      const io = app.get("io");
      expect(io).toEqual(mockIo);
    });

    it("should not attach Socket.IO server when not provided", () => {
      const app = express();

      RouteConfig.register(app);

      const io = app.get("io");
      expect(io).toBeUndefined();
    });
  });

  describe("getRegisteredRoutes", () => {
    it("should return all registered route paths", () => {
      const app = express();
      RouteConfig.register(app, {
        enableApiRoutes: false,
        enableHealthRoutes: false,
      });

      const routes = RouteConfig.getRegisteredRoutes(app);
      expect(routes).toBeInstanceOf(Array);
      expect(routes.length).toBe(0);
    });
  });

  describe("validateRouteRegistration", () => {
    it("should validate route registration is complete", () => {
      const app = express();
      RouteConfig.register(app, {
        enableApiRoutes: false,
        enableHealthRoutes: false,
      });

      const validation = RouteConfig.validateRouteRegistration(app);
      expect(validation.isValid).toBe(false);
      expect(validation.missingRoutes.length).toBeGreaterThan(0);
    });
  });
});
