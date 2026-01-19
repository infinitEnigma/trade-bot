/**
 * ===========================================
 * 🛡️ SCHEMA VALIDATION MIDDLEWARE
 * ===========================================
 *
 * Enterprise validation middleware that synchronizes Joi schemas with database.
 * Provides strict validation that matches database constraints exactly.
 *
 * RESPONSIBILITIES:
 * - Load database schema on startup
 * - Generate Joi schemas from database constraints
 * - Validate requests against database schema
 * - Include foreign key and relationship validation
 * - Reject unknown fields (fixes original issue)
 *
 * @format
 */

import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { createErrorResponse, ValidationError } from "../shared/types/errors";
import { getCorrelationId } from "../shared/utils/context";
import { DatabaseSchemaParser, DatabaseSchema } from "./database-schema-parser";
import { SchemaGenerator } from "./schema-generator";
import logger from "../services/logger";

export interface SchemaValidationOptions {
    // Table to validate against
    table: string;
    // Where to validate data from
    source?: 'body' | 'query' | 'params';
    // Whether to strip unknown fields (default: false for strict validation)
    stripUnknown?: boolean;
    // Custom error message prefix
    errorPrefix?: string;
    // Whether to validate foreign keys (requires database queries)
    validateForeignKeys?: boolean;
}

/**
 * Enterprise schema validation middleware
 * Validates requests against database schema constraints
 */
export class SchemaValidationMiddleware {
    private schemaCache: Map<string, Joi.ObjectSchema> = new Map();
    private dbSchema: DatabaseSchema | null = null;
    private schemaParser: DatabaseSchemaParser;
    private schemaGenerator: SchemaGenerator;

    constructor() {
        this.schemaParser = new DatabaseSchemaParser();
        this.schemaGenerator = new SchemaGenerator();

        // Initialize schema on construction
        this.initializeSchema().catch(error => {
            logger.error("Failed to initialize schema validation middleware", {
                error: (error as Error).message,
            });
        });
    }

    /**
     * Initialize database schema and generate validation schemas
     */
    private async initializeSchema(): Promise<void> {
        try {
            // Parse database schema from migrations
            this.dbSchema = await this.schemaParser.parseSchema();

            // Generate Joi schemas for all tables
            const allSchemas = this.schemaGenerator.generateAllSchemas(this.dbSchema);

            // Cache the schemas
            for (const [tableName, schema] of Object.entries(allSchemas)) {
                this.schemaCache.set(tableName, schema);
            }

            logger.info("Schema validation middleware initialized", {
                tablesValidated: this.schemaCache.size,
                totalTables: Object.keys(this.dbSchema.tables).length,
            });
        } catch (error) {
            logger.error("Schema validation middleware initialization failed", {
                error: (error as Error).message,
            });
            throw error;
        }
    }

