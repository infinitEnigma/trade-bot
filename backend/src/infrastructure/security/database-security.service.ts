/**
 * Database Security Service
 *
 * Comprehensive database security assessment and encryption implementation.
 * Provides data-at-rest encryption, audit logging, and security monitoring.
 */

import { query } from "../../database/pool";
import { encryptionService } from "../security";
import { redisService } from "../cache";
import { logger } from "../../core/logging";

export interface SecurityAssessment {
    databaseEncryption: {
        enabled: boolean;
        type: 'transparent' | 'column-level' | 'application-level';
        status: 'secure' | 'warning' | 'insecure';
        recommendations: string[];
    };
    sensitiveDataProtection: {
        encryptedFields: string[];
        unencryptedFields: string[];
        riskLevel: 'low' | 'medium' | 'high';
        recommendations: string[];
    };
    auditLogging: {
        enabled: boolean;
        retentionDays: number;
        complianceLevel: 'basic' | 'enhanced' | 'full';
        recommendations: string[];
    };
    accessControls: {
        rowLevelSecurity: boolean;
        columnLevelSecurity: boolean;
        connectionEncryption: boolean;
        recommendations: string[];
    };
}

export interface EncryptionMigrationPlan {
    table: string;
    columns: string[];
    migrationStrategy: 'online' | 'offline' | 'hybrid';
    estimatedDowntime: string;
    rollbackPlan: string;
    riskAssessment: 'low' | 'medium' | 'high';
}

export interface DatabaseSecurityConfig {
    enableEncryption: boolean;
    encryptionKeyRotation: boolean;
    auditAllQueries: boolean;
    connectionEncryption: boolean;
    sensitiveTables: string[];
}

/**
 * Database Security Service
 */
export class DatabaseSecurityService {
    private readonly config: DatabaseSecurityConfig;

    constructor(config: Partial<DatabaseSecurityConfig> = {}) {
        this.config = {
            enableEncryption: config.enableEncryption ?? true,
            encryptionKeyRotation: config.encryptionKeyRotation ?? true,
            auditAllQueries: config.auditAllQueries ?? false,
            connectionEncryption: config.connectionEncryption ?? true,
            sensitiveTables: config.sensitiveTables ?? [
                'kodiak_credentials',
                'user_sessions',
                'audit_logs',
                'payment_data'
            ],
        };
    }

    /**
     * Comprehensive security assessment of database
     */
    async assessDatabaseSecurity(): Promise<SecurityAssessment> {
        logger.info("Starting comprehensive database security assessment");

        const [
            encryptionStatus,
            sensitiveDataStatus,
            auditStatus,
            accessControlStatus,
        ] = await Promise.all([
            this.assessEncryptionStatus(),
            this.assessSensitiveDataProtection(),
            this.assessAuditLogging(),
            this.assessAccessControls(),
        ]);

        const assessment: SecurityAssessment = {
            databaseEncryption: encryptionStatus,
            sensitiveDataProtection: sensitiveDataStatus,
            auditLogging: auditStatus,
            accessControls: accessControlStatus,
        };

        // Cache assessment results for 1 hour
        await redisService.setex(
            'db:security:assessment',
            3600,
            JSON.stringify(assessment)
        );

        logger.info("Database security assessment completed", {
            encryptionStatus: encryptionStatus.status,
            sensitiveDataRisk: sensitiveDataStatus.riskLevel,
            auditCompliance: auditStatus.complianceLevel,
        });

        return assessment;
    }

