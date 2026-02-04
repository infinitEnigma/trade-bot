/** @format */

import request from 'supertest';
import { Express } from 'express';

// Mock dependencies before importing any other modules
jest.mock('../../../src/infrastructure/security/database-security.service', () => ({
    databaseSecurityService: {
        assessDatabaseSecurity: jest.fn(),
        getSecurityMetrics: jest.fn(),
        generateSecurityAuditReport: jest.fn(),
        generateEncryptionMigrationPlan: jest.fn(),
        migrateTableEncryption: jest.fn(),
        enableDatabaseEncryption: jest.fn(),
    },
}));

jest.mock('../../../src/infrastructure', () => ({
    encryptionService: {
        isKeyRotationNeeded: jest.fn(),
        rotateEncryptionKeys: jest.fn(),
    },
}));

jest.mock('../../../src/interfaces/middleware/auth', () => ({
    authMiddleware: jest.fn((req, res, next) => {
        // Mock user for authenticated requests
        req.user = {
            userId: 'test-user-123',
            email: 'test@example.com',
            userLevel: 'ADMIN',
            roles: ['admin'],
        };
        next();
    }),
}));

jest.mock('../../../src/core/logging', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

// Get mock services
const mockDatabaseSecurityService = require('../../../src/infrastructure/security/database-security.service').databaseSecurityService;
const mockEncryptionService = require('../../../src/infrastructure').encryptionService;

// Create a test app
function createTestApp(): Express {
    const express = require('express');
    const app = express();

    // Add necessary middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Import and register routes
    const { securityRoutes } = require('../../../src/interfaces/http/system/security');
    app.use('/', securityRoutes);

    return app;
}

describe('Security Controller', () => {
    let app: Express;

    beforeAll(() => {
        // Set necessary environment variables
        process.env.NODE_ENV = 'test';
    });

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create fresh app instance
        app = createTestApp();
    });

    describe('Unauthenticated requests', () => {
        // Override the auth middleware to not set user
        beforeEach(() => {
            const auth = require('../../../src/interfaces/middleware/auth');
            auth.authMiddleware.mockImplementation((req: any, res: any, next: any) => {
                req.user = undefined;
                next();
            });
        });

        afterEach(() => {
            // Restore the original auth middleware
            const auth = require('../../../src/interfaces/middleware/auth');
            auth.authMiddleware.mockImplementation((req: any, res: any, next: any) => {
                req.user = {
                    userId: 'test-user-123',
                    email: 'test@example.com',
                    userLevel: 'ADMIN',
                    roles: ['admin'],
                };
                next();
            });
        });

        it('should return 401 for GET /assessment without user', async () => {
            const response = await request(app)
                .get('/assessment')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Unauthorized - user not authenticated');
        });

        it('should return 401 for GET /metrics without user', async () => {
            const response = await request(app)
                .get('/metrics')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Unauthorized - user not authenticated');
        });

        it('should return 401 for GET /audit-report without user', async () => {
            const response = await request(app)
                .get('/audit-report')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Unauthorized - user not authenticated');
        });

        it('should return 401 for GET /migration-plan without user', async () => {
            const response = await request(app)
                .get('/migration-plan')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Unauthorized - user not authenticated');
        });

        it('should return 401 for POST /migrate-table without user', async () => {
            const response = await request(app)
                .post('/migrate-table')
                .send({
                    tableName: 'users',
                    columns: ['email'],
                })
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Unauthorized - user not authenticated');
        });

        it('should return 401 for POST /enable-encryption without user', async () => {
            const response = await request(app)
                .post('/enable-encryption')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Unauthorized - user not authenticated');
        });

        it('should return 401 for POST /rotate-keys without user', async () => {
            const response = await request(app)
                .post('/rotate-keys')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Unauthorized - user not authenticated');
        });
    });

    describe('Authenticated requests', () => {
        describe('GET /assessment', () => {
            it('should return security assessment when authenticated', async () => {
                const mockAssessment = {
                    overallStatus: 'healthy',
                    checks: [
                        { name: 'Encryption Status', status: 'pass' },
                        { name: 'Access Controls', status: 'pass' },
                    ],
                };

                mockDatabaseSecurityService.assessDatabaseSecurity.mockResolvedValue(mockAssessment);

                const response = await request(app)
                    .get('/assessment')
                    .expect(200);

                expect(response.body.success).toBe(true);
                expect(response.body.data).toEqual(mockAssessment);
                expect(response.body.generatedAt).toBeDefined();
            });

            it('should handle errors when retrieving security assessment', async () => {
                const errorMessage = 'Assessment failed';
                mockDatabaseSecurityService.assessDatabaseSecurity.mockRejectedValue(new Error(errorMessage));

                const response = await request(app)
                    .get('/assessment')
                    .expect(500);

                expect(response.body.success).toBe(false);
                expect(response.body.error).toBe('Failed to generate security assessment');
            });
        });
    });

    describe('GET /metrics', () => {
        it('should return security metrics when authenticated', async () => {
            const mockMetrics = {
                encryptionLevel: 'AES-256',
                activeSessions: 5,
                failedLoginAttempts: 0,
            };

            mockDatabaseSecurityService.getSecurityMetrics.mockResolvedValue(mockMetrics);

            const response = await request(app)
                .get('/metrics')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(mockMetrics);
        });

        it('should handle errors when retrieving security metrics', async () => {
            const errorMessage = 'Metrics retrieval failed';
            mockDatabaseSecurityService.getSecurityMetrics.mockRejectedValue(new Error(errorMessage));

            const response = await request(app)
                .get('/metrics')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to retrieve security metrics');
        });
    });

    describe('GET /audit-report', () => {
        it('should return security audit report when authenticated', async () => {
            const mockReport = 'Security Audit Report\nGenerated: 2024-01-01\nStatus: Healthy';

            mockDatabaseSecurityService.generateSecurityAuditReport.mockResolvedValue(mockReport);

            const response = await request(app)
                .get('/audit-report')
                .expect(200);

            expect(response.text).toEqual(mockReport);
            expect(response.headers['content-type']).toContain('text/plain');
            expect(response.headers['content-disposition']).toContain('attachment; filename="security-audit-');
        });

        it('should handle errors when generating security audit report', async () => {
            const errorMessage = 'Report generation failed';
            mockDatabaseSecurityService.generateSecurityAuditReport.mockRejectedValue(new Error(errorMessage));

            const response = await request(app)
                .get('/audit-report')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to generate security audit report');
        });
    });

    describe('GET /migration-plan', () => {
        it('should return encryption migration plan when authenticated', async () => {
            const mockMigrationPlan = [
                { tableName: 'users', columns: ['email', 'password'] },
                { tableName: 'transactions', columns: ['amount', 'currency'] },
            ];

            mockDatabaseSecurityService.generateEncryptionMigrationPlan.mockResolvedValue(mockMigrationPlan);

            const response = await request(app)
                .get('/migration-plan')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(mockMigrationPlan);
            expect(response.body.totalTables).toBe(mockMigrationPlan.length);
        });

        it('should handle errors when generating migration plan', async () => {
            const errorMessage = 'Migration plan generation failed';
            mockDatabaseSecurityService.generateEncryptionMigrationPlan.mockRejectedValue(new Error(errorMessage));

            const response = await request(app)
                .get('/migration-plan')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to generate migration plan');
        });
    });

    describe('POST /migrate-table', () => {
        it('should migrate table encryption when valid data is provided', async () => {
            const mockResult = {
                success: true,
                migratedRows: 100,
                errors: [],
            };

            mockDatabaseSecurityService.migrateTableEncryption.mockResolvedValue(mockResult);

            const response = await request(app)
                .post('/migrate-table')
                .send({
                    tableName: 'users',
                    columns: ['email', 'password'],
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain('Successfully migrated');
            expect(response.body.data).toEqual(mockResult);
        });

        it('should return 400 when missing required fields', async () => {
            const response = await request(app)
                .post('/migrate-table')
                .send({
                    tableName: 'users',
                })
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('tableName (string) and columns (array) are required');
        });

        it('should return 400 when migration completes with errors', async () => {
            const mockResult = {
                success: false,
                migratedRows: 50,
                errors: ['Column not found'],
            };

            mockDatabaseSecurityService.migrateTableEncryption.mockResolvedValue(mockResult);

            const response = await request(app)
                .post('/migrate-table')
                .send({
                    tableName: 'users',
                    columns: ['invalid-column'],
                })
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Migration completed with errors');
            expect(response.body.data).toEqual(mockResult);
        });

        it('should handle errors during table migration', async () => {
            const errorMessage = 'Migration failed';
            mockDatabaseSecurityService.migrateTableEncryption.mockRejectedValue(new Error(errorMessage));

            const response = await request(app)
                .post('/migrate-table')
                .send({
                    tableName: 'users',
                    columns: ['email'],
                })
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to migrate table encryption');
        });
    });

    describe('POST /enable-encryption', () => {
        it('should enable database encryption when successful', async () => {
            const mockResult = {
                success: true,
                message: 'Encryption enabled',
                requiresRestart: false,
            };

            mockDatabaseSecurityService.enableDatabaseEncryption.mockResolvedValue(mockResult);

            const response = await request(app)
                .post('/enable-encryption')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toEqual(mockResult.message);
            expect(response.body.requiresRestart).toEqual(mockResult.requiresRestart);
        });

        it('should return 400 when encryption enable fails', async () => {
            const mockResult = {
                success: false,
                message: 'Encryption already enabled',
                requiresRestart: false,
            };

            mockDatabaseSecurityService.enableDatabaseEncryption.mockResolvedValue(mockResult);

            const response = await request(app)
                .post('/enable-encryption')
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toEqual(mockResult.message);
        });

        it('should handle errors when enabling encryption', async () => {
            const errorMessage = 'Failed to enable encryption';
            mockDatabaseSecurityService.enableDatabaseEncryption.mockRejectedValue(new Error(errorMessage));

            const response = await request(app)
                .post('/enable-encryption')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to enable database encryption');
        });
    });

    describe('POST /rotate-keys', () => {
        it('should rotate encryption keys when needed', async () => {
            mockEncryptionService.isKeyRotationNeeded.mockResolvedValue(true);
            mockEncryptionService.rotateEncryptionKeys.mockResolvedValue();

            const response = await request(app)
                .post('/rotate-keys')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toEqual('Encryption keys rotated successfully');
            expect(response.body.rotated).toBe(true);
        });

        it('should return message when key rotation not needed', async () => {
            mockEncryptionService.isKeyRotationNeeded.mockResolvedValue(false);

            const response = await request(app)
                .post('/rotate-keys')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toEqual('Key rotation not needed at this time');
            expect(response.body.rotated).toBe(false);
        });

        it('should handle errors during key rotation', async () => {
            const errorMessage = 'Key rotation failed';
            mockEncryptionService.isKeyRotationNeeded.mockRejectedValue(new Error(errorMessage));

            const response = await request(app)
                .post('/rotate-keys')
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to rotate encryption keys');
        });
    });
});