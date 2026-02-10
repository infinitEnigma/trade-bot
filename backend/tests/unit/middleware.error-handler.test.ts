/** @format */

import { ErrorHandlerMiddleware, createErrorHandler, ErrorHandlerUtils } from "../../src/interfaces/middleware/error-handler.middleware";
import { AppError, SharedErrorCodes } from "@trade-bot/shared";
import { securityLogger as logger } from "../../src/core/logging/context-aware-logger.service";

// Mock the dependencies
jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
    securityLogger: {
        error: jest.fn(),
        warn: jest.fn(),
    },
}));

describe("ErrorHandlerMiddleware", () => {
    describe("constructor", () => {
        it("should create an instance with default config", () => {
            const errorHandler = new ErrorHandlerMiddleware();
            expect(errorHandler).toBeInstanceOf(ErrorHandlerMiddleware);
        });

        it("should create an instance with custom config", () => {
            const customConfig = {
                includeStackTrace: false,
                enableLogging: false,
                errorTransformers: [],
                responseTransformers: [],
            };
            const errorHandler = new ErrorHandlerMiddleware(customConfig);
            expect(errorHandler).toBeInstanceOf(ErrorHandlerMiddleware);
        });
    });

    describe("handle method", () => {
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            // Reset all mocks before each test
            (logger.error as jest.Mock).mockReset();
            (logger.warn as jest.Mock).mockReset();

            // Create mock request object
            req = {
                method: "GET",
                url: "/test",
                ip: "127.0.0.1",
                headers: {},
                get: jest.fn(),
                user: { userId: "test-user-id" },
            };

            // Create mock response object
            res = {
                headersSent: false,
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            // Create mock next function
            next = jest.fn();
        });

        it("should handle AppError with correct status code and response", () => {
            const error = new AppError("Test error", SharedErrorCodes.VALIDATION_ERROR, 400, { field: "test" });
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: "Test error",
                    code: SharedErrorCodes.VALIDATION_ERROR,
                })
            );
        });

        it("should handle generic Error with internal server error status", () => {
            const error = new Error("Generic error");
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                })
            );
        });

        it("should skip handling if response already sent", () => {
            res.headersSent = true;
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });

        it("should extract correlation id from request headers", () => {
            const correlationId = "test-correlation-id";
            req.headers["x-correlation-id"] = correlationId;
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    correlationId,
                })
            );
        });

        it("should use x-request-id as fallback correlation id", () => {
            const requestId = "test-request-id";
            req.headers["x-request-id"] = requestId;
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    correlationId: requestId,
                })
            );
        });

        it("should use custom correlation id from request object", () => {
            const customCorrelationId = "custom-correlation-id";
            req.correlationId = customCorrelationId;
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    correlationId: customCorrelationId,
                })
            );
        });

        it("should log operational errors as warnings", () => {
            const error = new AppError("Operational error", SharedErrorCodes.VALIDATION_ERROR, 400);
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(logger.warn).toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("should log programming errors as errors", () => {
            const error = new Error("Programming error");
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(logger.error).toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("should include stack trace in development mode", () => {
            process.env.NODE_ENV = "development";
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware();

            errorHandler.handle(error, req, res, next);

            expect(logger.error).toHaveBeenCalledWith(
                expect.anything(),
                error,
                expect.objectContaining({
                    stack: expect.anything()
                })
            );
        });

        it("should not include stack trace in production mode", () => {
            process.env.NODE_ENV = "production";
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware({ includeStackTrace: false });

            errorHandler.handle(error, req, res, next);

            expect(logger.error).toHaveBeenCalledWith(
                expect.anything(),
                error,
                expect.not.objectContaining({
                    stack: expect.anything(),
                })
            );
        });

        it("should apply error transformers", () => {
            const originalError = new Error("Original error");
            const transformedError = new AppError("Transformed error", SharedErrorCodes.VALIDATION_ERROR, 400);
            const errorHandler = new ErrorHandlerMiddleware({
                errorTransformers: [
                    (err) => {
                        expect(err).toBe(originalError);
                        return transformedError;
                    },
                ],
            });

            errorHandler.handle(originalError, req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: "Transformed error",
                    code: SharedErrorCodes.VALIDATION_ERROR,
                })
            );
        });

        it("should handle error transformer failures gracefully", () => {
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware({
                errorTransformers: [
                    () => {
                        throw new Error("Transformer failed");
                    },
                ],
            });

            errorHandler.handle(error, req, res, next);

            expect(logger.error).toHaveBeenCalledWith(
                "Error transformer failed",
                expect.anything(),
                expect.anything()
            );
        });

        it("should handle non-Error error transformer failures", () => {
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware({
                errorTransformers: [
                    () => {
                        throw "Non-Error transformer failure";
                    },
                ],
            });

            errorHandler.handle(error, req, res, next);

            expect(logger.error).toHaveBeenCalledWith(
                "Error transformer failed",
                expect.anything(),
                expect.anything()
            );
        });

        it("should skip logging when enableLogging is false", () => {
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware({
                enableLogging: false,
            });

            errorHandler.handle(error, req, res, next);

            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("should apply response transformers", () => {
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware({
                responseTransformers: [
                    (response) => {
                        return {
                            ...response,
                            customField: "custom-value",
                        };
                    },
                ],
            });

            errorHandler.handle(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    customField: "custom-value",
                })
            );
        });

        it("should handle response transformer failures gracefully", () => {
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware({
                responseTransformers: [
                    () => {
                        throw new Error("Transformer failed");
                    },
                ],
            });

            errorHandler.handle(error, req, res, next);

            expect(logger.error).toHaveBeenCalledWith(
                "Response transformer failed",
                expect.anything()
            );
        });

        it("should handle non-Error response transformer failures", () => {
            const error = new Error("Test error");
            const errorHandler = new ErrorHandlerMiddleware({
                responseTransformers: [
                    () => {
                        throw "Non-Error transformer failure";
                    },
                ],
            });

            errorHandler.handle(error, req, res, next);

            expect(logger.error).toHaveBeenCalledWith(
                "Response transformer failed",
                expect.anything()
            );
        });
    });

    describe("createErrorHandler", () => {
        it("should create an ErrorHandlerMiddleware instance", () => {
            const errorHandler = createErrorHandler();
            expect(errorHandler).toBeInstanceOf(ErrorHandlerMiddleware);
        });

        it("should create an instance with custom config", () => {
            const customConfig = { includeStackTrace: false };
            const errorHandler = createErrorHandler(customConfig);
            expect(errorHandler).toBeInstanceOf(ErrorHandlerMiddleware);
        });
    });

    describe("ErrorHandlerUtils", () => {
        describe("asyncHandler", () => {
            it("should wrap async functions and catch errors", async () => {
                const error = new Error("Async error");
                const fn = jest.fn().mockRejectedValue(error);
                const wrappedFn = ErrorHandlerUtils.asyncHandler(fn);

                const req: any = {};
                const res: any = {};
                const next = jest.fn();

                await wrappedFn(req, res, next);

                expect(fn).toHaveBeenCalled();
                expect(next).toHaveBeenCalledWith(error);
            });
        });

        describe("createCustomError", () => {
            it("should create an AppError instance with all parameters", () => {
                const message = "Custom error";
                const code = SharedErrorCodes.VALIDATION_ERROR;
                const statusCode = 400;
                const context = { field: "value" };

                const error = ErrorHandlerUtils.createCustomError(message, code, statusCode, context);

                expect(error).toBeInstanceOf(AppError);
                expect(error.message).toBe(message);
                expect(error.code).toBe(code);
                expect(error.statusCode).toBe(statusCode);
                expect(error.context).toEqual(context);
            });

            it("should create an AppError instance with default status code", () => {
                const message = "Custom error";
                const code = SharedErrorCodes.VALIDATION_ERROR;

                const error = ErrorHandlerUtils.createCustomError(message, code);

                expect(error).toBeInstanceOf(AppError);
                expect(error.message).toBe(message);
                expect(error.code).toBe(code);
                expect(error.statusCode).toBe(500);
                expect(error.context).toEqual({});
            });

            it("should create an AppError instance with default context", () => {
                const message = "Custom error";
                const code = SharedErrorCodes.VALIDATION_ERROR;
                const statusCode = 400;

                const error = ErrorHandlerUtils.createCustomError(message, code, statusCode);

                expect(error).toBeInstanceOf(AppError);
                expect(error.message).toBe(message);
                expect(error.code).toBe(code);
                expect(error.statusCode).toBe(statusCode);
                expect(error.context).toEqual({});
            });
        });

        describe("shouldAlert", () => {
            it("should return true for critical system errors", () => {
                const criticalErrors = [
                    SharedErrorCodes.INTERNAL_ERROR,
                    SharedErrorCodes.DATABASE_ERROR,
                    SharedErrorCodes.EXTERNAL_SERVICE_ERROR,
                    SharedErrorCodes.CONFIGURATION_ERROR,
                ];

                criticalErrors.forEach((code) => {
                    const error = new AppError("Critical error", code, 500);
                    expect(ErrorHandlerUtils.shouldAlert(error)).toBe(true);
                });
            });

            it("should return false for non-critical errors", () => {
                const nonCriticalErrors = [
                    SharedErrorCodes.VALIDATION_ERROR,
                    SharedErrorCodes.UNAUTHENTICATED,
                    SharedErrorCodes.INSUFFICIENT_PERMISSIONS,
                ];

                nonCriticalErrors.forEach((code) => {
                    const error = new AppError("Non-critical error", code, 400);
                    expect(ErrorHandlerUtils.shouldAlert(error)).toBe(false);
                });
            });

            it("should return true for unknown errors", () => {
                const error = new Error("Unknown error");
                expect(ErrorHandlerUtils.shouldAlert(error)).toBe(true);
            });
        });

        describe("getSeverity", () => {
            it("should return critical for internal, database, and configuration errors", () => {
                const criticalErrors = [
                    SharedErrorCodes.INTERNAL_ERROR,
                    SharedErrorCodes.DATABASE_ERROR,
                    SharedErrorCodes.CONFIGURATION_ERROR,
                ];

                criticalErrors.forEach((code) => {
                    const error = new AppError("Critical error", code, 500);
                    expect(ErrorHandlerUtils.getSeverity(error)).toBe("critical");
                });
            });

            it("should return high for external service and connection errors", () => {
                const highErrors = [
                    SharedErrorCodes.EXTERNAL_SERVICE_ERROR,
                    SharedErrorCodes.CONNECTION_ERROR,
                ];

                highErrors.forEach((code) => {
                    const error = new AppError("High severity error", code, 503);
                    expect(ErrorHandlerUtils.getSeverity(error)).toBe("high");
                });
            });

            it("should return medium for authentication and permission errors", () => {
                const mediumErrors = [
                    SharedErrorCodes.UNAUTHENTICATED,
                    SharedErrorCodes.INSUFFICIENT_PERMISSIONS,
                ];

                mediumErrors.forEach((code) => {
                    const error = new AppError("Medium severity error", code, 401);
                    expect(ErrorHandlerUtils.getSeverity(error)).toBe("medium");
                });
            });

            it("should return low for other AppErrors", () => {
                const error = new AppError("Low severity error", SharedErrorCodes.VALIDATION_ERROR, 400);
                expect(ErrorHandlerUtils.getSeverity(error)).toBe("low");
            });

            it("should return high for unknown errors", () => {
                const error = new Error("Unknown error");
                expect(ErrorHandlerUtils.getSeverity(error)).toBe("high");
            });
        });
    });
});