    /**
     * Assess database encryption status
     */
    private async assessEncryptionStatus(): Promise<SecurityAssessment['databaseEncryption']> {
        try {
            // Check if PostgreSQL TDE (Transparent Data Encryption) is enabled
            const tdeResult = await query(`
        SELECT setting FROM pg_settings
        WHERE name = 'data_directory_encrypted'
      `);

            const hasTDE = tdeResult.rows.length > 0 && (tdeResult.rows[0] as { setting: string }).setting === 'on';

            // Check for application-level encryption usage
            const encryptedColumnsResult = await query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_name IN ('kodiak_credentials', 'user_sessions')
        AND column_name LIKE '%encrypted%'
      `);

            const hasApplicationEncryption = encryptedColumnsResult.rows.length > 0;

            // Determine encryption type and status
            let encryptionType: 'transparent' | 'column-level' | 'application-level' = 'application-level';
            let status: 'secure' | 'warning' | 'insecure' = 'warning';
            const recommendations: string[] = [];

            if (hasTDE) {
                encryptionType = 'transparent';
                status = 'secure';
                recommendations.push('✅ PostgreSQL TDE is properly configured');
            } else if (hasApplicationEncryption) {
                encryptionType = 'application-level';
                status = 'secure';
                recommendations.push('✅ Application-level encryption is implemented');
                recommendations.push('⚠️ Consider PostgreSQL TDE for additional security layer');
            } else {
                status = 'insecure';
                recommendations.push('❌ No database encryption detected');
                recommendations.push('🔴 CRITICAL: Implement encryption immediately');
                recommendations.push('✅ Enable PostgreSQL TDE or implement application encryption');
            }

            // Additional recommendations
            if (!hasTDE) {
                recommendations.push('📋 Consider: ALTER SYSTEM SET data_directory_encrypted = on;');
                recommendations.push('📋 Consider: pg_tde extension for column-level encryption');
            }

            return {
                enabled: hasTDE || hasApplicationEncryption,
                type: encryptionType,
                status,
                recommendations,
            };
        } catch (error) {
            logger.error("Failed to assess encryption status", { error });

            return {
                enabled: false,
                type: 'application-level',
                status: 'warning',
                recommendations: [
                    '❌ Unable to assess encryption status',
                    '🔍 Manual review required',
                    '✅ Verify PostgreSQL TDE configuration',
                ],
            };
        }
    }

    /**
     * Assess sensitive data protection
     */
    private async assessSensitiveDataProtection(): Promise<SecurityAssessment['sensitiveDataProtection']> {
        try {
            const encryptedFields: string[] = [];
            const unencryptedFields: string[] = [];

            // Check Kodiak credentials table
            const kodiakFields = await query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'kodiak_credentials'
        AND data_type IN ('text', 'varchar')
      `);

            for (const field of kodiakFields.rows as Array<{ column_name: string }>) {
                if (field.column_name.includes('encrypted')) {
                    encryptedFields.push(`kodiak_credentials.${field.column_name}`);
                } else if (['api_key', 'secret_key', 'wallet_address'].includes(field.column_name)) {
                    unencryptedFields.push(`kodiak_credentials.${field.column_name}`);
                }
            }

            // Check for other sensitive tables
            const sensitiveTables = ['user_sessions', 'audit_logs'];
            for (const table of sensitiveTables) {
                const tableExists = await query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = $1
          )
        `, [table]);

                if ((tableExists.rows[0] as { exists: boolean }).exists) {
                    const sensitiveColumns = await query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = $1
            AND column_name LIKE '%token%' OR column_name LIKE '%key%' OR column_name LIKE '%secret%'
          `, [table]);

