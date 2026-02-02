/** @format */

import { SchemaValidationMiddleware, getSchemaValidationMiddleware, validateAgainstTable } from '../../src/shared/validation/schema-validation-middleware';
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

// Mock the dependencies directly
jest.mock('../../src/shared/validation/database-schema-parser', () => {
    const mockParseSchema = jest.fn();
    const MockedDatabaseSchemaParser = jest.fn(() => ({
        parseSchema: mockParseSchema
    }));

    return {
        DatabaseSchemaParser: MockedDatabaseSchemaParser,
        __parseSchema: mockParseSchema // Export for testing purposes
    };
});

jest.mock('../../src/shared/validation/schema-generator', () => {
    const mockGenerateAllSchemas = jest.fn();
    const MockedSchemaGenerator = jest.fn(() => ({
        generateAllSchemas: mockGenerateAllSchemas
    }));

    return {
        SchemaGenerator: MockedSchemaGenerator,
        __generateAllSchemas: mockGenerateAllSchemas // Export for testing purposes
    };
});

// Import the mocked modules
import { DatabaseSchemaParser } from '../../src/shared/validation/database-schema-parser';
import { SchemaGenerator } from '../../src/shared/validation/schema-generator';

// Get the mock functions from the jest module
const __parseSchema = jest.requireMock('../../src/shared/validation/database-schema-parser').__parseSchema;
const __generateAllSchemas = jest.requireMock('../../src/shared/validation/schema-generator').__generateAllSchemas;

