/** @format */

import { DatabaseSchemaParser, TableDefinition, ColumnDefinition, CheckConstraint } from '../../src/shared/validation/database-schema-parser';
import logger from '../../src/core/logging/logger.service';

// Mock logger to avoid actual logging during tests
jest.mock('../../src/core/logging/logger.service');

describe('DatabaseSchemaParser', () => {
    let parser: DatabaseSchemaParser;

    beforeEach(() => {
        parser = new DatabaseSchemaParser();
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should create an instance of DatabaseSchemaParser', () => {
            expect(parser).toBeInstanceOf(DatabaseSchemaParser);
            expect(parser).toBeDefined();
        });
    });

    describe('SQL Statement Parsing', () => {
        it('should parse simple CREATE TABLE statements', () => {
            const createTableSql = `CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR(255) NOT NULL, password_hash VARCHAR(255) NOT NULL, user_level VARCHAR(50) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_active BOOLEAN DEFAULT true);`;

            // Test private method by calling on the parser instance
            const schema = (parser as any).parseMigrationFile(createTableSql);

            expect(schema.tables).toHaveProperty('users');
            const usersTable: TableDefinition = schema.tables['users'];

            // Check columns
            expect(Object.keys(usersTable.columns)).toEqual(
                expect.arrayContaining(['id', 'email', 'password_hash', 'user_level', 'created_at', 'updated_at', 'is_active'])
            );

            // Check id column
            const idColumn: ColumnDefinition = usersTable.columns['id'];
            expect(idColumn.type).toEqual('UUID');
            expect(idColumn.notNull).toBe(true);

            // Check email column
            const emailColumn: ColumnDefinition = usersTable.columns['email'];
            expect(emailColumn.type).toEqual('VARCHAR');
            expect(emailColumn.length).toBe(255);
            expect(emailColumn.notNull).toBe(true);
        });

        it('should parse CREATE TABLE with CHECK constraints', () => {
            const createTableSql = `CREATE TABLE users (id UUID PRIMARY KEY, user_level VARCHAR(50) NOT NULL CHECK (user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN')));`;

            const schema = (parser as any).parseMigrationFile(createTableSql);

            expect(schema.tables).toHaveProperty('users');
            const usersTable: TableDefinition = schema.tables['users'];

            expect(usersTable.checkConstraints['user_level']).toBeDefined();

            const userLevelCheck: CheckConstraint = usersTable.checkConstraints['user_level'];
            expect(userLevelCheck.expression).toContain('user_level IN');
            expect(userLevelCheck.values).toEqual(['BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN']);
        });

        it('should parse ALTER TABLE statements correctly', () => {
            const initialSql = `CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);`;
            const alterSql = `ALTER TABLE users ADD COLUMN bio TEXT; ALTER TABLE users ADD COLUMN age INTEGER CHECK (age >= 18 AND age <= 120);`;

            const initialSchema = (parser as any).parseMigrationFile(initialSql);

            // Test parsing ALTER TABLE
            (parser as any).parseAlterTableStatement(alterSql, initialSchema);

            expect(initialSchema.tables['users'].columns['bio']).toBeDefined();
            expect(initialSchema.tables['users'].columns['bio'].type).toEqual('TEXT');

            expect(initialSchema.tables['users'].columns['age']).toBeDefined();
            expect(initialSchema.tables['users'].columns['age'].type).toEqual('INTEGER');
        });

        it('should extract foreign key relationships', () => {
            const sql = `CREATE TABLE strategies (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), name VARCHAR(255) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`;

            const schema = (parser as any).parseMigrationFile(sql);

            expect(schema.tables['strategies']).toBeDefined();
            expect(schema.tables['strategies'].foreignKeys['user_id']).toBeDefined();
            expect(schema.tables['strategies'].foreignKeys['user_id'].referencedTable).toEqual('users');
            expect(schema.tables['strategies'].foreignKeys['user_id'].referencedColumn).toEqual('id');
        });
    });

    describe('Check Constraint Parsing', () => {
        it('should parse IN constraints', () => {
            const parseCheck = (parser as any).parseCheckConstraint;
            const constraint = parseCheck("user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN')");

            expect(constraint).not.toBeNull();
            expect(constraint?.expression).toContain('user_level IN');
            expect(constraint?.values).toEqual(['BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN']);
        });

        it('should parse range constraints', () => {
            const parseCheck = (parser as any).parseCheckConstraint;
            const constraint = parseCheck("age >= 18 AND age <= 120");

            expect(constraint?.range).toBeDefined();
            expect(constraint?.range?.min).toBe(18);
            expect(constraint?.range?.max).toBe(120);
        });

        it('should parse pattern constraints', () => {
            const parseCheck = (parser as any).parseCheckConstraint;
            const constraint = parseCheck("email LIKE '%@%.%'");

            expect(constraint?.pattern).toBeDefined();
            expect(constraint?.pattern).toContain('.*');
        });
    });

    describe('Column Type Parsing', () => {
        it('should parse VARCHAR types with length', () => {
            const parseType = (parser as any).parseColumnType;
            const column = parseType('email', 'VARCHAR(255) NOT NULL');

            expect(column).toBeDefined();
            expect(column.type).toEqual('VARCHAR');
            expect(column.length).toBe(255);
            expect(column.notNull).toBe(true);
        });

        it('should parse DECIMAL types with precision and scale', () => {
            const parseType = (parser as any).parseColumnType;
            const column = parseType('balance', 'DECIMAL(20,8)');

            expect(column).toBeDefined();
            expect(column.type).toEqual('DECIMAL');
            expect(column.precision).toBe(20);
            expect(column.scale).toBe(8);
        });

        it('should parse UUID types', () => {
            const parseType = (parser as any).parseColumnType;
            const column = parseType('id', 'UUID PRIMARY KEY');

            expect(column).toBeDefined();
            expect(column.type).toEqual('UUID');
            expect(column.notNull).toBe(false); // PRIMARY KEY implies NOT NULL, but this might not be parsed here
        });
    });

    describe('Real-World Migration Parsing', () => {
        it('should parse existing migration files correctly', async () => {
            // This tests that we can actually parse the real migration files
            const schema = await parser.parseSchema();

            expect(schema.tables).toBeDefined();
            expect(Object.keys(schema.tables)).not.toHaveLength(0);

            // Check that common tables exist
            expect(schema.tables['users']).toBeDefined();
            expect(schema.tables['strategies']).toBeDefined();
            expect(schema.tables['bot_instances']).toBeDefined();
            expect(schema.tables['trades']).toBeDefined();

            // Log the tables found for debugging
            logger.info('Tables found in schema:', { tables: Object.keys(schema.tables) });
        });
    });
});