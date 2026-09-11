/** @format */

import { LoggerAdapter, loggerAdapter } from "../../src/infrastructure/adapters/logger/logger.adapter";
import { ContextAwareLogger } from "../../src/core/logging/context-aware-logger.service";

// Mock the ContextAwareLogger
jest.mock("../../src/core/logging/context-aware-logger.service", () => {
    const original = jest.requireActual("../../src/core/logging/context-aware-logger.service");

    // Create a mock ContextAwareLogger class
    class MockContextAwareLogger {
        info = jest.fn();
        error = jest.fn();
        warn = jest.fn();
        debug = jest.fn();
        errorWithInfo = jest.fn();
        startOperation = jest.fn();
        http = jest.fn();
        performance = jest.fn();
        child = jest.fn();
    }

    return {
        ...original,
        ContextAwareLogger: MockContextAwareLogger
    };
});

describe("LoggerAdapter", () => {
    describe("Initialization", () => {
        it("should create a LoggerAdapter instance", () => {
            const adapter = new LoggerAdapter();
            expect(adapter).toBeInstanceOf(LoggerAdapter);
        });

        it("should create a LoggerAdapter instance with component name", () => {
            const componentName = "test-component";
            const adapter = new LoggerAdapter(componentName);
            expect(adapter).toBeInstanceOf(LoggerAdapter);

            // Verify the contextAwareLogger was created with the component name
            expect((adapter as any).contextAwareLogger).toBeDefined();
        });

        it("should export a singleton instance", () => {
            expect(loggerAdapter).toBeInstanceOf(LoggerAdapter);
        });
    });

    describe("Logging Methods", () => {
        let adapter: LoggerAdapter;
        let contextAwareLogger: any;

        beforeEach(() => {
            adapter = new LoggerAdapter("test-component");
            contextAwareLogger = (adapter as any).contextAwareLogger;
        });

        describe("Debug Level Logging", () => {
            it("should log debug messages without metadata", () => {
                const message = "Debug message";
                adapter.debug(message);

                expect(contextAwareLogger.debug).toHaveBeenCalledWith(
                    message,
                    expect.objectContaining({})
                );
            });

            it("should log debug messages with metadata", () => {
                const message = "Debug message";
                const meta = { key: "value", number: 123 };
                adapter.debug(message, meta);

                expect(contextAwareLogger.debug).toHaveBeenCalledWith(
                    message,
                    expect.objectContaining(meta)
                );
            });
        });

        describe("Info Level Logging", () => {
            it("should log info messages without metadata", () => {
                const message = "Info message";
                adapter.info(message);

                expect(contextAwareLogger.info).toHaveBeenCalledWith(
                    message,
                    expect.objectContaining({})
                );
            });

            it("should log info messages with metadata", () => {
                const message = "Info message";
                const meta = { key: "value", number: 123 };
                adapter.info(message, meta);

                expect(contextAwareLogger.info).toHaveBeenCalledWith(
                    message,
                    expect.objectContaining(meta)
                );
            });
        });

        describe("Warn Level Logging", () => {
            it("should log warn messages without metadata", () => {
                const message = "Warn message";
                adapter.warn(message);

                expect(contextAwareLogger.warn).toHaveBeenCalledWith(
                    message,
                    expect.objectContaining({})
                );
            });

            it("should log warn messages with metadata", () => {
                const message = "Warn message";
                const meta = { key: "value", number: 123 };
                adapter.warn(message, meta);

                expect(contextAwareLogger.warn).toHaveBeenCalledWith(
                    message,
                    expect.objectContaining(meta)
                );
            });
        });

        describe("Error Level Logging", () => {
            it("should log error messages without metadata", () => {
                const message = "Error message";
                adapter.error(message);

                expect(contextAwareLogger.error).toHaveBeenCalledWith(
                    message,
                    undefined,
                    expect.objectContaining({})
                );
            });

            it("should log error messages with metadata", () => {
                const message = "Error message";
                const meta = { key: "value", number: 123 };
                adapter.error(message, meta);

                expect(contextAwareLogger.error).toHaveBeenCalledWith(
                    message,
                    undefined,
                    expect.objectContaining(meta)
                );
            });

            it("should log error objects with errorWithInfo", () => {
                const message = "Error message";
                const testError = new Error("Test error");
                const meta = { error: testError, details: "Additional details" };
                adapter.error(message, meta);

                expect(contextAwareLogger.errorWithInfo).toHaveBeenCalled();
                expect(contextAwareLogger.errorWithInfo.mock.calls[0][0]).toBe(message);
                expect(contextAwareLogger.errorWithInfo.mock.calls[0][2]).toEqual(
                    expect.objectContaining({
                        error: testError,
                        details: "Additional details",
                        errorInfo: expect.any(Object)
                    })
                );
            });

            it("should log error strings with errorWithInfo", () => {
                const message = "Error message";
                const errorString = "Test error string";
                const meta = { error: errorString, details: "Additional details" };
                adapter.error(message, meta);

                expect(contextAwareLogger.errorWithInfo).toHaveBeenCalled();
                expect(contextAwareLogger.errorWithInfo.mock.calls[0][0]).toBe(message);
                expect(contextAwareLogger.errorWithInfo.mock.calls[0][2]).toEqual(
                    expect.objectContaining({
                        error: errorString,
                        details: "Additional details",
                        errorInfo: expect.any(Object)
                    })
                );
            });
        });
    });

    describe("Child Logger Creation", () => {
        it("should create child loggers with additional context", () => {
            const adapter = new LoggerAdapter("parent");
            const additionalContext = { userId: "123", sessionId: "abc" };

            const child = adapter.child(additionalContext);

            expect(child).toBeInstanceOf(LoggerAdapter);
            expect((child as any).context).toEqual(expect.objectContaining(additionalContext));
        });

        it("should inherit parent context when creating child loggers", () => {
            const adapter = new LoggerAdapter("parent");
            (adapter as any).context = { correlationId: "parent-correlation-id" };
            const additionalContext = { userId: "123" };

            const child = adapter.child(additionalContext);

            expect((child as any).context).toEqual(expect.objectContaining({
                correlationId: "parent-correlation-id",
                userId: "123"
            }));
        });

        it("should create separate child loggers with different contexts", () => {
            const adapter = new LoggerAdapter("parent");

            const child1 = adapter.child({ userId: "123" });
            const child2 = adapter.child({ userId: "456" });

            expect((child1 as any).context).toEqual(expect.objectContaining({ userId: "123" }));
            expect((child2 as any).context).toEqual(expect.objectContaining({ userId: "456" }));
            expect((child1 as any).context).not.toEqual((child2 as any).context);
        });
    });

    describe("Performance Tracking", () => {
        it("should start operations with operation timer", () => {
            const adapter = new LoggerAdapter("test-component");
            const operationName = "test-operation";
            const meta = { key: "value" };
            const mockTimer = {
                success: jest.fn(),
                failure: jest.fn(),
                getElapsed: jest.fn()
            };

            (adapter as any).contextAwareLogger.startOperation.mockReturnValue(mockTimer);

            const timer = adapter.startOperation(operationName, meta);

            expect((adapter as any).contextAwareLogger.startOperation).toHaveBeenCalledWith(
                operationName,
                expect.objectContaining(meta)
            );
            expect(timer).toBeDefined();
            expect(timer).toEqual(mockTimer);
        });
    });

    describe("Context Management", () => {
        it("should merge existing context with new metadata", () => {
            const adapter = new LoggerAdapter("test-component");
            (adapter as any).context = { correlationId: "test-correlation-id" };
            const meta = { userId: "123" };

            adapter.info("Test message", meta);

            expect((adapter as any).contextAwareLogger.info).toHaveBeenCalledWith(
                "Test message",
                expect.objectContaining({
                    correlationId: "test-correlation-id",
                    userId: "123"
                })
            );
        });

        it("should maintain context across log calls", () => {
            const adapter = new LoggerAdapter("test-component");
            (adapter as any).context = { correlationId: "test-correlation-id" };

            adapter.info("First message");
            adapter.info("Second message");

            expect((adapter as any).contextAwareLogger.info).toHaveBeenCalledWith(
                "First message",
                expect.objectContaining({ correlationId: "test-correlation-id" })
            );
            expect((adapter as any).contextAwareLogger.info).toHaveBeenCalledWith(
                "Second message",
                expect.objectContaining({ correlationId: "test-correlation-id" })
            );
        });
    });
});