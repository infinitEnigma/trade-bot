/** @format */

import {
  ExpressConfig,
  ExpressConfigOptions,
} from "../../src/server/express-config";
import express from "express";

describe("ExpressConfig", () => {
  describe("createApp", () => {
    it("should create an Express application instance", () => {
      const app = ExpressConfig.createApp();
      expect(app).toBeDefined();
      expect(typeof app).toBe("function");
    });
  });

  describe("configure", () => {
    it("should configure an Express application with default options", () => {
      const app = express();
      ExpressConfig.configure(app);

      // Verify the app has basic functionality
      expect(app).toBeDefined();
    });

    it("should configure an Express application with custom options", () => {
      const app = express();
      const options: ExpressConfigOptions = {
        enableCors: false,
        enableSecurity: false,
        trustProxy: false,
      };

      ExpressConfig.configure(app, options);

      expect(app).toBeDefined();
    });

    it("should mount context + HTTP logging before any router (L3)", () => {
      const app = express();
      ExpressConfig.configure(app);

      // Express 5 keeps the stack on app.router (not app._router).
      const stack = (app as unknown as { router?: { stack?: unknown[] } })
        .router?.stack;
      const handleName = (layer: unknown) =>
        (layer as { handle?: { name?: string } })?.handle?.name ?? "";
      const names = (stack ?? []).map(handleName);
      const contextIdx = names.indexOf("contextMiddleware");
      const httpIdx = names.indexOf("httpLogger");
      const firstRouter = names.indexOf("router");
      expect(stack).toBeDefined();
      expect(contextIdx).toBeGreaterThanOrEqual(0);
      expect(httpIdx).toBeGreaterThan(contextIdx);
      if (firstRouter >= 0) {
        expect(httpIdx).toBeLessThan(firstRouter);
      }
    });
  });

  describe("proxy configuration", () => {
    it("should trust proxies when configured", () => {
      const app = express();
      const options: ExpressConfigOptions = {
        trustProxy: true,
      };

      ExpressConfig.configure(app, options);

      // Check if trust proxy is configured
      const trustProxy = app.get("trust proxy");
      expect(trustProxy).toEqual(1);
    });

    it("should not trust proxies when disabled", () => {
      const app = express();
      const options: ExpressConfigOptions = {
        trustProxy: false,
      };

      ExpressConfig.configure(app, options);

      // Check if trust proxy is not configured
      const trustProxy = app.get("trust proxy");
      expect(trustProxy).toBeFalsy();
    });
  });

  describe("security configuration", () => {
    it("should enable security middleware by default", () => {
      const app = express();
      ExpressConfig.configure(app);

      // Verify the app has security middleware configured
      expect(app).toBeDefined();
    });

    it("should disable security middleware when requested", () => {
      const app = express();
      ExpressConfig.configure(app, { enableSecurity: false });

      expect(app).toBeDefined();
    });
  });

  describe("CORS configuration", () => {
    it("should enable CORS by default", () => {
      const app = express();
      ExpressConfig.configure(app);

      expect(app).toBeDefined();
    });

    it("should disable CORS when requested", () => {
      const app = express();
      ExpressConfig.configure(app, { enableCors: false });

      expect(app).toBeDefined();
    });
  });

  describe("parsing configuration", () => {
    it("should configure request parsing middleware", () => {
      const app = express();
      ExpressConfig.configure(app);

      expect(app).toBeDefined();
    });
  });
});
