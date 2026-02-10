/** @format */

import { httpLogger, errorLogger } from "../../src/interfaces/middleware/logger.middleware";
import { httpLogger as contextHttpLogger } from "../../src/core/logging";

// Mock the dependencies
jest.mock("../../src/core/logging", () => ({
    httpLogger: {
        http: jest.fn(),
        error: jest.fn(),
    },
}));

jest.mock("../../src/shared/utils/context", () => ({
    generateCorrelationId: jest.fn().mockReturnValue("test-correlation-id"),
    runWithContext: jest.fn((context, callback) => callback()),
    getContextForLogging: jest.fn(),
}));

describe("Logger Middleware", () => {
    describe("httpLogger", () => {
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            // Reset all mocks before each test
            (contextHttpLogger.http as jest.Mock).mockReset();

            // Create mock request object
            req = {
                method: "GET",
                url: "/test",
                ip: "127.0.0.1",
                query: {},
                body: {},
                get: jest.fn((header) => {
                    if (header === "User-Agent") return "Mozilla/5.0";
                    if (header === "Content-Length") return undefined;
                    return undefined;
                }),
            };

            // Create mock response object
            res = {
                statusCode: 200,
                end: jest.fn(),
                get: jest.fn().mockReturnValue("123"),
            };

            // Create mock next function
            next = jest.fn();
        });

        it("should log HTTP request details", () => {
            httpLogger(req, res, next);

            expect(contextHttpLogger.http).toHaveBeenCalledWith(
                "HTTP request",
                expect.objectContaining({
                    method: "GET",
                    url: "/test",
                    userAgent: "Mozilla/5.0",
                    ip: "127.0.0.1",
                    contentLength: undefined,
                    query: undefined,
                    body: undefined,
                })
            );
        });

        it("should log query parameters when present", () => {
            req.query = { param1: "value1", param2: "value2" };
            httpLogger(req, res, next);

            expect(contextHttpLogger.http).toHaveBeenCalledWith(
                "HTTP request",
                expect.objectContaining({
                    query: { param1: "value1", param2: "value2" },
                })
            );
        });

        it("should log body as [REDACTED] for non-GET requests", () => {
            req.method = "POST";
            req.body = { username: "testuser", password: "password123" };
            httpLogger(req, res, next);

            expect(contextHttpLogger.http).toHaveBeenCalledWith(
                "HTTP request",
                expect.objectContaining({
                    body: "[REDACTED]",
                })
            );
        });

        it("should call next function", () => {
            httpLogger(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
        });

        it("should log response details when res.end is called", () => {
            httpLogger(req, res, next);

            res.end();

            expect(contextHttpLogger.http).toHaveBeenCalledWith(
                "HTTP response",
                expect.objectContaining({
                    method: "GET",
                    url: "/test",
                    statusCode: 200,
                    duration: expect.stringMatching(/\d+ms/),
                    contentLength: "123",
                    userAgent: "Mozilla/5.0",
                    ip: "127.0.0.1",
                })
            );
        });

        it("should handle res.end with chunk and encoding", () => {
            httpLogger(req, res, next);
            const chunk = "response data";
            const encoding = "utf8";

            res.end(chunk, encoding);

            expect(res.end).toBeDefined();
            expect(contextHttpLogger.http).toHaveBeenCalledWith(
                "HTTP response",
                expect.anything()
            );
        });
    });

    describe("errorLogger", () => {
        let err: Error;
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            // Reset all mocks before each test
            (contextHttpLogger.error as jest.Mock).mockReset();

            // Create mock error
            err = new Error("Test error");

            // Create mock request object
            req = {
                method: "GET",
                url: "/test",
                ip: "127.0.0.1",
                query: { param1: "value1" },
                body: { data: "test" },
                params: { id: "123" },
                get: jest.fn().mockReturnValue("Mozilla/5.0"),
            };

            // Create mock response object
            res = {};

            // Create mock next function
            next = jest.fn();
        });

        it("should log error details with context", () => {
            errorLogger(err, req, res, next);

            expect(contextHttpLogger.error).toHaveBeenCalledWith(
                "Application error",
                err,
                expect.objectContaining({
                    method: "GET",
                    url: "/test",
                    userAgent: "Mozilla/5.0",
                    ip: "127.0.0.1",
                    body: { data: "test" },
                    query: { param1: "value1" },
                    params: { id: "123" },
                })
            );
        });

        it("should pass error to next middleware", () => {
            errorLogger(err, req, res, next);

            expect(next).toHaveBeenCalledWith(err);
        });
    });
});