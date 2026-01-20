/**
 * ===========================================
 * 🗄️ DATABASE SCHEMA PARSER
 * ===========================================
 *
 * Parses database migration files to extract table definitions,
 * constraints, and relationships for validation schema generation.
 *
 * RESPONSIBILITIES:
 * - Parse SQL migration files
 * - Extract table definitions and column types
 * - Extract CHECK, NOT NULL, UNIQUE constraints
 * - Extract foreign key relationships
 * - Provide structured schema data for validation
 *
 * @format
 */

import fs from "fs/promises";
import path from "path";
import logger from "../../core/logging/logger.service";

export interface ColumnDefinition {
    name: string;
    type: string;
    length?: number;
    precision?: number;
    scale?: number;
    notNull: boolean;
    defaultValue?: string;
    checkConstraint?: CheckConstraint;
}

export interface CheckConstraint {
    expression: string;
    values?: string[]; // For IN constraints
    pattern?: string;  // For LIKE/pattern constraints
    range?: {
        min?: number;
        max?: number;
    };
}

export interface TableDefinition {
    name: string;
    columns: Record<string, ColumnDefinition>;
    primaryKey?: string[];
    uniqueConstraints: Record<string, string[]>;
    checkConstraints: Record<string, CheckConstraint>;
    foreignKeys: Record<string, ForeignKeyDefinition>;
}

export interface ForeignKeyDefinition {
    column: string;
    referencedTable: string;
    referencedColumn: string;
    onDelete?: string;
    onUpdate?: string;
}

export interface DatabaseSchema {
    tables: Record<string, TableDefinition>;
    relationships: Record<string, Record<string, string>>; // table -> column -> referencedTable
}

export class DatabaseSchemaParser {
    private migrationDir = path.join(process.cwd(), "database", "migrations");

    /**
     * Parse all migration files to build complete database schema
     */
    async parseSchema(): Promise<DatabaseSchema> {
        try {
            const migrationFiles = await this.getMigrationFiles();
            const schema: DatabaseSchema = {
                tables: {},
                relationships: {},
            };

            for (const file of migrationFiles) {
                const content = await fs.readFile(file, "utf8");
                const fileSchema = this.parseMigrationFile(content);
                this.mergeSchemas(schema, fileSchema);
            }

            logger.info("Database schema parsed successfully", {
                tablesFound: Object.keys(schema.tables).length,
                migrationFiles: migrationFiles.length,
            });

            return schema;
        } catch (error) {
            logger.error("Failed to parse database schema", {
                error: (error as Error).message,
            });
            throw error;
        }
    }

    /**
     * Get all migration files in order
     */
    private async getMigrationFiles(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.migrationDir);
            const sqlFiles = files
                .filter(file => file.endsWith('.sql'))
                .sort(); // Sort to ensure proper order

