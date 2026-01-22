/**
 * Audit Log Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IAuditLogRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for audit log data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    IAuditLogRepository,
    AuditLogEntry
} from '../../../../../shared';
import { query } from '../../../database/pool';

/**
 * Audit Log Repository Adapter
 *
 * Implements the IAuditLogRepository interface using PostgreSQL database operations.
 * Provides audit log data access with proper error handling and type safety.
 */
export class AuditLogRepositoryAdapter implements IAuditLogRepository {

    /**
     * Log an audit event
     */
    async logEvent(event: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
        try {
            await query(
                'INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
                [event.userId, event.action, JSON.stringify(event.details), event.ipAddress, event.userAgent]
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Failed to log audit event: ${errorMessage}`);
            // Don't throw - audit logging failures shouldn't break business logic
        }
    }

    /**
     * Get audit logs for a user
     */
    async getUserLogs(userId: string, limit: number = 100): Promise<AuditLogEntry[]> {
        try {
            const result = await query(
                'SELECT id, user_id, action, details, ip_address, user_agent, created_at FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
                [userId, limit]
            );

            return result.rows.map(row => ({
                id: row.id,
                userId: row.user_id,
                action: row.action,
                details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
                timestamp: new Date(row.created_at),
                ipAddress: row.ip_address,
                userAgent: row.user_agent
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get audit logs: ${errorMessage}`);
        }
    }

    /**
     * Log authentication event (legacy method for backward compatibility)
     */
    async logAuthEvent(userId: string, event: string, ipAddress?: string, userAgent?: string): Promise<void> {
        await this.logEvent({
            userId,
            action: 'auth',
            details: { event },
            ipAddress,
            userAgent
        });
    }

    /**
     * Log API access event (legacy method for backward compatibility)
     */
    async logApiAccess(userId: string, endpoint: string, method: string, statusCode: number, ipAddress?: string): Promise<void> {
        await this.logEvent({
            userId,
            action: 'api_access',
            details: { endpoint, method, statusCode },
            ipAddress
        });
    }

    /**
     * Log security event (legacy method for backward compatibility)
     */
    async logSecurityEvent(userId: string, event: string, details: any, ipAddress?: string): Promise<void> {
        await this.logEvent({
            userId,
            action: 'security',
            details: { event, ...details },
            ipAddress
        });
    }

    /**
     * Get audit logs for a user (legacy method for backward compatibility)
     */
    async getUserAuditLogs(userId: string, limit: number = 100): Promise<any[]> {
        const logs = await this.getUserLogs(userId, limit);
        return logs.map(log => ({
            id: log.id,
            userId: log.userId,
            eventType: log.action,
            eventData: log.details,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            createdAt: log.timestamp
        }));
    }

    /**
     * Get security events within a time range (legacy method for backward compatibility)
     */
    async getSecurityEvents(startDate: Date, endDate: Date, limit: number = 1000): Promise<any[]> {
        try {
            const result = await query(
                'SELECT id, user_id, action, details, ip_address, created_at FROM audit_logs WHERE action = $1 AND created_at BETWEEN $2 AND $3 ORDER BY created_at DESC LIMIT $4',
                ['security', startDate, endDate, limit]
            );

            return result.rows.map(row => ({
                id: row.id,
                userId: row.user_id,
                eventType: row.action,
                eventData: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
                ipAddress: row.ip_address,
                createdAt: new Date(row.created_at)
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get security events: ${errorMessage}`);
        }
    }
}

// Export singleton instance
export const auditLogRepositoryAdapter = new AuditLogRepositoryAdapter();