                    (sensitiveColumns.rows as Array<{ column_name: string }>).forEach((col) => {
                        unencryptedFields.push(`${table}.${col.column_name}`);
                    });
                }
            }

            // Calculate risk level
            let riskLevel: 'low' | 'medium' | 'high' = 'low';
            const recommendations: string[] = [];

            if (unencryptedFields.length > 0) {
                if (unencryptedFields.some(field => field.includes('api_key') || field.includes('secret_key'))) {
                    riskLevel = 'high';
                    recommendations.push('🔴 CRITICAL: API keys and secrets found unencrypted');
                    recommendations.push('✅ Implement immediate encryption for sensitive fields');
                } else {
                    riskLevel = 'medium';
                    recommendations.push('⚠️ Some sensitive fields may not be encrypted');
                }
            } else {
                recommendations.push('✅ All identified sensitive fields are encrypted');
            }

            recommendations.push('📋 Regular security audits recommended');
            recommendations.push('🔄 Implement automated encryption validation');

            return {
                encryptedFields,
                unencryptedFields,
                riskLevel,
                recommendations,
            };
        } catch (error) {
            logger.error("Failed to assess sensitive data protection", { error });

            return {
                encryptedFields: [],
                unencryptedFields: ['unknown'],
                riskLevel: 'high',
                recommendations: [
                    '❌ Unable to assess sensitive data protection',
                    '🔍 Manual security review required',
                    '✅ Implement encryption for all sensitive fields',
                ],
            };
        }
    }

    /**
     * Assess audit logging implementation
     */
    private async assessAuditLogging(): Promise<SecurityAssessment['auditLogging']> {
        try {
            // Check if audit_logs table exists and has data
            const auditTableExists = await query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'audit_logs'
        )
      `);

            if (!auditTableExists.rows[0].exists) {
                return {
                    enabled: false,
                    retentionDays: 0,
                    complianceLevel: 'basic',
                    recommendations: [
                        '❌ Audit logging table does not exist',
                        '✅ Create audit_logs table for security compliance',
                        '📋 Implement comprehensive audit trail',
                    ],
                };
            }

            // Check audit log retention and activity
            const auditStats = await query(`
        SELECT
          COUNT(*) as total_logs,
          MIN(created_at) as oldest_log,
          MAX(created_at) as newest_log,
          COUNT(DISTINCT user_id) as unique_users
        FROM audit_logs
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `);

            const stats = auditStats.rows[0] as {
                total_logs: number;
                oldest_log: string | null;
                newest_log: string | null;
                unique_users: number;
            };
            const retentionDays = stats.oldest_log
                ? Math.floor((Date.now() - new Date(stats.oldest_log).getTime()) / (1000 * 60 * 60 * 24))
                : 0;

            // Determine compliance level
            let complianceLevel: 'basic' | 'enhanced' | 'full' = 'basic';
            const recommendations: string[] = [];

            if (stats.total_logs > 1000 && stats.unique_users > 10) {
                complianceLevel = 'enhanced';
                recommendations.push('✅ Good audit logging activity detected');
            } else if (stats.total_logs > 100) {
                complianceLevel = 'basic';
                recommendations.push('⚠️ Basic audit logging is working');
            } else {
                recommendations.push('❌ Insufficient audit logging activity');
            }

            if (retentionDays < 90) {
                recommendations.push('⚠️ Consider extending audit log retention to 90+ days');
            } else {
                recommendations.push('✅ Adequate audit log retention period');
            }

            recommendations.push('📋 Implement automated audit log analysis');
            recommendations.push('🔄 Regular audit log backup and archiving');

            return {
                enabled: true,
                retentionDays,
                complianceLevel,
                recommendations,
            };
        } catch (error) {
            logger.error("Failed to assess audit logging", { error });

            return {
                enabled: false,
                retentionDays: 0,
                complianceLevel: 'basic',
                recommendations: [
                    '❌ Unable to assess audit logging',
                    '🔍 Manual audit log review required',
                    '✅ Ensure comprehensive audit trail implementation',
                ],
            };
        }
    }

    /**
     * Assess access controls
     */
    private async assessAccessControls(): Promise<SecurityAssessment['accessControls']> {
        try {
            const recommendations: string[] = [];

            // Check for RLS (Row Level Security) - basic check
            const rlsEnabled = await query<{ rls_policies: string }>(`
        SELECT COUNT(*) as rls_policies
        FROM pg_policies
        WHERE schemaname = 'public'
      `);

            const hasRLS = parseInt(rlsEnabled.rows[0].rls_policies) > 0;

            // Check connection encryption (SSL/TLS)
            const sslEnabled = await query<{ setting: string }>(`
        SELECT setting FROM pg_settings
        WHERE name = 'ssl'
      `);

            const hasSSL = sslEnabled.rows.length > 0 && sslEnabled.rows[0].setting === 'on';

            // Basic assessment
            if (hasRLS) {
                recommendations.push('✅ Row Level Security (RLS) is configured');
            } else {
                recommendations.push('⚠️ Consider implementing Row Level Security');
            }

            if (hasSSL) {
                recommendations.push('✅ SSL/TLS connection encryption is enabled');
            } else {
                recommendations.push('⚠️ Consider enabling SSL/TLS for database connections');
            }

            recommendations.push('📋 Implement principle of least privilege');
            recommendations.push('🔄 Regular access control audits');

            return {
                rowLevelSecurity: hasRLS,
                columnLevelSecurity: false, // Would need more complex checks
                connectionEncryption: hasSSL,
                recommendations,
            };
        } catch (error) {
            logger.error("Failed to assess access controls", { error });

            return {
                rowLevelSecurity: false,
                columnLevelSecurity: false,
                connectionEncryption: false,
                recommendations: [
                    '❌ Unable to assess access controls',
                    '🔍 Manual security review required',
                    '✅ Implement proper access controls and encryption',
                ],
            };
        }
    }

    /**
     * Generate encryption migration plan
     */
    async generateEncryptionMigrationPlan(): Promise<EncryptionMigrationPlan[]> {
        logger.info("Generating database encryption migration plan");

        const migrationPlans: EncryptionMigrationPlan[] = [];

        // Kodiak credentials migration
        migrationPlans.push({
            table: 'kodiak_credentials',
            columns: ['api_key', 'secret_key'],
            migrationStrategy: 'online', // Can be done while system is running
            estimatedDowntime: '0 minutes',
            rollbackPlan: 'Restore from backup and re-encrypt with old method',
            riskAssessment: 'low',
        });

        // User sessions migration (if exists)
        const userSessionsExists = await query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'user_sessions'
      )
    `);

        if ((userSessionsExists.rows[0] as { exists: boolean }).exists) {
            migrationPlans.push({
                table: 'user_sessions',
                columns: ['session_token', 'refresh_token'],
                migrationStrategy: 'hybrid',
                estimatedDowntime: '5 minutes',
                rollbackPlan: 'Clear all sessions and force re-authentication',
                riskAssessment: 'medium',
            });
        }

        logger.info("Encryption migration plan generated", {
            tablesToMigrate: migrationPlans.length,
        });

        return migrationPlans;
    }

    /**
     * Execute encryption migration for a table
     */
    async migrateTableEncryption(tableName: string, columns: string[]): Promise<{
        success: boolean;
        migratedRows: number;
        errors: string[];
    }> {
        logger.info("Starting encryption migration", { tableName, columns });

        const errors: string[] = [];
        let migratedRows = 0;

        try {
            // Get all rows that need migration
            const rows = await query(`SELECT id, ${columns.join(', ')} FROM ${tableName}`);

            for (const row of rows.rows as Array<Record<string, unknown>>) {
                try {
                    const updates: string[] = [];
                    const values: (string | number)[] = [];

                    for (const column of columns) {
                        if (row[column]) {
                            // Encrypt the value
                            const encryptedValue = await encryptionService.encryptWithVersion(row[column] as string);
                            updates.push(`${column}_encrypted = $${updates.length + 1}`);
                            values.push(encryptedValue);
                        }
                    }

                    if (updates.length > 0) {
                        values.push(row.id as string | number);
                        await query(
                            `UPDATE ${tableName} SET ${updates.join(', ')} WHERE id = $${values.length}`,
                            values
                        );
                        migratedRows++;
                    }
                } catch (rowError) {
                    const error = `Failed to migrate row ${row.id as string | number}: ${rowError}`;
                    errors.push(error);
                    logger.error("Row migration failed", { tableName, rowId: row.id as string | number, error: rowError });
                }
            }

            logger.info("Encryption migration completed", {
                tableName,
                migratedRows,
                errors: errors.length,
            });

            return {
                success: errors.length === 0,
                migratedRows,
                errors,
            };
        } catch (error) {
            logger.error("Encryption migration failed", { tableName, error });

            return {
                success: false,
                migratedRows,
                errors: [...errors, `Migration failed: ${error}`],
            };
        }
    }

    /**
     * Enable database-level encryption (PostgreSQL TDE)
     */
    async enableDatabaseEncryption(): Promise<{
        success: boolean;
        message: string;
        requiresRestart: boolean;
    }> {
        try {
            logger.info("Attempting to enable database encryption");

            // Check current encryption status
            const currentStatus = await query(`
        SELECT setting FROM pg_settings
        WHERE name = 'data_directory_encrypted'
      `);

            if (currentStatus.rows.length > 0 && (currentStatus.rows[0] as { setting: string }).setting === 'on') {
                return {
                    success: true,
                    message: 'Database encryption is already enabled',
                    requiresRestart: false,
                };
            }

            // Attempt to enable encryption
            // Note: This is a simplified version. In production, this would require:
            // 1. Stopping PostgreSQL
            // 2. Using pg_tde or file system encryption
            // 3. Restarting PostgreSQL

            await query(`ALTER SYSTEM SET data_directory_encrypted = on`);

            logger.warn("Database encryption setting updated - RESTART REQUIRED", {
                action: 'ALTER SYSTEM SET data_directory_encrypted = on',
                restartRequired: true,
            });

            return {
                success: true,
                message: 'Database encryption enabled - PostgreSQL restart required',
                requiresRestart: true,
            };
        } catch (error) {
            logger.error("Failed to enable database encryption", { error });

            return {
                success: false,
                message: `Failed to enable database encryption: ${error}`,
                requiresRestart: false,
            };
        }
    }

    /**
     * Get security metrics for monitoring
     */
    async getSecurityMetrics(): Promise<{
        encryptedRecords: number;
        totalRecords: number;
        encryptionCoverage: number;
        lastSecurityCheck: string;
        securityScore: number;
    }> {
        try {
            // Count encrypted vs total records in sensitive tables
            const sensitiveTables = ['kodiak_credentials', 'user_sessions'];
            let totalEncrypted = 0;
            let totalRecords = 0;

            for (const table of sensitiveTables) {
                const tableExists = await query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = $1
          )
        `, [table]);

                if ((tableExists.rows[0] as { exists: boolean }).exists) {
                    const stats = await query<{
                        total: string;
                        encrypted: string;
                    }>(`
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN api_key_encrypted IS NOT NULL THEN 1 END) +
              COUNT(CASE WHEN secret_key_encrypted IS NOT NULL THEN 1 END) as encrypted
            FROM ${table}
          `);

                    totalRecords += parseInt(stats.rows[0].total);
                    totalEncrypted += parseInt(stats.rows[0].encrypted);
                }
            }

            const encryptionCoverage = totalRecords > 0 ? (totalEncrypted / totalRecords) * 100 : 0;
            const securityScore = Math.min(100, encryptionCoverage * 0.8 + 20); // Max 100, with base score

            return {
                encryptedRecords: totalEncrypted,
                totalRecords,
                encryptionCoverage,
                lastSecurityCheck: new Date().toISOString(),
                securityScore,
            };
        } catch (error) {
            logger.error("Failed to get security metrics", { error });

            return {
                encryptedRecords: 0,
                totalRecords: 0,
                encryptionCoverage: 0,
                lastSecurityCheck: new Date().toISOString(),
                securityScore: 0,
            };
        }
    }

    /**
     * Create security audit report
     */
    async generateSecurityAuditReport(): Promise<string> {
        const assessment = await this.assessDatabaseSecurity();
        const metrics = await this.getSecurityMetrics();

        const report = `
# Database Security Audit Report
Generated: ${new Date().toISOString()}

## Security Score: ${metrics.securityScore}/100

## Encryption Status
- Status: ${assessment.databaseEncryption.status.toUpperCase()}
- Type: ${assessment.databaseEncryption.type}
- Enabled: ${assessment.databaseEncryption.enabled}

### Recommendations:
${assessment.databaseEncryption.recommendations.map(r => `- ${r}`).join('\n')}

## Sensitive Data Protection
- Risk Level: ${assessment.sensitiveDataProtection.riskLevel.toUpperCase()}
- Encrypted Fields: ${assessment.sensitiveDataProtection.encryptedFields.length}
- Unencrypted Fields: ${assessment.sensitiveDataProtection.unencryptedFields.length}

### Recommendations:
${assessment.sensitiveDataProtection.recommendations.map(r => `- ${r}`).join('\n')}

## Audit Logging
- Enabled: ${assessment.auditLogging.enabled}
- Retention: ${assessment.auditLogging.retentionDays} days
- Compliance: ${assessment.auditLogging.complianceLevel}

### Recommendations:
${assessment.auditLogging.recommendations.map(r => `- ${r}`).join('\n')}

## Access Controls
- Row Level Security: ${assessment.accessControls.rowLevelSecurity}
- Connection Encryption: ${assessment.accessControls.connectionEncryption}

### Recommendations:
${assessment.accessControls.recommendations.map(r => `- ${r}`).join('\n')}

## Metrics
- Encrypted Records: ${metrics.encryptedRecords}/${metrics.totalRecords}
- Encryption Coverage: ${metrics.encryptionCoverage.toFixed(1)}%
- Last Check: ${metrics.lastSecurityCheck}
`;

        logger.info("Security audit report generated", {
            securityScore: metrics.securityScore,
            encryptionCoverage: metrics.encryptionCoverage,
        });

        return report;
    }
}

// Export singleton instance
export const databaseSecurityService = new DatabaseSecurityService();