    /**
     * Create validation middleware for a specific table
     */
    validateTable(options: SchemaValidationOptions) {
        const {
            table,
            source = 'body',
            stripUnknown = false, // Strict by default - reject unknown fields
            errorPrefix = `${table} validation failed`,
            validateForeignKeys = false,
        } = options;

        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            try {
                // Wait for schema to be initialized if not ready
                if (!this.dbSchema) {
                    await this.initializeSchema();
                }

                // Get the validation schema
                const joiSchema = this.schemaCache.get(table);
                if (!joiSchema) {
                    logger.error("No validation schema found for table", { table });
                    return next(); // Skip validation if schema not available
                }

                // Get data from specified source
                let dataToValidate: any;
                switch (source) {
                    case 'body':
                        dataToValidate = req.body;
                        break;
                    case 'query':
                        dataToValidate = req.query;
                        break;
                    case 'params':
                        dataToValidate = req.params;
                        break;
                    default:
                        dataToValidate = req.body;
                }

                // First validate against Joi schema
                const validationResult = joiSchema.validate(dataToValidate, {
                    abortEarly: false,
                    stripUnknown, // false = reject unknown fields (fixes original issue!)
                    allowUnknown: false, // Explicitly reject unknown fields
                });

                if (validationResult.error) {
                    // Log validation error with context
                    logger.warn(`${errorPrefix}: ${validationResult.error.details[0].message}`, {
                        table,
                        source,
                        errors: validationResult.error.details.map(detail => ({
                            field: detail.path.join('.'),
                            message: detail.message,
                            value: detail.context?.value,
                        })),
                        correlationId: getCorrelationId(),
                    });

                    // Create structured validation error
                    const validationError = new ValidationError(
                        `${errorPrefix}: ${validationResult.error.details[0].message}`
                    );

                    // Add detailed validation errors
                    const errorResponse = createErrorResponse(validationError, getCorrelationId()) as any;
                    errorResponse.details = {
                        table,
                        source,
                        validationType: 'database_schema',
                        errors: validationResult.error.details.map(detail => ({
                            field: detail.path.join('.'),
                            message: detail.message,
                            value: detail.context?.value,
                            constraint: this.getConstraintInfo(table, detail.path.join('.')),
                        })),
                    };

                    res.status(validationError.statusCode).json(errorResponse);
                    return;
                }

                // Validate foreign keys if requested
                if (validateForeignKeys && this.dbSchema) {
                    const fkErrors = await this.validateForeignKeys(table, validationResult.value);
                    if (fkErrors.length > 0) {
                        const fkError = new ValidationError('Foreign key validation failed');

                        const errorResponse = createErrorResponse(fkError, getCorrelationId()) as any;
                        errorResponse.details = {
                            table,
                            source,
                            validationType: 'foreign_keys',
                            errors: fkErrors,
                        };

                        res.status(fkError.statusCode).json(errorResponse);
                        return;
                    }
                }

                // Replace request data with validated/cleaned data
                switch (source) {
                    case 'body':
                        req.body = validationResult.value;
                        break;
                    case 'query':
                        req.query = validationResult.value;
                        break;
                    case 'params':
                        req.params = validationResult.value;
                        break;
                }

                next();
            } catch (error) {
                logger.error('Schema validation middleware error', {
                    table,
                    error: (error as Error).message,
                    source,
                    correlationId: getCorrelationId(),
                });

                const internalError = new ValidationError('Schema validation failed');
                res.status(internalError.statusCode).json(
                    createErrorResponse(internalError, getCorrelationId())
                );
            }
        };
    }

    /**
     * Validate foreign key constraints
     */
    private async validateForeignKeys(tableName: string, data: any): Promise<Array<{
        field: string;
        message: string;
        value?: any;
    }>> {
        if (!this.dbSchema) {
            return [];
        }

        const errors: Array<{
            field: string;
            message: string;
            value?: any;
        }> = [];

        const tableDef = this.dbSchema.tables[tableName];
        if (!tableDef) {
            return errors;
        }

        // Check each foreign key
        for (const [columnName, fkDef] of Object.entries(tableDef.foreignKeys)) {
            const foreignValue = data[columnName];
            if (foreignValue) {
                try {
                    const exists = await this.checkForeignKeyExists(
                        fkDef.referencedTable,
                        fkDef.referencedColumn,
                        foreignValue
                    );

                    if (!exists) {
                        errors.push({
                            field: columnName,
                            message: `${columnName} references non-existent ${fkDef.referencedTable} record`,
                            value: foreignValue,
                        });
                    }
                } catch (error) {
                    logger.warn("Foreign key validation query failed", {
                        table: fkDef.referencedTable,
                        column: fkDef.referencedColumn,
                        value: foreignValue,
                        error: (error as Error).message,
                    });

                    // Don't fail validation on query errors, just log
                    errors.push({
                        field: columnName,
                        message: `Unable to validate ${columnName} reference`,
                        value: foreignValue,
                    });
                }
            }
        }

        return errors;
    }

    /**
     * Check if a foreign key reference exists in the database
     */
    private async checkForeignKeyExists(table: string, column: string, value: any): Promise<boolean> {
        try {
            // Import database connection dynamically to avoid circular dependencies
            const { query } = await import("../database/pool.js");
            const result = await query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [value]);
            return result.rows.length > 0;
        } catch (error) {
            logger.error("Foreign key existence check failed", {
                table,
                column,
                value,
                error: (error as Error).message,
            });
            throw error;
        }
    }

    /**
     * Get constraint information for better error messages
     */
    private getConstraintInfo(tableName: string, fieldName: string): {
        type?: string;
        constraint?: string;
        allowedValues?: string[];
        required?: boolean;
    } | null {
        if (!this.dbSchema) {
            return null;
        }

        const tableDef = this.dbSchema.tables[tableName];
        if (!tableDef) {
            return null;
        }

        const columnDef = tableDef.columns[fieldName];
        if (!columnDef) {
            return null;
        }

        const constraint: any = {
            type: columnDef.type,
            required: columnDef.notNull,
        };

        if (columnDef.checkConstraint) {
            if (columnDef.checkConstraint.values) {
                constraint.constraint = 'enum';
                constraint.allowedValues = columnDef.checkConstraint.values;
            } else if (columnDef.checkConstraint.range) {
                constraint.constraint = 'range';
            } else if (columnDef.checkConstraint.pattern) {
                constraint.constraint = 'pattern';
            }
        }

        if (tableDef.foreignKeys[fieldName]) {
            constraint.constraint = 'foreign_key';
        }

        return constraint;
    }

    /**
     * Get available tables for validation
     */
    getAvailableTables(): string[] {
        return Array.from(this.schemaCache.keys());
    }

    /**
     * Check if schema is initialized
     */
    isInitialized(): boolean {
        return this.dbSchema !== null && this.schemaCache.size > 0;
    }

    /**
     * Force schema refresh (for development/testing)
     */
    async refreshSchema(): Promise<void> {
        this.schemaCache.clear();
        this.dbSchema = null;
        await this.initializeSchema();
    }

    /**
     * Get schema statistics
     */
    getSchemaStats() {
        if (!this.dbSchema) {
            return { initialized: false };
        }

        return {
            initialized: true,
            tablesValidated: this.schemaCache.size,
            totalTables: Object.keys(this.dbSchema.tables).length,
            relationships: Object.keys(this.dbSchema.relationships).length,
        };
    }
}

