/** @format */

import { contextMiddleware } from "../../src/interfaces/middleware/context";
import {
    setRequestContext,
    generateCorrelationId,
    generateRequestId,
    getCurrentContext,
} from "../../src/shared/utils/context";

// Mock the dependencies
jest.mock("../../src/shared/utils/context", () => ({
    setRequestContext: jest.fn(),
    generateCorrelationId: jest.fn().mockReturnValue("test-correlation-id"),
    generateRequestId: jest.fn().mockReturnValue("test-request-id"),
    getCurrentContext: jest.fn(),
}));

describe("Context Middleware", () => {
    let req: any;
    let res: any;
    let next: jest.Mock;

    beforeEach(() => {
        // Reset all mocks before each test
        (setRequestContext as jest.Mock).mockReset();
        (generateCorrelationId as jest.Mock).mockReset().mockReturnValue("test-correlation-id");
        (generateRequestId as jest.Mock).mockReset().mockReturnValue("test-request-id");
        (getCurrentContext as jest.Mock).mockReset();

        // Create mock request object
        req = {
            headers: {},
        };

        // Create mock response object
        res = {
            setHeader: jest.fn(),
            on: jest.fn((event, callback) => {
                if (event === "finish") {
                    res.finishCallback = callback;
                }
            }),
        };

        // Create mock next function
        next = jest.fn();
    });

    it("should set request context with generated correlation and request IDs", () => {
        contextMiddleware(req, res, next);

        expect(setRequestContext).toHaveBeenCalledWith(
            expect.objectContaining({
                correlationId: expect.any(String),
                requestId: expect.any(String),
                startTime: expect.any(Number),
            })
        );
    });

    it("should use existing correlation ID from headers if provided", () => {
        const existingCorrelationId = "existing-correlation-id";
        req.headers["x-correlation-id"] = existingCorrelationId;

        contextMiddleware(req, res, next);

        expect(setRequestContext).toHaveBeenCalledWith(
            expect.objectContaining({
                correlationId: existingCorrelationId,
            })
        );
    });

    it("should add correlation ID to response headers", () => {
        contextMiddleware(req, res, next);

        expect(res.setHeader).toHaveBeenCalledWith(
            "x-correlation-id",
            expect.any(String)
        );
    });

    it("should call next function", () => {
        contextMiddleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it("should track request duration on response finish", (done) => {
        const mockContext = { duration: undefined };
        (getCurrentContext as jest.Mock).mockReturnValue(mockContext);

        contextMiddleware(req, res, next);

        // Add a small delay to ensure we measure a positive duration
        setTimeout(() => {
            // Simulate response finish
            res.finishCallback();

            expect(getCurrentContext).toHaveBeenCalled();
            expect(mockContext.duration).toBeGreaterThan(0);
            done();
        }, 10);
    });

    it("should handle case when no context is available on response finish", () => {
        (getCurrentContext as jest.Mock).mockReturnValue(undefined);

        contextMiddleware(req, res, next);

        // Should not throw an error when context is undefined
        expect(() => res.finishCallback()).not.toThrow();
    });
});