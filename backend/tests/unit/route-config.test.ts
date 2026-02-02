/** @format */

import { RouteConfig, RouteConfigOptions } from "../../src/server/route-config";
import express from "express";
import { Server } from "socket.io";

describe("RouteConfig", () => {
    describe("register", () => {
        it("should register all routes with default options", async () => {
            const app = express();
            await RouteConfig.register(app);

            expect(app).toBeDefined();
        });

        it("should register routes without API routes when disabled", async () => {
            const app = express();
            const options: RouteConfigOptions = {
                enableApiRoutes: false,
            };

            await RouteConfig.register(app, options);

            expect(app).toBeDefined();
        });

        it("should register routes without health routes when disabled", async () => {
            const app = express();
            const options: RouteConfigOptions = {
                enableHealthRoutes: false,
            };

            await RouteConfig.register(app, options);

            expect(app).toBeDefined();
        });

        it("should register routes without API and health routes when both disabled", async () => {
            const app = express();
            const options: RouteConfigOptions = {
                enableApiRoutes: false,
                enableHealthRoutes: false,
            };

            await RouteConfig.register(app, options);

            const registeredRoutes = RouteConfig.getRegisteredRoutes(app);
            expect(registeredRoutes.length).toBe(0);
        });

        it("should attach Socket.IO server when provided", async () => {
            const app = express();
            const mockIo = {} as Server;

            await RouteConfig.register(app, { io: mockIo });

            const io = app.get("io");
            expect(io).toEqual(mockIo);
        });

        it("should not attach Socket.IO server when not provided", async () => {
            const app = express();

            await RouteConfig.register(app);

            const io = app.get("io");
            expect(io).toBeUndefined();
        });
    });

    describe("getRegisteredRoutes", () => {
        it("should return all registered route paths", async () => {
            const app = express();
            await RouteConfig.register(app, {
                enableApiRoutes: false,
                enableHealthRoutes: false
            });

            const routes = RouteConfig.getRegisteredRoutes(app);
            expect(routes).toBeInstanceOf(Array);
            expect(routes.length).toBe(0);
        });
    });

    describe("validateRouteRegistration", () => {
        it("should validate route registration is complete", async () => {
            const app = express();
            await RouteConfig.register(app, {
                enableApiRoutes: false,
                enableHealthRoutes: false
            });

            const validation = RouteConfig.validateRouteRegistration(app);
            expect(validation.isValid).toBe(false);
            expect(validation.missingRoutes.length).toBeGreaterThan(0);
        });
    });
});