// Singleton instance
let schemaValidationMiddleware: SchemaValidationMiddleware;

/**
 * Get the schema validation middleware instance
 */
export function getSchemaValidationMiddleware(): SchemaValidationMiddleware {
    if (!schemaValidationMiddleware) {
        schemaValidationMiddleware = new SchemaValidationMiddleware();
    }
    return schemaValidationMiddleware;
}

/**
 * Create validation middleware for a table
 * Convenience function for the most common use case
 */
export function validateAgainstTable(tableName: string, options: Omit<SchemaValidationOptions, 'table'> = {}) {
    const middleware = getSchemaValidationMiddleware();
    return middleware.validateTable({ table: tableName, ...options });
}

/**
 * Pre-built validation middleware for common tables
 * These replace the old validators that didn't match database constraints
 */
export const databaseValidators = {
    // User validation - matches users table constraints
    user: validateAgainstTable('users', {
        errorPrefix: 'User validation failed'
    }),

    // Strategy validation - matches strategies table constraints
    strategy: validateAgainstTable('strategies', {
        errorPrefix: 'Strategy validation failed',
        validateForeignKeys: true, // Validate user_id exists
    }),

    // Bot validation - matches bot_instances table constraints
    bot: validateAgainstTable('bot_instances', {
        errorPrefix: 'Bot validation failed',
        validateForeignKeys: true, // Validate strategy_id and user_id exist
    }),

    // Trade validation - matches trades table constraints
    trade: validateAgainstTable('trades', {
        errorPrefix: 'Trade validation failed',
        validateForeignKeys: true, // Validate user_id, strategy_id, bot_id exist
    }),

    // Balance validation - matches kodiak_balances table constraints
    balance: validateAgainstTable('kodiak_balances', {
        errorPrefix: 'Balance validation failed',
        validateForeignKeys: true, // Validate user_id exists
    }),

    // Position validation - matches kodiak_positions table constraints
    position: validateAgainstTable('kodiak_positions', {
        errorPrefix: 'Position validation failed',
        validateForeignKeys: true, // Validate user_id exists
    }),
};

/**
 * Legacy validators for backward compatibility
 * These maintain the old API but use schema validation internally
 */
export const validators = {
    // Auth validators
    register: validateAgainstTable('users', {
        errorPrefix: 'Registration validation failed',
        source: 'body',
    }),

    login: validateAgainstTable('users', {
        errorPrefix: 'Login validation failed',
        source: 'body',
        // Only validate email/password fields for login
        stripUnknown: true, // Allow extra fields for login
    }),

    refreshToken: (req: Request, res: Response, next: NextFunction) => {
        // Simple token validation (doesn't need database schema)
        const schema = Joi.object({
            refreshToken: Joi.string().required().messages({
                'any.required': 'Refresh token is required',
            }),
        });

        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true,
        });

        if (error) {
            const validationError = new ValidationError('Token refresh validation failed');
            const errorResponse = createErrorResponse(validationError, getCorrelationId()) as any;
            errorResponse.details = {
                errors: error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                })),
            };
            return res.status(validationError.statusCode).json(errorResponse);
        }

        req.body = value;
        next();
    },

    startBot: validateAgainstTable('bot_instances', {
        errorPrefix: 'Bot start validation failed',
        source: 'body',
        validateForeignKeys: true,
    }),

    stopBot: validateAgainstTable('bot_instances', {
        errorPrefix: 'Bot stop validation failed',
        source: 'params',
        validateForeignKeys: false, // Params are typically validated separately
    }),

    idParam: validateAgainstTable('generic_id', {
        errorPrefix: 'ID parameter validation failed',
        source: 'params',
        stripUnknown: true,
    }),

    pagination: (req: Request, res: Response, next: NextFunction) => {
        // Simple pagination validation (doesn't need database schema)
        const schema = Joi.object({
            page: Joi.number().integer().min(1).default(1).messages({
                'number.min': 'Page must be at least 1',
            }),
            limit: Joi.number().integer().min(1).max(100).default(20).messages({
                'number.min': 'Limit must be at least 1',
                'number.max': 'Limit cannot exceed 100',
            }),
            sortBy: Joi.string().optional(),
            sortOrder: Joi.string().valid('asc', 'desc').default('desc').messages({
                'any.only': 'Sort order must be "asc" or "desc"',
            }),
        });

        const { error, value } = schema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
        });

        if (error) {
            const validationError = new ValidationError('Pagination validation failed');
            const errorResponse = createErrorResponse(validationError, getCorrelationId()) as any;
            errorResponse.details = {
                errors: error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                })),
            };
            return res.status(validationError.statusCode).json(errorResponse);
        }

        req.query = value;
        next();
    },
};

// Export legacy functions for backward compatibility
export { validateRequest } from '../middleware/validation';
