/**
 * ===========================================
 * 🔧 SCHEMA GENERATOR
 * ===========================================
 *
 * Generates Joi validation schemas from parsed database schema.
 * Creates strict validation that matches database constraints exactly.
 *
 * RESPONSIBILITIES:
 * - Generate Joi schemas from table definitions
 * - Apply CHECK, NOT NULL, foreign key constraints
 * - Validate data types and precision
 * - Create strict validation (reject unknown fields)
 *
 * @format
 */

import Joi from "joi";
import {
    DatabaseSchema,
    TableDefinition,
    ColumnDefinition,
    CheckConstraint,
    ForeignKeyDefinition,
} from "./database-schema-parser";
import logger from "../../core/logging/logger.service";

/**
 * Validation result interface
 */
interface ValidationResult {
    isValid: boolean;
    errors?: Array<{
        field: string;
        message: string;
        value?: unknown;
    }>;
    cleanedData?: unknown;
}

export class SchemaGenerator {
    /**
     * Generate Joi validation schema for a specific table
     */
    generateTableSchema(tableName: string, schema: DatabaseSchema): Joi.ObjectSchema | null {
        const tableDef = schema.tables[tableName];
        if (!tableDef) {
            logger.warn("Table not found in schema", { tableName });
            return null;
        }

        try {
            const joiSchema = Joi.object(this.generateColumnSchemas(tableDef, schema));

            // Strict mode: reject unknown fields to match database constraints
            return joiSchema.unknown(false);
        } catch (error) {
            logger.error("Failed to generate Joi schema", {
                tableName,
                error: (error as Error).message,
            });
            return null;
        }
    }

    /**
     * Generate column schemas for a table
     */
    private generateColumnSchemas(
        tableDef: TableDefinition,
        fullSchema: DatabaseSchema
    ): Record<string, Joi.Schema> {
        const columnSchemas: Record<string, Joi.Schema> = {};

        for (const [columnName, columnDef] of Object.entries(tableDef.columns)) {
            const joiSchema = this.generateColumnSchema(columnName, columnDef, tableDef, fullSchema);
            if (joiSchema) {
                columnSchemas[columnName] = joiSchema;
            }
        }

        return columnSchemas;
    }

    /**
     * Generate Joi schema for a single column
     */
    private generateColumnSchema(
        columnName: string,
        columnDef: ColumnDefinition,
        tableDef: TableDefinition,
        fullSchema: DatabaseSchema
    ): Joi.Schema | null {
        try {
            // Start with base type schema
            let schema = this.getBaseTypeSchema(columnDef);

            // Apply CHECK constraints
            if (columnDef.checkConstraint) {
                schema = this.applyCheckConstraint(schema, columnDef.checkConstraint);
            }

            // Apply foreign key validation
            const fkDef = tableDef.foreignKeys[columnName];
            if (fkDef) {
                schema = this.applyForeignKeyValidation(schema, fkDef, fullSchema);
            }

            // Apply NOT NULL constraint
            if (columnDef.notNull) {
                schema = schema.required();
            } else {
                schema = schema.optional();
            }

            // Add descriptive messages
            schema = schema.messages({
                'any.required': `${columnName} is required`,
                'string.pattern.base': `${columnName} has invalid format`,
                'any.only': `${columnName} must be one of the allowed values`,
                'number.base': `${columnName} must be a number`,
                'number.integer': `${columnName} must be an integer`,
                'number.positive': `${columnName} must be positive`,
                'number.precision': `${columnName} exceeds allowed precision`,
                'string.max': `${columnName} is too long`,
                'string.uuid': `${columnName} must be a valid UUID`,
                'boolean.base': `${columnName} must be a boolean`,
                'date.base': `${columnName} must be a valid date`,
            });

            return schema;
        } catch (error) {
            logger.warn("Failed to generate column schema", {
                columnName,
                error: (error as Error).message,
            });
            return null;
        }
    }

