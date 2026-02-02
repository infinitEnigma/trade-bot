/** @format */

import { SchemaGenerator } from '../../src/shared/validation/schema-generator';
import { DatabaseSchemaParser } from '../../src/shared/validation/database-schema-parser';
import Joi from 'joi';

describe('SchemaGenerator', () => {
    let generator: SchemaGenerator;
    let parser: DatabaseSchemaParser;

    beforeEach(() => {
        generator = new SchemaGenerator();
        parser = new DatabaseSchemaParser();
    });

    describe('Initialization', () => {
        it('should create an instance of SchemaGenerator', () => {
            expect(generator).toBeInstanceOf(SchemaGenerator);
            expect(generator).toBeDefined();
        });
    });

    describe('Schema Generation', () => {
        it('should generate Joi schema for simple table', async () => {
            const testSql = `
                CREATE TABLE users (
                    id UUID PRIMARY KEY,
                    email VARCHAR(255) NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    user_level VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT true
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);
            const joiSchema = generator.generateTableSchema('users', schema);

            expect(joiSchema).not.toBeNull();

            // Test valid data
            const validData = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                email: 'test@example.com',
                password_hash: 'hashedpassword',
                user_level: 'BASIC',
                is_active: true
            };

            const validationResult = joiSchema?.validate(validData);
            expect(validationResult?.error).toBeUndefined();

            // Test invalid data types
            const invalidData = {
                id: 'not-a-uuid',
                email: 'invalid-email',
                password_hash: 12345,
                user_level: 'INVALID_LEVEL',
                is_active: 'yes'
            };

            const invalidResult = joiSchema?.validate(invalidData);
            expect(invalidResult?.error).toBeDefined();
            expect(invalidResult?.error?.details).not.toHaveLength(0);
        });

        it('should generate schema with CHECK constraints', async () => {
            const testSql = `
                CREATE TABLE users (
                    id UUID PRIMARY KEY,
                    user_level VARCHAR(50) NOT NULL CHECK (user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN')),
                    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
                    age INTEGER CHECK (age >= 18 AND age <= 120)
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);
            const joiSchema = generator.generateTableSchema('users', schema);

            expect(joiSchema).not.toBeNull();

            // Test valid user_level values
            const validUserLevel = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                user_level: 'VERIFIED',
                status: 'ACTIVE',
                age: 25
            };

            const validResult = joiSchema?.validate(validUserLevel);
            expect(validResult?.error).toBeUndefined();

            // Test invalid user_level value
            const invalidUserLevel = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                user_level: 'INVALID',
                status: 'ACTIVE',
                age: 25
            };

            const invalidResult = joiSchema?.validate(invalidUserLevel);
            expect(invalidResult?.error).toBeDefined();
            expect(invalidResult?.error?.details).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        message: expect.stringContaining('must be one of')
                    })
                ])
            );
        });

        it('should generate schema with range constraints', async () => {
            const testSql = `
                CREATE TABLE users (
                    id UUID PRIMARY KEY,
                    age INTEGER CHECK (age >= 18 AND age <= 120)
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);
            const joiSchema = generator.generateTableSchema('users', schema);

            expect(joiSchema).not.toBeNull();

            // Test valid age
            const validAge = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                age: 25
            };

            const validResult = joiSchema?.validate(validAge);
            expect(validResult?.error).toBeUndefined();

            // Test age below minimum
            const tooYoung = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                age: 17
            };

            const tooYoungResult = joiSchema?.validate(tooYoung);
            expect(tooYoungResult?.error).toBeDefined();
            expect(tooYoungResult?.error?.details).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        message: expect.stringContaining('must be greater')
                    })
                ])
            );

            // Test age above maximum
            const tooOld = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                age: 121
            };

            const tooOldResult = joiSchema?.validate(tooOld);
            expect(tooOldResult?.error).toBeDefined();
            expect(tooOldResult?.error?.details).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        message: expect.stringContaining('must be less')
                    })
                ])
            );
        });

        it('should generate schema with foreign key constraints', async () => {
            const testSql = `
                CREATE TABLE users (
                    id UUID PRIMARY KEY,
                    email VARCHAR(255) NOT NULL
                );

                CREATE TABLE strategies (
                    id UUID PRIMARY KEY,
                    user_id UUID NOT NULL REFERENCES users(id),
                    name VARCHAR(255) NOT NULL,
                    description TEXT
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);
            const joiSchema = generator.generateTableSchema('strategies', schema);

            expect(joiSchema).not.toBeNull();

            // Test valid foreign key
            const validStrategy = {
                id: '550e8400-e29b-41d4-a716-446655440001',
                user_id: '550e8400-e29b-41d4-a716-446655440000',
                name: 'Test Strategy',
                description: 'A test strategy'
            };

            const validResult = joiSchema?.validate(validStrategy);
            expect(validResult?.error).toBeUndefined();

            // Test invalid foreign key format
            const invalidStrategy = {
                id: '550e8400-e29b-41d4-a716-446655440001',
                user_id: 'not-a-uuid',
                name: 'Test Strategy',
                description: 'A test strategy'
            };

            const invalidResult = joiSchema?.validate(invalidStrategy);
            expect(invalidResult?.error).toBeDefined();
        });
    });

    describe('Type Mapping', () => {
        it('should map VARCHAR type with length', async () => {
            const testSql = `
                CREATE TABLE test (
                    id UUID PRIMARY KEY,
                    name VARCHAR(100) NOT NULL
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);
            const joiSchema = generator.generateTableSchema('test', schema);

            expect(joiSchema).not.toBeNull();

            // Test valid length
            const validData = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                name: 'Valid name'
            };
            const validResult = joiSchema?.validate(validData);
            expect(validResult?.error).toBeUndefined();

            // Test exceeding length
            const longName = 'a'.repeat(101);
            const invalidData = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                name: longName
            };
            const invalidResult = joiSchema?.validate(invalidData);
            expect(invalidResult?.error).toBeDefined();
            expect(invalidResult?.error?.details).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        message: expect.stringContaining('is too long')
                    })
                ])
            );
        });

        it('should map DECIMAL type with precision and scale', async () => {
            const testSql = `
                CREATE TABLE balances (
                    id UUID PRIMARY KEY,
                    amount DECIMAL(10, 2) NOT NULL
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);
            const joiSchema = generator.generateTableSchema('balances', schema);

            expect(joiSchema).not.toBeNull();

            // Test valid decimal format
            const validData = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                amount: 123.45
            };
            const validResult = joiSchema?.validate(validData);
            expect(validResult?.error).toBeUndefined();

            // Test too many decimal places
            const invalidData = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                amount: 123.456
            };
            const invalidResult = joiSchema?.validate(invalidData);
            expect(invalidResult?.error).toBeDefined();
        });
    });

    describe('Validation', () => {
        it('should validate data against generated schema', async () => {
            const testSql = `
                CREATE TABLE users (
                    id UUID PRIMARY KEY,
                    email VARCHAR(255) NOT NULL,
                    user_level VARCHAR(50) NOT NULL CHECK (user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN'))
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);

            // Test valid data
            const validData = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                email: 'test@example.com',
                user_level: 'VERIFIED'
            };

            const validationResult = generator.validateData('users', validData, schema);
            expect(validationResult.isValid).toBe(true);
            expect(validationResult.errors).toBeUndefined();
            expect(validationResult.cleanedData).toEqual(validData);

            // Test invalid data
            const invalidData = {
                id: 'not-a-uuid',
                email: 'invalid-email',
                user_level: 'INVALID'
            };

            const invalidResult = generator.validateData('users', invalidData, schema);
            expect(invalidResult.isValid).toBe(false);
            expect(invalidResult.errors).not.toBeUndefined();
            expect(invalidResult.errors?.length).toBeGreaterThan(0);
        });

        it('should reject unknown fields by default', async () => {
            const testSql = `
                CREATE TABLE users (
                    id UUID PRIMARY KEY,
                    email VARCHAR(255) NOT NULL
                );
            `;

            const schema = (parser as any).parseMigrationFile(testSql);
            const joiSchema = generator.generateTableSchema('users', schema);

            expect(joiSchema).not.toBeNull();

            const dataWithUnknownField = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                email: 'test@example.com',
                unknown_field: 'value'
            };

            const result = joiSchema?.validate(dataWithUnknownField);
            expect(result?.error).toBeDefined();
            expect(result?.error?.details).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        message: expect.stringContaining('"unknown_field" is not allowed')
                    })
                ])
            );
        });
    });

    describe('Real-World Schema Generation', () => {
        it('should generate schemas for all real tables', async () => {
            const dbSchema = await parser.parseSchema();
            const allSchemas = generator.generateAllSchemas(dbSchema);

            expect(allSchemas).toBeDefined();
            expect(Object.keys(allSchemas)).not.toHaveLength(0);

            // Check that schemas are generated for key tables
            expect(allSchemas['users']).toBeDefined();
            expect(allSchemas['strategies']).toBeDefined();
            expect(allSchemas['bot_instances']).toBeDefined();
            expect(allSchemas['trades']).toBeDefined();
            expect(allSchemas['kodiak_balances']).toBeDefined();
            expect(allSchemas['kodiak_positions']).toBeDefined();

            // Verify the generated schemas are Joi objects
            Object.values(allSchemas).forEach(schema => {
                expect(typeof schema).toBe('object');
                expect(schema).toHaveProperty('validate');
                expect(typeof schema.validate).toBe('function');
            });
        });
    });
});