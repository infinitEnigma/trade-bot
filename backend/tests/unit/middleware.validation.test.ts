/** @format */

import { validateRequest, commonSchemas, validators } from "../../src/interfaces/middleware/validation";
import Joi from "joi";

describe("Validation Middleware", () => {
    describe("Common Schemas", () => {
        describe("email schema", () => {
            it("should validate valid email addresses", () => {
                const validEmails = [
                    "test@example.com",
                    "user.name+tag@example.co.uk",
                    "user-name@example.org"
                ];

                validEmails.forEach(email => {
                    const result = commonSchemas.email.validate(email);
                    expect(result.error).toBeUndefined();
                });
            });

            it("should reject invalid email addresses", () => {
                const invalidEmails = [
                    "test@example",
                    "user@.com",
                    "@example.com",
                    "test@example..com"
                ];

                invalidEmails.forEach(email => {
                    const result = commonSchemas.email.validate(email);
                    expect(result.error).toBeDefined();
                });
            });
        });

        describe("password schema", () => {
            it("should validate valid passwords", () => {
                const validPasswords = [
                    "Password123",
                    "StrongP@ssw0rd",
                    "Test123!@#"
                ];

                validPasswords.forEach(password => {
                    const result = commonSchemas.password.validate(password);
                    expect(result.error).toBeUndefined();
                });
            });

            it("should reject weak passwords", () => {
                const weakPasswords = [
                    "password",
                    "123456",
                    "Password",
                    "password123",
                    "PASS123"
                ];

                weakPasswords.forEach(password => {
                    const result = commonSchemas.password.validate(password);
                    expect(result.error).toBeDefined();
                });
            });
        });

        describe("uuid schema", () => {
            it("should validate valid UUIDs", () => {
                const validUUID = "550e8400-e29b-41d4-a716-446655440000";
                const result = commonSchemas.uuid.validate(validUUID);
                expect(result.error).toBeUndefined();
            });

            it("should reject invalid UUIDs", () => {
                const invalidUUID = "not-a-valid-uuid";
                const result = commonSchemas.uuid.validate(invalidUUID);
                expect(result.error).toBeDefined();
            });
        });

        describe("positiveInteger schema", () => {
            it("should validate positive integers", () => {
                const validNumbers = [1, 10, 100];
                validNumbers.forEach(number => {
                    const result = commonSchemas.positiveInteger.validate(number);
                    expect(result.error).toBeUndefined();
                });
            });

            it("should reject negative numbers or non-integers", () => {
                const invalidNumbers = [0, -1, 1.5, "not-a-number"];
                invalidNumbers.forEach(number => {
                    const result = commonSchemas.positiveInteger.validate(number);
                    expect(result.error).toBeDefined();
                });
            });
        });

        describe("string schema", () => {
            it("should validate strings within length limits", () => {
                const schema = commonSchemas.string(2, 5);
                expect(schema.validate("abc").error).toBeUndefined();
                expect(schema.validate("a").error).toBeDefined();
                expect(schema.validate("abcdef").error).toBeDefined();
            });
        });
    });

    describe("validateRequest Middleware", () => {
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            req = {
                body: {},
                query: {},
                params: {}
            };

            res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            next = jest.fn();
        });

        it("should validate request body with default options", () => {
            const schema = Joi.object({
                email: commonSchemas.email,
                password: commonSchemas.password
            });

            req.body = {
                email: "test@example.com",
                password: "Password123"
            };

            const middleware = validateRequest(schema);
            middleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });

        it("should validate query parameters", () => {
            const schema = Joi.object({
                page: commonSchemas.positiveInteger,
                limit: commonSchemas.positiveInteger
            });

            req.query = {
                page: "1",
                limit: "10"
            };

            const middleware = validateRequest(schema, { source: "query" });
            middleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
        });

        it("should validate route parameters", () => {
            const schema = Joi.object({
                id: commonSchemas.uuid
            });

            req.params = {
                id: "550e8400-e29b-41d4-a716-446655440000"
            };

            const middleware = validateRequest(schema, { source: "params" });
            middleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
        });

        it("should strip unknown fields when configured", () => {
            const schema = Joi.object({
                email: commonSchemas.email
            });

            req.body = {
                email: "test@example.com",
                unknownField: "value"
            };

            const middleware = validateRequest(schema, { stripUnknown: true });
            middleware(req, res, next);

            expect(req.body).toEqual({ email: "test@example.com" });
            expect(next).toHaveBeenCalledTimes(1);
        });

        it("should return validation errors with details", () => {
            const schema = Joi.object({
                email: commonSchemas.email,
                password: commonSchemas.password
            });

            req.body = {
                email: "invalid-email",
                password: "weak"
            };

            const middleware = validateRequest(schema);
            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.any(String),
                    details: expect.objectContaining({
                        errors: expect.arrayContaining([
                            expect.objectContaining({ field: "email" }),
                            expect.objectContaining({ field: "password" })
                        ])
                    })
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        it("should handle unexpected validation errors", () => {
            // Mock console.error to avoid logging during test
            const originalError = console.error;
            console.error = jest.fn();

            // Create a local mock for logger.warn
            const logger = require("../../src/core/logging").logger;
            const originalWarn = logger.warn;
            logger.warn = jest.fn(() => {
                throw new Error("Unexpected error in logger");
            });

            const schema = Joi.object({
                email: commonSchemas.email
            });

            req.body = {
                email: "invalid-email"
            };

            const middleware = validateRequest(schema);

            expect(() => middleware(req, res, next)).not.toThrow();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining("Request validation failed")
                })
            );
            expect(next).not.toHaveBeenCalled();

            // Restore original implementations
            logger.warn = originalWarn;
            console.error = originalError;
        });
    });

    describe("Pre-built Validators", () => {
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            req = {
                body: {},
                query: {},
                params: {}
            };

            res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            next = jest.fn();
        });

        describe("Auth Validators", () => {
            it("should validate registration data", () => {
                req.body = {
                    email: "test@example.com",
                    password: "Password123"
                };

                validators.register(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);
            });

            it("should validate login data", () => {
                req.body = {
                    email: "test@example.com",
                    password: "Password123"
                };

                validators.login(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);
            });

            it("should validate refresh token", () => {
                req.body = {
                    refreshToken: "valid-refresh-token"
                };

                validators.refreshToken(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);
            });
        });

        describe("Bot Validators", () => {
            it("should validate start bot data", () => {
                req.body = {
                    strategyId: "550e8400-e29b-41d4-a716-446655440000",
                    notionalAmount: 100
                };

                validators.startBot(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);
            });

            it("should validate stop bot data", () => {
                req.body = {
                    botId: "550e8400-e29b-41d4-a716-446655440000"
                };

                validators.stopBot(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);
            });
        });

        describe("Parameter Validators", () => {
            it("should validate ID parameter", () => {
                req.params = {
                    id: "550e8400-e29b-41d4-a716-446655440000"
                };

                validators.idParam(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);
            });

            it("should validate pagination parameters", () => {
                req.query = {
                    page: "1",
                    limit: "10",
                    sortBy: "created_at",
                    sortOrder: "asc"
                };

                validators.pagination(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);
            });
        });
    });
});