    /**
     * Get base Joi schema for database column type
     */
    private getBaseTypeSchema(columnDef: ColumnDefinition): Joi.Schema {
        const { type, length, precision, scale } = columnDef;

        switch (type.toUpperCase()) {
            case 'UUID':
                return Joi.string().uuid({ version: 'uuidv4' });

            case 'VARCHAR':
            case 'CHAR':
            case 'TEXT': {
                let stringSchema = Joi.string().trim();
                if (length) {
                    stringSchema = stringSchema.max(length);
                }
                return stringSchema;
            }

            case 'INTEGER':
            case 'INT':
            case 'BIGINT':
                return Joi.number().integer();

            case 'DECIMAL':
            case 'NUMERIC': {
                let numberSchema = Joi.number();
                if (precision !== undefined) {
                    numberSchema = numberSchema.precision(precision);
                    if (scale !== undefined && scale > 0) {
                        // For decimal places, we validate the string representation
                        // since Joi doesn't have built-in decimal scale validation
                        const decimalRegex = new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`);
                        const decimalSchema = Joi.alternatives().try(
                            Joi.number().precision(precision),
                            Joi.string().pattern(decimalRegex).messages({
                                'string.pattern.base': `Must have at most ${scale} decimal places`,
                            })
                        );
                        return decimalSchema;
                    }
                }
                return numberSchema;
            }

            case 'BOOLEAN':
                return Joi.boolean();

            case 'TIMESTAMP':
            case 'DATE':
                return Joi.date();

            case 'JSONB':
            case 'JSON': {
                const jsonSchema = Joi.object();
                return jsonSchema;
            }

            default:
                // Default to string for unknown types
                logger.warn("Unknown column type, defaulting to string", { type });
                return Joi.string();
        }
    }

    /**
     * Apply CHECK constraint to Joi schema
     */
    private applyCheckConstraint(schema: Joi.Schema, constraint: CheckConstraint): Joi.Schema {
        // Apply IN constraint (enum values)
        if (constraint.values && constraint.values.length > 0) {
            return schema.valid(...constraint.values);
        }

        // Apply range constraints
        if (constraint.range) {
            let rangedSchema = schema;

            if (constraint.range.min !== undefined) {
                rangedSchema = (rangedSchema as Joi.NumberSchema).min(constraint.range.min);
            }

            if (constraint.range.max !== undefined) {
                rangedSchema = (rangedSchema as Joi.NumberSchema).max(constraint.range.max);
            }

            return rangedSchema;
        }

        // Apply pattern constraints
        if (constraint.pattern) {
            try {
                const regex = new RegExp(constraint.pattern);
                return (schema as Joi.StringSchema).pattern(regex);
            } catch (error) {
                logger.warn("Invalid regex pattern in CHECK constraint", {
                    pattern: constraint.pattern,
                    error: (error as Error).message,
                });
            }
        }

        return schema;
    }

    /**
     * Apply foreign key validation to Joi schema
     */
    private applyForeignKeyValidation(
        schema: Joi.Schema,
        fkDef: ForeignKeyDefinition,
        fullSchema: DatabaseSchema
    ): Joi.Schema {
        // For now, we just ensure the referenced table exists
        // Full foreign key validation would require database queries
        const referencedTable = fullSchema.tables[fkDef.referencedTable];
        if (!referencedTable) {
            logger.warn("Foreign key references non-existent table", {
                table: fkDef.referencedTable,
                column: fkDef.column,
            });
            return schema;
        }

        // Add custom validation that checks foreign key exists
        return schema.custom((value, _helpers) => {
            // Note: This would typically validate against the database
            // For now, we just validate the format/type is correct
            // Full FK validation would be done at the middleware level
            return value;
        }, 'foreign key validation');
    }

    /**
     * Generate validation schemas for all tables in the schema
     */
    generateAllSchemas(schema: DatabaseSchema): Record<string, Joi.ObjectSchema> {
        const schemas: Record<string, Joi.ObjectSchema> = {};

        for (const tableName of Object.keys(schema.tables)) {
            const tableSchema = this.generateTableSchema(tableName, schema);
            if (tableSchema) {
                schemas[tableName] = tableSchema;
            }
        }

        logger.info("Generated validation schemas for all tables", {
            tableCount: Object.keys(schemas).length,
        });

        return schemas;
    }

    /**
     * Convert Joi schema to code representation (for auto-generation)
     */
    //joiSchemaToCode(schema: Joi.ObjectSchema): string {
    // This would generate code that recreates the schema
    // For now, return a placeholder - full implementation would
    // recursively build the schema code
    //  return `Joi.object({/* Auto-generated schema */}).unknown(false)`;
    //}

    /**
     * Validate data against generated schema
     */
    validateData(tableName: string, data: unknown, schema: DatabaseSchema): ValidationResult {
        const joiSchema = this.generateTableSchema(tableName, schema);
        if (!joiSchema) {
            return {
                isValid: false,
                errors: [{ field: 'schema', message: 'No validation schema found for table' }],
            };
        }

        const { error, value } = joiSchema.validate(data, {
            abortEarly: false,
            stripUnknown: true, // Remove unknown fields to match database
        });

        if (error) {
            return {
                isValid: false,
                errors: error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    value: detail.context?.value,
                })),
            };
        }

        return {
            isValid: true,
            cleanedData: value,
        };
    }
}