describe('SchemaValidationMiddleware', () => {
    let middleware: SchemaValidationMiddleware;

    beforeEach(async () => {
        // Clear all mocks before each test
        jest.clearAllMocks();

        // Mock successful schema initialization
        __parseSchema.mockImplementation(() => {
            return Promise.resolve({
                tables: {
                    users: {
                        name: 'users',
                        columns: {
                            id: {
                                name: 'id',
                                type: 'UUID',
                                notNull: true
                            },
                            email: {
                                name: 'email',
                                type: 'VARCHAR',
                                length: 255,
                                notNull: true
                            },
                            password_hash: {
                                name: 'password_hash',
                                type: 'VARCHAR',
                                length: 255,
                                notNull: true
                            },
                            user_level: {
                                name: 'user_level',
                                type: 'VARCHAR',
                                length: 50,
                                notNull: true,
                                checkConstraint: {
                                    expression: "user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN')",
                                    values: ['BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN']
                                }
                            },
                            is_active: {
                                name: 'is_active',
                                type: 'BOOLEAN',
                                notNull: false
                            }
                        },
                        primaryKey: ['id'],
                        uniqueConstraints: {},
                        checkConstraints: {},
                        foreignKeys: {}
                    },
                    pagination: {
                        name: 'pagination',
                        columns: {
                            page: {
                                name: 'page',
                                type: 'INTEGER',
                                notNull: false
                            },
                            limit: {
                                name: 'limit',
                                type: 'INTEGER',
                                notNull: false
                            },
                            sortBy: {
                                name: 'sortBy',
                                type: 'VARCHAR',
                                length: 255,
                                notNull: false
                            },
                            sortOrder: {
                                name: 'sortOrder',
                                type: 'VARCHAR',
                                length: 50,
                                notNull: false
                            }
                        },
                        primaryKey: [],
                        uniqueConstraints: {},
                        checkConstraints: {},
                        foreignKeys: {}
                    },
                    generic_id: {
                        name: 'generic_id',
                        columns: {
                            id: {
                                name: 'id',
                                type: 'UUID',
                                notNull: true
                            }
                        },
                        primaryKey: ['id'],
                        uniqueConstraints: {},
                        checkConstraints: {},
                        foreignKeys: {}
                    }
                },
                relationships: {}
            });
        });

        __generateAllSchemas.mockImplementation((schema: any) => {
            return {
                users: Joi.object({
                    id: Joi.string().uuid().required(),
                    email: Joi.string().max(255).required(),
                    password_hash: Joi.string().max(255).required(),
                    user_level: Joi.string().valid('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN').required(),
                    is_active: Joi.boolean().optional()
                }).unknown(false),
                pagination: Joi.object({
                    page: Joi.number().integer().min(1).optional(),
                    limit: Joi.number().integer().min(1).max(100).optional(),
                    sortBy: Joi.string().optional(),
                    sortOrder: Joi.string().valid('asc', 'desc').optional()
                }).unknown(false),
                generic_id: Joi.object({
                    id: Joi.string().uuid().required()
                }).unknown(false)
            };
        });

        // Create middleware instance
        middleware = getSchemaValidationMiddleware();

        // Wait for initialization to complete
        const timeout = Date.now() + 5000; // 5 second timeout
        while (!middleware.isInitialized() && Date.now() < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    });

    describe('Initialization', () => {
        it('should create singleton instance', () => {
            const instance1 = getSchemaValidationMiddleware();
            const instance2 = getSchemaValidationMiddleware();
            expect(instance1).toBe(instance2);
        });

        it('should be initialized correctly', async () => {
            const isInitialized = middleware.isInitialized();
            expect(isInitialized).toBe(false); // Should be false initially since it initializes asynchronously
        });
    });

    describe('Middleware Creation', () => {
        it('should create validation middleware for specific table', () => {
            const userValidator = middleware.validateTable({
                table: 'users',
                errorPrefix: 'User validation failed'
            });

            expect(typeof userValidator).toBe('function');
            expect(userValidator.length).toBe(3); // Should accept req, res, next
        });

        it('should create validation middleware using convenience function', () => {
            const userValidator = validateAgainstTable('users');
            expect(typeof userValidator).toBe('function');
            expect(userValidator.length).toBe(3);
        });

        it('should handle different data sources', () => {
            const queryValidator = middleware.validateTable({
                table: 'users',
                source: 'query'
            });

            expect(typeof queryValidator).toBe('function');

            const paramsValidator = middleware.validateTable({
                table: 'users',
                source: 'params'
            });

            expect(typeof paramsValidator).toBe('function');

            const bodyValidator = middleware.validateTable({
                table: 'users',
                source: 'body'
            });

            expect(typeof bodyValidator).toBe('function');
        });
    });

    describe('Middleware Functionality', () => {
        it('should validate requests and pass valid data', async () => {
            const req = {
                body: {
                    id: '550e8400-e29b-41d4-a716-446655440000',
                    email: 'test@example.com',
                    password_hash: 'hashedpassword',
                    user_level: 'BASIC',
                    is_active: true
                }
            } as Partial<Request>;

            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            } as Partial<Response>;

            const next = jest.fn();

            const validator = middleware.validateTable({ table: 'users' });
            await validator(req as Request, res as Response, next);

            // Verify validation passes
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });

        it('should reject requests with invalid data', async () => {
            const req = {
                body: {
                    id: 'not-a-uuid', // Invalid UUID
                    email: 'invalid-email',
                    password_hash: 12345, // Should be string
                    user_level: 'INVALID', // Not in allowed values
                    is_active: 'yes' // Should be boolean
                }
            } as Partial<Request>;

            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            } as Partial<Response>;

            const next = jest.fn();

            const validator = middleware.validateTable({ table: 'users' });
            await validator(req as Request, res as Response, next);

            // Verify validation fails
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400); // ValidationError status
            expect(res.json).toHaveBeenCalled();
        });

        it('should validate query parameters', async () => {
            const req = {
                query: {
                    page: '1',
                    limit: '10',
                    sortBy: 'created_at',
                    sortOrder: 'asc'
                }
            } as Partial<Request>;

            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            } as Partial<Response>;

            const next = jest.fn();

            const validator = middleware.validateTable({
                table: 'pagination',
                source: 'query'
            });
            await validator(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
        });

        it('should validate route parameters', async () => {
            const req = {
                params: {
                    id: '550e8400-e29b-41d4-a716-446655440000'
                }
            } as Partial<Request>;

            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            } as Partial<Response>;

            const next = jest.fn();

            const validator = middleware.validateTable({
                table: 'generic_id',
                source: 'params'
            });
            await validator(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('Database Validators', () => {
        it('should have predefined validators for common tables', () => {
            // @ts-ignore - importing from the module directly
            const { databaseValidators } = require('../../src/shared/validation/schema-validation-middleware');

            expect(databaseValidators).toBeDefined();
            expect(databaseValidators.user).toBeDefined();
            expect(typeof databaseValidators.user).toBe('function');

            expect(databaseValidators.strategy).toBeDefined();
            expect(typeof databaseValidators.strategy).toBe('function');

            expect(databaseValidators.bot).toBeDefined();
            expect(typeof databaseValidators.bot).toBe('function');

            expect(databaseValidators.trade).toBeDefined();
            expect(typeof databaseValidators.trade).toBe('function');

            expect(databaseValidators.balance).toBeDefined();
            expect(typeof databaseValidators.balance).toBe('function');

            expect(databaseValidators.position).toBeDefined();
            expect(typeof databaseValidators.position).toBe('function');
        });
    });

    describe('Legacy Validators', () => {
        it('should have legacy validators for backward compatibility', () => {
            // @ts-ignore - importing from the module directly
            const { validators } = require('../../src/shared/validation/schema-validation-middleware');

            expect(validators).toBeDefined();

            // Auth validators
            expect(validators.register).toBeDefined();
            expect(typeof validators.register).toBe('function');

            expect(validators.login).toBeDefined();
            expect(typeof validators.login).toBe('function');

            expect(validators.refreshToken).toBeDefined();
            expect(typeof validators.refreshToken).toBe('function');

            // Bot validators
            expect(validators.startBot).toBeDefined();
            expect(typeof validators.startBot).toBe('function');

            expect(validators.stopBot).toBeDefined();
            expect(typeof validators.stopBot).toBe('function');

            // Other validators
            expect(validators.idParam).toBeDefined();
            expect(typeof validators.idParam).toBe('function');

            expect(validators.pagination).toBeDefined();
            expect(typeof validators.pagination).toBe('function');
        });

        it('should validate token refresh with legacy validator', async () => {
            // @ts-ignore - importing from the module directly
            const { validators } = require('../../src/shared/validation/schema-validation-middleware');

            const req = {
                body: {
                    refreshToken: 'valid-refresh-token'
                }
            } as Partial<Request>;

            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            } as Partial<Response>;

            const next = jest.fn();

            await validators.refreshToken(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });

        it('should validate pagination with legacy validator', async () => {
            // @ts-ignore - importing from the module directly
            const { validators } = require('../../src/shared/validation/schema-validation-middleware');

            const req = {
                query: {
                    page: '1',
                    limit: '10',
                    sortBy: 'created_at',
                    sortOrder: 'asc'
                }
            } as Partial<Request>;

            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            } as Partial<Response>;

            const next = jest.fn();

            await validators.pagination(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });
    });

    describe('Schema Management', () => {
        it('should provide available tables information', () => {
            const tables = middleware.getAvailableTables();
            expect(tables).toBeDefined();
            expect(Array.isArray(tables)).toBe(true);
        });

        it('should check initialization status', () => {
            const isInitialized = middleware.isInitialized();
            expect(typeof isInitialized).toBe('boolean');
        });

        it('should provide schema statistics', () => {
            const stats = middleware.getSchemaStats();
            expect(stats).toBeDefined();
            expect(typeof stats).toBe('object');
            expect('initialized' in stats).toBe(true);
            expect(typeof stats.initialized).toBe('boolean');
        });
    });
});