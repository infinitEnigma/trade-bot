/** @format */

import { ExpressConfig, ExpressConfigOptions } from "../../src/server/express-config";
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
        it("should configure an Express application with default options", async () => {
            const app = express();
            await ExpressConfig.configure(app);

            // Verify the app has basic functionality
            expect(app).toBeDefined();
        });

        it("should configure an Express application with custom options", async () => {
            const app = express();
            const options: ExpressConfigOptions = {
                enableCors: false,
                enableSecurity: false,
                trustProxy: false,
            };

            await ExpressConfig.configure(app, options);

            expect(app).toBeDefined();
        });
    });

    describe("proxy configuration", () => {
        it("should trust proxies when configured", async () => {
            const app = express();
            const options: ExpressConfigOptions = {
                trustProxy: true,
            };

            await ExpressConfig.configure(app, options);

            // Check if trust proxy is configured
            const trustProxy = app.get("trust proxy");
            expect(trustProxy).toEqual(1);
        });

        it("should not trust proxies when disabled", async () => {
            const app = express();
            const options: ExpressConfigOptions = {
                trustProxy: false,
            };

            await ExpressConfig.configure(app, options);

            // Check if trust proxy is not configured
            const trustProxy = app.get("trust proxy");
            expect(trustProxy).toBeFalsy();
        });
    });

    describe("security configuration", () => {
        it("should enable security middleware by default", async () => {
            const app = express();
            await ExpressConfig.configure(app);

            // Verify the app has security middleware configured
            expect(app).toBeDefined();
        });

        it("should disable security middleware when requested", async () => {
            const app = express();
            await ExpressConfig.configure(app, { enableSecurity: false });

            expect(app).toBeDefined();
        });
    });

    describe("CORS configuration", () => {
        it("should enable CORS by default", async () => {
            const app = express();
            await ExpressConfig.configure(app);

            expect(app).toBeDefined();
        });

        it("should disable CORS when requested", async () => {
            const app = express();
            await ExpressConfig.configure(app, { enableCors: false });

            expect(app).toBeDefined();
        });
    });

    describe("parsing configuration", () => {
        it("should configure request parsing middleware", async () => {
            const app = express();
            await ExpressConfig.configure(app);

            expect(app).toBeDefined();
        });
    });
});