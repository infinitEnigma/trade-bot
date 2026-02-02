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
import { logger } from "../../core/logging";

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
    private migrationDir = path.join(__dirname, "..", "..", "..", "..", "database", "migrations");

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

            if (trimmed.includes('CREATE TABLE')) {
                const tableDef = this.parseCreateTableStatement(trimmed);
                if (tableDef) {
                    schema.tables[tableDef.name] = tableDef;
                }
            } else if (trimmed.includes('ALTER TABLE')) {
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
            const createTableRegex = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["`]?(\w+)["`]?\s*\((.*)\);?/is;
            const match = statement.match(createTableRegex);

            if (!match) {
                logger.debug("CREATE TABLE regex did not match", {
                    statement: statement.substring(0, 100)
                });
                return null;
            }

            const tableName = match[1];
            const columnsDefinition = match[2].trim();

            logger.debug("Parsing CREATE TABLE", {
                tableName,
                columnsDefinitionLength: columnsDefinition.length,
                columnsDefinitionPreview: columnsDefinition.substring(0, 200)
            });

            const columns = this.parseColumnDefinitions(columnsDefinition);
            const constraints = this.extractTableConstraints(columnsDefinition);

            logger.debug("CREATE TABLE parsed successfully", {
                tableName,
                columnCount: Object.keys(columns).length,
                columns: Object.keys(columns)
            });

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

        // Fix: Handle column definitions with parentheses in type (like DECIMAL(10, 2))
        // We need to split by commas only when they're not inside parentheses
        const columnDefs = [];
        let openParens = 0;
        let currentDef = '';

        for (let i = 0; i < columnsDef.length; i++) {
            const char = columnsDef[i];

            if (char === '(') openParens++;
            if (char === ')') openParens--;

            if (char === ',' && openParens === 0) {
                columnDefs.push(currentDef.trim());
                currentDef = '';
            } else {
                currentDef += char;
            }
        }

        // Add the last definition
        if (currentDef.trim()) {
            columnDefs.push(currentDef.trim());
        }

        for (let i = 0; i < columnDefs.length; i++) {
            const columnDef = columnDefs[i];

            // Skip empty definitions and constraints
            if (!columnDef || columnDef.startsWith('CONSTRAINT') ||
                columnDef.startsWith('PRIMARY KEY') || columnDef.startsWith('UNIQUE') ||
                columnDef.startsWith('CHECK') || columnDef.startsWith('FOREIGN KEY')) {
                continue;
            }

            // Extract column name and type using a more precise regex
            const columnMatch = columnDef.match(/^["`]?(\w+)["`]?\s+(.+)$/);
            if (columnMatch) {
                const columnName = columnMatch[1];
                const typeDef = columnMatch[2].trim();

                logger.debug("Found column definition", {
                    columnName,
                    typeDef,
                    index: i
                });

                const columnDefObj = this.parseColumnType(columnName, typeDef);

                // Fix: PRIMARY KEY implies NOT NULL
                if (typeDef.includes('PRIMARY KEY')) {
                    columnDefObj.notNull = true;
                }

                columns[columnName] = columnDefObj;
            } else {
                logger.warn("Failed to parse column definition", { columnDef, index: i });
            }
        }

        logger.debug("Total columns parsed", {
            totalColumns: Object.keys(columns).length,
            columns: Object.keys(columns)
        });

        return columns;
    }

    /**
     * Parse individual column type definition
     */
    private parseColumnType(name: string, typeDef: string): ColumnDefinition {
        // Trim and clean up the type definition
        const cleanTypeDef = typeDef.trim().replace(/\s+/g, ' ');

        // Extract just the type part, ignoring constraints
        // Look for patterns like: TYPE, TYPE(size), TYPE(size,size)
        const typeMatch = cleanTypeDef.match(/^(\w+(?:\(\d+(?:,\s*\d+)?\))?)\s*/i);
        if (!typeMatch) {
            logger.warn("Failed to parse column type", { name, typeDef });
            return {
                name,
                type: 'TEXT', // Default fallback
                notNull: false,
            };
        }

        const typePart = typeMatch[1].toUpperCase();

        // Filter out invalid column types that are actually constraint keywords
        const invalidTypes = ['NOT', 'NULL', 'UNIQUE', 'PRIMARY', 'KEY', 'CHECK', 'FOREIGN', 'REFERENCES', 'CONSTRAINT'];
        if (invalidTypes.includes(typePart)) {
            logger.warn("Skipping invalid column type that appears to be a constraint keyword", { name, typePart, typeDef });
            return {
                name,
                type: 'TEXT', // Default fallback
                notNull: false,
            };
        }

        const definition: ColumnDefinition = {
            name,
            type: typePart,
            notNull: false,
        };

        // Parse type parameters (e.g., VARCHAR(255), DECIMAL(20, 8))
        if (typePart.includes('(')) {
            const paramMatch = typePart.match(/^(\w+)\(([^)]+)\)$/);
            if (paramMatch) {
                definition.type = paramMatch[1];
                const params = paramMatch[2].trim();

                if (definition.type === 'DECIMAL' || definition.type === 'NUMERIC') {
                    const [precisionStr, scaleStr] = params.split(',').map(p => p.trim());
                    const precision = parseInt(precisionStr);
                    const scale = scaleStr ? parseInt(scaleStr) : 0;
                    if (!isNaN(precision)) {
                        definition.precision = precision;
                        if (!isNaN(scale)) {
                            definition.scale = scale;
                        }
                    }
                } else {
                    const length = parseInt(params);
                    if (!isNaN(length)) {
                        definition.length = length;
                    }
                }
            }
        }

        // Check for NOT NULL (handle case where NOT NULL might be split)
        definition.notNull = /NOT\s+NULL/i.test(cleanTypeDef);

        // Check for DEFAULT
        const defaultMatch = cleanTypeDef.match(/DEFAULT\s+([^,\s]+)/i);
        if (defaultMatch) {
            definition.defaultValue = defaultMatch[1];
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

        // Extract CHECK constraints with better parentheses matching
        const checkRegex = /CHECK\s*\(([\s\S]*?)\)/gi;
        let checkMatch;
        while ((checkMatch = checkRegex.exec(columnsDef)) !== null) {
            let expression = checkMatch[1].trim();

            // Fix: Ensure we have matching parentheses for the check expression
            if (expression && expression.split('(').length !== expression.split(')').length) {
                // Find the matching closing parenthesis
                let openParens = 1;
                let endPos = checkMatch.index + checkMatch[0].length;
                while (endPos < columnsDef.length && openParens > 0) {
                    if (columnsDef[endPos] === '(') openParens++;
                    if (columnsDef[endPos] === ')') openParens--;
                    endPos++;
                }

                if (openParens === 0) {
                    expression = columnsDef.substring(checkMatch.index + 7, endPos - 1).trim();
                }
            }

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
            // If there are multiple statements, split them first
            const statements = this.splitSqlStatements(statement);

            for (const singleStatement of statements) {
                // Match ALTER TABLE table_name ADD CONSTRAINT...
                const alterRegex = /ALTER TABLE\s+["`]?(\w+)["`]?\s+(.+);?/i;
                const match = singleStatement.match(alterRegex);

                if (!match) {
                    continue;
                }

                const tableName = match[1];
                const alterClause = match[2];

                // Only log warning if table doesn't exist and it's not a migration that will create it later
                if (!schema.tables[tableName]) {
                    // Check if this is a migration that creates the table later
                    const createsTable = alterClause.includes('CREATE TABLE') ||
                        alterClause.includes('IF NOT EXISTS');

                    if (!createsTable) {
                        logger.debug("ALTER TABLE references table not yet parsed (may be created in later migration)", {
                            tableName,
                            statement: `${singleStatement.substring(0, 100)}...`
                        });
                    }
                    continue;
                }

                // Handle ADD COLUMN
                if (alterClause.includes('ADD COLUMN')) {
                    this.handleAddColumnStatement(tableName, alterClause, schema);
                }
            }
        } catch (error) {
            logger.warn("Failed to parse ALTER TABLE statement", {
                statement: statement.substring(0, 100),
                error: (error as Error).message,
            });
        }
    }

    /**
     * Handle ADD COLUMN statements to update table schema
     */
    private handleAddColumnStatement(tableName: string, alterClause: string, schema: DatabaseSchema): void {
        try {
            // Extract column definition from ADD COLUMN statement
            const columnRegex = /ADD COLUMN\s+["`]?(\w+)["`]?\s+([^,;]+)/i;
            const match = alterClause.match(columnRegex);

            if (match) {
                const columnName = match[1];
                const columnType = match[2].trim();

                const columnDef = this.parseColumnType(columnName, columnType);
                schema.tables[tableName].columns[columnName] = columnDef;

                logger.debug("Added column to table schema", {
                    tableName,
                    columnName,
                    columnType
                });
            }
        } catch (error) {
            logger.warn("Failed to handle ADD COLUMN statement", {
                tableName,
                alterClause,
                error: (error as Error).message,
            });
        }
    }

    /**
     * Split SQL content into individual statements
     */
    private splitSqlStatements(content: string): string[] {
        // Simple approach: split by semicolons and filter
        const rawStatements = content.split(';');
        const statements: string[] = [];

        for (const statement of rawStatements) {
            const trimmed = statement.trim();

            if (trimmed.length === 0) continue;

            // Skip pure comment statements
            const lines = trimmed.split('\n');
            const nonCommentLines = lines.filter(line => {
                const trimmedLine = line.trim();
                return trimmedLine.length > 0 && !trimmedLine.startsWith('--') && !trimmedLine.startsWith('/*');
            });

            if (nonCommentLines.length > 0) {
                statements.push(`${trimmed};`); // Add back the semicolon
            }
        }

        return statements;
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