            return sqlFiles.map(file => path.join(this.migrationDir, file));
        } catch (error) {
            logger.error("Failed to read migration directory", {
                directory: this.migrationDir,
                error: (error as Error).message,
            });
            throw error;
        }
    }

    /**
     * Parse a single migration file
     */
    private parseMigrationFile(content: string): DatabaseSchema {
        const schema: DatabaseSchema = {
            tables: {},
            relationships: {},
        };

        // Split content into individual statements
        const statements = this.splitSqlStatements(content);

        for (const statement of statements) {
            const trimmed = statement.trim();

            if (trimmed.startsWith('CREATE TABLE')) {
                const tableDef = this.parseCreateTableStatement(trimmed);
                if (tableDef) {
                    schema.tables[tableDef.name] = tableDef;
                }
            } else if (trimmed.startsWith('ALTER TABLE')) {
                this.parseAlterTableStatement(trimmed, schema);
            }
        }

        return schema;
    }

    /**
     * Parse CREATE TABLE statement
     */
    private parseCreateTableStatement(statement: string): TableDefinition | null {
        try {
            // Match CREATE TABLE [IF NOT EXISTS] table_name (columns...)
            const createTableRegex = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["`]?(\w+)["`]?\s*\(([\s\S]*?)\);?/i;
            const match = statement.match(createTableRegex);

            if (!match) {
                return null;
            }

            const tableName = match[1];
            const columnsDefinition = match[2];

            const columns = this.parseColumnDefinitions(columnsDefinition);
            const constraints = this.extractTableConstraints(columnsDefinition);

            return {
                name: tableName,
                columns,
                uniqueConstraints: constraints.unique,
                checkConstraints: constraints.check,
                foreignKeys: constraints.foreignKeys,
            };
        } catch (error) {
            logger.warn("Failed to parse CREATE TABLE statement", {
                statement: statement.substring(0, 100),
                error: (error as Error).message,
            });
            return null;
        }
    }

    /**
     * Parse column definitions from CREATE TABLE
     */
    private parseColumnDefinitions(columnsDef: string): Record<string, ColumnDefinition> {
        const columns: Record<string, ColumnDefinition> = {};
        const columnRegex = /["`]?(\w+)["`]?\s+([^,\n]+(?:\([^)]*\))?)[\s,]/gi;

        let match;
        while ((match = columnRegex.exec(columnsDef)) !== null) {
            const columnName = match[1];
            const columnType = match[2].trim();

            const columnDef = this.parseColumnType(columnName, columnType);
            columns[columnName] = columnDef;
        }

        return columns;
    }

    /**
     * Parse individual column type definition
     */
    private parseColumnType(name: string, typeDef: string): ColumnDefinition {
        const parts = typeDef.split(/\s+/);
        const type = parts[0].toUpperCase();

        const definition: ColumnDefinition = {
            name,
            type,
            notNull: false,
        };

        // Parse type parameters (e.g., VARCHAR(255), DECIMAL(20,8))
        if (type.includes('(')) {
            const typeMatch = type.match(/^(\w+)\(([^)]+)\)$/);
            if (typeMatch) {
                definition.type = typeMatch[1];

                if (definition.type === 'DECIMAL' || definition.type === 'NUMERIC') {
                    const [precision, scale] = typeMatch[2].split(',').map(Number);
                    definition.precision = precision;
                    definition.scale = scale || 0;
                } else {
                    definition.length = parseInt(typeMatch[2]);
                }
            }
        }

        // Check for NOT NULL
        definition.notNull = parts.includes('NOT') && parts.includes('NULL');

        // Check for DEFAULT
        const defaultIndex = parts.indexOf('DEFAULT');
        if (defaultIndex !== -1 && defaultIndex + 1 < parts.length) {
            definition.defaultValue = parts[defaultIndex + 1];
        }

        return definition;
    }

    /**
     * Extract table constraints from column definitions
     */
    private extractTableConstraints(columnsDef: string): {
        unique: Record<string, string[]>;
        check: Record<string, CheckConstraint>;
        foreignKeys: Record<string, ForeignKeyDefinition>;
    } {
        const constraints = {
            unique: {} as Record<string, string[]>,
            check: {} as Record<string, CheckConstraint>,
            foreignKeys: {} as Record<string, ForeignKeyDefinition>,
        };

        // Extract UNIQUE constraints
        const uniqueRegex = /UNIQUE\s*\(([^)]+)\)/gi;
        let uniqueMatch;
        while ((uniqueMatch = uniqueRegex.exec(columnsDef)) !== null) {
            const columns = uniqueMatch[1].split(',').map(col => col.trim().replace(/["`]/g, ''));
            const constraintName = `unique_${columns.join('_')}`;
            constraints.unique[constraintName] = columns;
        }

        // Extract CHECK constraints
        const checkRegex = /CHECK\s*\(([^)]+)\)/gi;
        let checkMatch;
        while ((checkMatch = checkRegex.exec(columnsDef)) !== null) {
            const expression = checkMatch[1];
            const checkConstraint = this.parseCheckConstraint(expression);
            if (checkConstraint) {
                // Try to associate with column if possible
                const columnMatch = columnsDef.substring(0, checkMatch.index).match(/["`]?(\w+)["`]?\s+[^,]+$/);
                if (columnMatch) {
                    constraints.check[columnMatch[1]] = checkConstraint;
                }
            }
        }

        // Extract FOREIGN KEY constraints
        const fkRegex = /REFERENCES\s+["`]?(\w+)["`]?\s*\(["`]?(\w+)["`]?\)/gi;
        let fkMatch;
        while ((fkMatch = fkRegex.exec(columnsDef)) !== null) {
            const referencedTable = fkMatch[1];
            const referencedColumn = fkMatch[2];

            // Find the column this references
            const beforeFk = columnsDef.substring(0, fkMatch.index);
            const columnMatch = beforeFk.match(/["`]?(\w+)["`]?\s+[^,]+$/);
            if (columnMatch) {
                const columnName = columnMatch[1];
                constraints.foreignKeys[columnName] = {
                    column: columnName,
                    referencedTable,
                    referencedColumn,
                };
            }
        }

        return constraints;
    }

    /**
     * Parse CHECK constraint expression
     */
    private parseCheckConstraint(expression: string): CheckConstraint | null {
        const constraint: CheckConstraint = {
            expression: expression.trim(),
        };

        // Parse IN constraints (e.g., user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN'))
        const inMatch = expression.match(/(\w+)\s+IN\s*\(([^)]+)\)/i);
        if (inMatch) {
            const values = inMatch[2].split(',').map(val =>
                val.trim().replace(/['"]/g, '')
            );
            constraint.values = values;
        }

        // Parse range constraints (e.g., age >= 18 AND age <= 120)
        const rangeMatch = expression.match(/(\w+)\s*(>=|<=|>|<)\s*(\d+)/g);
        if (rangeMatch) {
            constraint.range = {};
            for (const range of rangeMatch) {
                const rangeParts = range.trim().split(/\s+/);
                const operator = rangeParts[1];
                const value = parseInt(rangeParts[2]);

                if (operator === '>=' || operator === '>') {
                    constraint.range.min = value;
                } else if (operator === '<=' || operator === '<') {
                    constraint.range.max = value;
                }
            }
        }

        // Parse pattern constraints (e.g., email LIKE '%@%.%')
        const likeMatch = expression.match(/(\w+)\s+LIKE\s+['"]([^'"]+)['"]/i);
        if (likeMatch) {
            constraint.pattern = likeMatch[2].replace(/%/g, '.*');
        }

        return constraint;
    }

    /**
     * Parse ALTER TABLE statements to update schema
     */
    private parseAlterTableStatement(statement: string, schema: DatabaseSchema): void {
        try {
            // Match ALTER TABLE table_name ADD CONSTRAINT...
            const alterRegex = /ALTER TABLE\s+["`]?(\w+)["`]?\s+(.+);?/i;
            const match = statement.match(alterRegex);

            if (!match) {
                return;
            }

            const tableName = match[1];
            const alterClause = match[2];

            if (!schema.tables[tableName]) {
                logger.warn("ALTER TABLE references unknown table", { tableName });
                return;
            }

            // Handle ADD COLUMN
            if (alterRegex.test(alterClause)) {
                // This could be extended to handle ALTER TABLE statements
                logger.debug("ALTER TABLE statement found (not fully implemented)", {
                    tableName,
                    statement: alterClause,
                });
            }
        } catch (error) {
            logger.warn("Failed to parse ALTER TABLE statement", {
                statement,
                error: (error as Error).message,
            });
        }
    }

    /**
     * Split SQL content into individual statements
     */
    private splitSqlStatements(content: string): string[] {
        const statements: string[] = [];
        let currentStatement = '';
        let inString = false;
        let stringChar = '';
        let parenthesesDepth = 0;

        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const nextChar = content[i + 1];

            // Handle string literals
            if ((char === '"' || char === "'") && (i === 0 || content[i - 1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                    stringChar = '';
                }
            }

            // Track parentheses depth
            if (!inString) {
                if (char === '(') {
                    parenthesesDepth++;
                } else if (char === ')') {
                    parenthesesDepth--;
                }
            }

            currentStatement += char;

            // Check for statement end
            if (!inString && parenthesesDepth === 0 && char === ';') {
                statements.push(currentStatement.trim());
                currentStatement = '';
            }
        }

        // Add any remaining statement
        if (currentStatement.trim()) {
            statements.push(currentStatement.trim());
        }

        return statements.filter(stmt => stmt.length > 0);
    }

    /**
     * Merge parsed schema from one migration into the main schema
     */
    private mergeSchemas(mainSchema: DatabaseSchema, fileSchema: DatabaseSchema): void {
        // Merge tables
        for (const [tableName, tableDef] of Object.entries(fileSchema.tables)) {
            if (mainSchema.tables[tableName]) {
                // Merge table definitions (could handle ALTER TABLE here)
                this.mergeTableDefinitions(mainSchema.tables[tableName], tableDef);
            } else {
                mainSchema.tables[tableName] = tableDef;
            }
        }

        // Build relationships map
        this.buildRelationshipsMap(mainSchema);
    }

    /**
     * Merge table definitions (for handling multiple migrations)
     */
    private mergeTableDefinitions(existing: TableDefinition, newDef: TableDefinition): void {
        // Merge columns (new migrations might add columns)
        Object.assign(existing.columns, newDef.columns);

        // Merge constraints
        Object.assign(existing.uniqueConstraints, newDef.uniqueConstraints);
        Object.assign(existing.checkConstraints, newDef.checkConstraints);
        Object.assign(existing.foreignKeys, newDef.foreignKeys);
    }

    /**
     * Build relationships map from foreign keys
     */
    private buildRelationshipsMap(schema: DatabaseSchema): void {
        schema.relationships = {};

        for (const [tableName, tableDef] of Object.entries(schema.tables)) {
            schema.relationships[tableName] = {};

            for (const [columnName, fkDef] of Object.entries(tableDef.foreignKeys)) {
                schema.relationships[tableName][columnName] = fkDef.referencedTable;
            }
        }
    }
}
