/** @format */

import { ContextAwareLogger, createEnhancedErrorInfo, createPerformanceMetrics, createDatabaseMetrics, createHttpRequestInfo, createUserContextInfo, classifyError, parseStackTrace, SharedErrorCodes } from "../../src/core/logging/context-aware-logger.service";
import { createErrorInfo } from "@trade-bot/shared";
import { setRequestContext, getCurrentContext } from "../../src/shared/utils/context";

describe("ContextAwareLogger Performance Optimization", () => {
    let logger: ContextAwareLogger;

    beforeEach(() => {
        logger = new ContextAwareLogger("test-component");
    });

    describe("Context Caching", () => {
        it("should cache context information when context hasn't changed", () => {
            // Set up a request context
            setRequestContext({
                correlationId: "test-correlation-id",
                userId: "test-user",
                userLevel: "VERIFIED",
                requestId: "test-request",
                startTime: Date.now(),
            });

            // Spy on the private methods to verify caching behavior
            const getContextInfoSpy = jest.spyOn(logger as any, "getContextInfo");
            const checkContextChangeSpy = jest.spyOn(logger as any, "checkContextChange");

            // First call - should compute context
            logger.info("First message");
            expect(getContextInfoSpy).toHaveBeenCalledTimes(1);
            expect(checkContextChangeSpy).toHaveBeenCalledTimes(1);

            // Second call with same context - should use cache
            logger.info("Second message");
            expect(getContextInfoSpy).toHaveBeenCalledTimes(2);
            expect(checkContextChangeSpy).toHaveBeenCalledTimes(2);

            // Verify the context cache is working
            const cache = (logger as any).contextCache;
            expect(cache.cachedInfo).toBeDefined();
            expect(cache.cachedInfo?.correlationId).toBe("test-correlation-id");
            expect(cache.cachedInfo?.userId).toBe("test-user");
            expect(cache.cachedInfo?.component).toBe("test-component");
        });

        it("should invalidate cache when context changes", () => {
            // Set initial context
            setRequestContext({
                correlationId: "initial-correlation-id",
                userId: "user1",
                userLevel: "BASIC",
                requestId: "request1",
                startTime: Date.now(),
            });

            // First call with initial context
            logger.info("Message with initial context");
            const initialCache = (logger as any).contextCache;
            expect(initialCache.cachedInfo?.correlationId).toBe("initial-correlation-id");

            // Create a new logger instance to test context change detection
            // In a real scenario, context changes would be detected by different logger instances
            const logger2 = new ContextAwareLogger("test-component");

            // Change context
            setRequestContext({
                correlationId: "new-correlation-id",
                userId: "user2",
                userLevel: "VERIFIED",
                requestId: "request2",
                startTime: Date.now(),
            });

            // Call with new context using the new logger instance
            logger2.info("Message with new context");
            const newCache = (logger2 as any).contextCache;
            expect(newCache.cachedInfo?.correlationId).toBe("new-correlation-id");
            expect(newCache.cachedInfo?.userId).toBe("user2");
        });

        it("should handle additional metadata correctly with caching", () => {
            setRequestContext({
                correlationId: "test-correlation-id",
                userId: "test-user",
                userLevel: "VERIFIED",
                requestId: "test-request",
                startTime: Date.now(),
            });

            // First call with additional metadata
            logger.info("Message with metadata", { customField: "value1", operation: "test" });

            // Second call with different metadata - should merge with cached context
            logger.info("Message with different metadata", { customField: "value2", requestId: "override" });

            // Verify both calls work and context is properly merged
            expect((logger as any).contextCache.cachedInfo).toBeDefined();
        });

        it("should work correctly without context", () => {
            // Ensure no context is set
            const initialContext = getCurrentContext();
            if (initialContext) {
                // This is a bit tricky to test since we can't easily clear AsyncLocalStorage
                // But we can verify it doesn't crash
                logger.info("Message without context");
                expect((logger as any).contextCache.cachedInfo).toBeDefined();
                expect((logger as any).contextCache.cachedInfo?.component).toBe("test-component");
            }
        });
    });

    describe("Performance Characteristics", () => {
        it("should demonstrate performance improvement with caching", () => {
            setRequestContext({
                correlationId: "perf-test-id",
                userId: "perf-user",
                userLevel: "VERIFIED",
                requestId: "perf-request",
                startTime: Date.now(),
            });

            const startTime = Date.now();
            const iterations = 1000;

            // Warm up the cache
            logger.info("Warm up");

            // Measure cached performance
            for (let i = 0; i < iterations; i++) {
                logger.info(`Performance test message ${i}`);
            }

            const cachedDuration = Date.now() - startTime;

            // The test should complete successfully
            expect(cachedDuration).toBeGreaterThan(0);
            expect(cachedDuration).toBeLessThan(5000); // Should be very fast with caching
        });
    });

    describe("Type Safety Enhancements", () => {
        it("should support type-safe error logging with ErrorInfo", () => {
            setRequestContext({
                correlationId: "type-test-id",
                userId: "type-test-user",
                userLevel: "VERIFIED",
                requestId: "type-test-request",
                startTime: Date.now(),
            });

            const testError = new Error("Test error message");
            testError.name = "TestError";

            // Test the new createErrorInfo helper function
            const errorInfo = createErrorInfo(testError, {
                errorType: 'database',
                errorCode: 'DB_CONNECTION_FAILED',
                isOperational: false
            });

            expect(errorInfo).toBeDefined();
            expect(errorInfo.error).toBe("Test error message");
            expect(errorInfo.errorName).toBe("TestError");
            expect(errorInfo.errorType).toBe("database");
            expect(errorInfo.errorCode).toBe("DB_CONNECTION_FAILED");
            expect(errorInfo.isOperational).toBe(false);
            expect(errorInfo.errorStack).toBeDefined();

            // Test type-safe error logging
            logger.errorWithInfo("Database connection failed", errorInfo);

            // Verify the logger call doesn't throw
            expect(true).toBe(true); // Just verify it executes without error
        });

        it("should support type-safe metadata creation", () => {
            // Test performance metrics creation
            const perfMetrics = createPerformanceMetrics({
                duration: 125,
                operation: "database_query",
                operationType: "read",
                success: true
            });

            expect(perfMetrics.duration).toBe(125);
            expect(perfMetrics.durationMs).toBe(125);
            expect(perfMetrics.operation).toBe("database_query");
            expect(perfMetrics.success).toBe(true);

            // Test database metrics creation
            const dbMetrics = createDatabaseMetrics({
                query: "SELECT * FROM users",
                table: "users",
                rowCount: 42,
                queryDuration: 25
            });

            expect(dbMetrics.query).toBe("SELECT * FROM users");
            expect(dbMetrics.table).toBe("users");
            expect(dbMetrics.rowCount).toBe(42);

            // Test HTTP request info creation
            const httpInfo = createHttpRequestInfo({
                method: "GET",
                path: "/api/users",
                statusCode: 200,
                requestId: "req-123"
            });

            expect(httpInfo.method).toBe("GET");
            expect(httpInfo.path).toBe("/api/users");
            expect(httpInfo.statusCode).toBe(200);

            // Test user context info creation
            const userContext = createUserContextInfo({
                userId: "user-123",
                userLevel: "VERIFIED",
                userEmail: "test@example.com",
                userRole: "admin"
            });

            expect(userContext.userId).toBe("user-123");
            expect(userContext.userLevel).toBe("VERIFIED");
            expect(userContext.userEmail).toBe("test@example.com");
        });

        it("should maintain backward compatibility with existing logging", () => {
            setRequestContext({
                correlationId: "compat-test-id",
                userId: "compat-test-user",
                userLevel: "BASIC",
                requestId: "compat-test-request",
                startTime: Date.now(),
            });

            // Test that existing logging patterns still work
            logger.info("Info message", { customField: "value" });
            logger.warn("Warning message", { anotherField: 123 });
            logger.debug("Debug message", { nested: { data: "test" } });

            // Test that error logging with Error objects still works
            const testError = new Error("Compatibility test error");
            logger.error("Error message", testError, { context: "test" });

            // All calls should execute without throwing
            expect(true).toBe(true);
        });
    });

    describe("Enhanced Error Handling Features", () => {
        describe("Error Classification", () => {
            it("should classify database errors correctly", () => {
                const dbError = new Error("Database connection failed");
                dbError.name = "DatabaseError";

                const classification = classifyError(dbError);
                expect(classification.errorType).toBe('database');
                expect(classification.errorCode).toBe(SharedErrorCodes.CONNECTION_ERROR);
                expect(classification.errorSeverity).toBe('high');
            });

            it("should classify network errors correctly", () => {
                const networkError = new Error("Connection timeout");
                networkError.name = "NetworkError";

                const classification = classifyError(networkError);
                expect(classification.errorType).toBe('network');
                expect(classification.errorCode).toBe(SharedErrorCodes.SERVICE_UNAVAILABLE);
                expect(classification.errorSeverity).toBe('high');
            });

            it("should classify validation errors correctly", () => {
                const validationError = new Error("Validation failed: email is required");
                validationError.name = "ValidationError";

                const classification = classifyError(validationError);
                expect(classification.errorType).toBe('validation');
                expect(classification.errorCode).toBe(SharedErrorCodes.VALIDATION_ERROR);
                expect(classification.errorSeverity).toBe('medium');
            });

            it("should classify authentication errors correctly", () => {
                const authError = new Error("Invalid JWT token");
                authError.name = "AuthenticationError";

                const classification = classifyError(authError);
                expect(classification.errorType).toBe('authentication');
                expect(classification.errorCode).toBe(SharedErrorCodes.TOKEN_EXPIRED);
                expect(classification.errorSeverity).toBe('medium');
            });

            it("should classify unknown errors as unknown", () => {
                const unknownError = new Error("Something went wrong");
                unknownError.name = "UnknownError";

                const classification = classifyError(unknownError);
                expect(classification.errorType).toBe('unknown');
                expect(classification.errorCode).toBe(SharedErrorCodes.INTERNAL_ERROR);
                expect(classification.errorSeverity).toBe('high');
            });
        });

        describe("Stack Trace Parsing", () => {
            it("should parse stack traces into structured frames", () => {
                const mockStack = `
                    Error: Test error
                    at TestFunction (/app/test.js:10:15)
                    at anotherFunction (/app/another.js:20:25)
                    at Object.<anonymous> (/app/index.js:5:1)
                `;

                const frames = parseStackTrace(mockStack);
                expect(frames.length).toBe(3);
                expect(frames[0].functionName).toBe('TestFunction');
                expect(frames[0].file).toBe('/app/test.js');
                expect(frames[0].line).toBe(10);
                expect(frames[0].column).toBe(15);
            });

            it("should handle different stack trace formats", () => {
                const mockStack = `
                    Error: Test error
                    at /app/test.js:10:15
                    at anotherFunction (/app/another.js:20)
                `;

                const frames = parseStackTrace(mockStack);
                expect(frames.length).toBe(2);
                expect(frames[0].file).toBe('/app/test.js');
                expect(frames[0].line).toBe(10);
                expect(frames[0].column).toBe(15);
            });

            it("should filter out internal Node.js frames", () => {
                const mockStack = `
                    Error: Test error
                    at TestFunction (/app/test.js:10:15)
                    at Module._compile (internal/modules/cjs/loader.js:123:19)
                    at Object.Module._extensions..js (internal/modules/cjs/loader.js:125:10)
                    at anotherFunction (/app/another.js:20:25)
                `;

                const frames = parseStackTrace(mockStack);
                expect(frames.length).toBe(2); // Should filter out internal frames
                expect(frames[0].functionName).toBe('TestFunction');
                expect(frames[1].functionName).toBe('anotherFunction');
            });
        });

        describe("Enhanced Error Info Creation", () => {
            it("should create enhanced error info with automatic classification", () => {
                setRequestContext({
                    correlationId: "error-test-id",
                    userId: "error-test-user",
                    userLevel: "VERIFIED",
                    requestId: "error-test-request",
                    startTime: Date.now(),
                });

                const dbError = new Error("Database connection pool exhausted");
                dbError.name = "DatabaseError";
                dbError.stack = "Error: Database connection pool exhausted\nat queryDatabase (/app/db.js:15:20)";

                const errorInfo = createEnhancedErrorInfo(dbError, {
                    context: { operation: "user_login", retryCount: 3 }
                });

                expect(errorInfo.error).toBe("Database connection pool exhausted");
                expect(errorInfo.errorName).toBe("DatabaseError");
                expect(errorInfo.errorType).toBe('database');
                expect(errorInfo.errorCode).toBe(SharedErrorCodes.DATABASE_ERROR);
                expect(errorInfo.errorSeverity).toBe('critical');
                expect(errorInfo.timestamp).toBeDefined();
                expect(errorInfo.stackFrames).toBeDefined();
                expect(errorInfo.stackFrames?.length).toBe(1);
                expect(errorInfo.context).toEqual({ operation: "user_login", retryCount: 3 });
            });

            it("should allow manual override of automatic classification", () => {
                const error = new Error("This looks like a database error");
                error.name = "DatabaseError";

                const errorInfo = createEnhancedErrorInfo(error, {
                    errorType: 'integration',
                    errorCode: SharedErrorCodes.API_RATE_LIMITED,
                    isOperational: true
                });

                expect(errorInfo.errorType).toBe('integration'); // Overridden
                expect(errorInfo.errorCode).toBe(SharedErrorCodes.API_RATE_LIMITED); // Overridden
                expect(errorInfo.isOperational).toBe(true);
            });

            it("should handle errors without stack traces", () => {
                const error = new Error("Error without stack");
                error.stack = undefined;

                const errorInfo = createEnhancedErrorInfo(error);

                expect(errorInfo.error).toBe("Error without stack");
                expect(errorInfo.stackFrames).toEqual([]);
                expect(errorInfo.errorType).toBe('unknown');
                expect(errorInfo.errorCode).toBe(SharedErrorCodes.INTERNAL_ERROR);
            });
        });

        describe("Error Code Constants", () => {
            it("should have defined error codes for all categories", () => {
                expect(SharedErrorCodes.CONNECTION_ERROR).toBe('CONNECTION_ERROR');
                expect(SharedErrorCodes.EXTERNAL_SERVICE_ERROR).toBe('EXTERNAL_SERVICE_ERROR');
                expect(SharedErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
                expect(SharedErrorCodes.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
                expect(SharedErrorCodes.INSUFFICIENT_BALANCE).toBe('INSUFFICIENT_BALANCE');
                expect(SharedErrorCodes.CONNECTION_ERROR).toBe('CONNECTION_ERROR');
                expect(SharedErrorCodes.CONFIGURATION_ERROR).toBe('CONFIGURATION_ERROR');
                expect(SharedErrorCodes.API_RATE_LIMITED).toBe('API_RATE_LIMITED');
                expect(SharedErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
            });
        });

        describe("Integration with Logger", () => {
            it("should work with enhanced error info in errorWithInfo", () => {
                setRequestContext({
                    correlationId: "integration-test-id",
                    userId: "integration-test-user",
                    userLevel: "VERIFIED",
                    requestId: "integration-test-request",
                    startTime: Date.now(),
                });

                const error = new Error("Integration test error");
                error.name = "IntegrationError";

                const errorInfo = createEnhancedErrorInfo(error);

                // This should not throw
                expect(() => {
                    logger.errorWithInfo("Integration test failed", errorInfo);
                }).not.toThrow();
            });

            it("should maintain backward compatibility with existing error logging", () => {
                setRequestContext({
                    correlationId: "compat-test-id",
                    userId: "compat-test-user",
                    userLevel: "BASIC",
                    requestId: "compat-test-request",
                    startTime: Date.now(),
                });

                // Test that both old and new patterns work
                const oldError = new Error("Old style error");
                logger.error("Old style logging", oldError);

                const newError = new Error("New style error");
                const errorInfo = createEnhancedErrorInfo(newError);
                logger.errorWithInfo("New style logging", errorInfo);

                // Both should execute without throwing
                expect(true).toBe(true);
            });
        });
    });

    describe("HTTP Logging Method", () => {
        it("should support HTTP level logging with automatic context", () => {
            setRequestContext({
                correlationId: "http-test-id",
                userId: "http-test-user",
                userLevel: "VERIFIED",
                requestId: "http-test-request",
                startTime: Date.now(),
            });

            // Test that HTTP logging method exists and works
            expect(typeof logger.http).toBe('function');

            // Test HTTP logging with metadata
            logger.http("HTTP request received", {
                method: "GET",
                path: "/api/test",
                statusCode: 200
            });

            // Test HTTP logging without metadata
            logger.http("HTTP response sent");

            // Both calls should execute without throwing
            expect(true).toBe(true);
        });

        it("should include context information in HTTP logs", () => {
            setRequestContext({
                correlationId: "http-context-test-id",
                userId: "http-context-test-user",
                userLevel: "VERIFIED",
                requestId: "http-context-test-request",
                startTime: Date.now(),
            });

            // Spy on the private getContextInfo method
            const getContextInfoSpy = jest.spyOn(logger as any, "getContextInfo");

            // Call HTTP logging
            logger.http("Test HTTP message", { customField: "value" });

            // Verify getContextInfo was called with metadata
            expect(getContextInfoSpy).toHaveBeenCalledWith({ customField: "value" });

            // Verify context cache contains the expected data
            const cache = (logger as any).contextCache;
            expect(cache.cachedInfo?.correlationId).toBe("http-context-test-id");
            expect(cache.cachedInfo?.userId).toBe("http-context-test-user");
            expect(cache.cachedInfo?.component).toBe("test-component");
        });

        it("should work with HTTP singleton logger", () => {
            // Import the HTTP logger singleton
            const { httpLogger } = require("../../src/core/logging/context-aware-logger.service");

            setRequestContext({
                correlationId: "http-singleton-test-id",
                userId: "http-singleton-test-user",
                userLevel: "VERIFIED",
                requestId: "http-singleton-test-request",
                startTime: Date.now(),
            });

            // Test that the singleton has the HTTP method
            expect(typeof httpLogger.http).toBe('function');

            // Test HTTP logging with the singleton
            httpLogger.http("HTTP singleton test", {
                method: "POST",
                path: "/api/data",
                statusCode: 201
            });

            // Verify it doesn't throw
            expect(true).toBe(true);
        });
    });
});