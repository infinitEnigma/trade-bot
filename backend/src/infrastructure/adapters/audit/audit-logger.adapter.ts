/** @format */

import {
    IAuditLogger,
    AuditEvent
} from '@trade-bot/shared';
import { query } from '../../../database/pool';
import { logger } from '../../../core/logging';

/**
 * Audit Logger Adapter - Clean Architecture Implementation
 *
 * Implements IAuditLogger interface using direct database access.
 * This adapter provides structured audit logging for security and compliance.
 */
export class AuditLoggerAdapter implements IAuditLogger {

    /**
     * Log an audit event to the database
     */
    async logEvent(event: AuditEvent): Promise<void> {
        try {
            const detailsJson = JSON.stringify(event.details);

            await query(
                "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                [event.userId, event.action, detailsJson]
            );

            logger.debug("Audit event logged", {
                userId: event.userId,
                action: event.action,
                details: event.details
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to log audit event", {
                userId: event.userId,
                action: event.action,
                error: errorMessage
            });
            // Don't throw - audit logging should not fail business operations
        }
    }

    /**
     * Log multiple audit events in a batch
     */
    async logEvents(events: AuditEvent[]): Promise<void> {
        if (events.length === 0) return;

        try {
            // Use parameterized query for batch insertion to prevent SQL injection
            const placeholders = events.map((_, index) =>
                `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`
            ).join(', ');

            const values: unknown[] = events.reduce((acc: unknown[], event) => {
                return [...acc, event.userId, event.action, JSON.stringify(event.details)];
            }, []);

            await query(
                `INSERT INTO audit_logs (user_id, action, details) VALUES ${placeholders}`,
                values
            );

            logger.debug("Batch audit events logged", {
                count: events.length
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to log batch audit events", {
                count: events.length,
                error: errorMessage
            });
            // Don't throw - audit logging should not fail business operations
        }
    }

    /**
     * Get audit events for a user (admin function)
     */
    async getUserAuditEvents(userId: string, limit: number = 100): Promise<AuditEvent[]> {
        try {
            const result = await query(
                "SELECT action, details, created_at FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
                [userId, limit]
            );

            return result.rows.map(row => {
                const typedRow = row as {
                    action: string;
                    details: string;
                    created_at: Date;
                };

                let details: Record<string, unknown> = {};
                if (typedRow.details) {
                    try {
                        details = JSON.parse(typedRow.details);
                    } catch (_parseError) {
                        details = { raw: typedRow.details };
                    }
                }

                return {
                    userId,
                    action: typedRow.action,
                    details
                };
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get user audit events", {
                userId,
                error: errorMessage
            });
            return [];
        }
    }

    /**
     * Get audit events by action type (admin function)
     */
    async getAuditEventsByAction(action: string, limit: number = 100): Promise<AuditEvent[]> {
        try {
            const result = await query(
                "SELECT user_id, details, created_at FROM audit_logs WHERE action = $1 ORDER BY created_at DESC LIMIT $2",
                [action, limit]
            );

            return result.rows.map(row => {
                const typedRow = row as {
                    user_id: string;
                    details: string;
                    created_at: Date;
                };

                let details: Record<string, unknown> = {};
                if (typedRow.details) {
                    try {
                        details = JSON.parse(typedRow.details);
                    } catch (_parseError) {
                        details = { raw: typedRow.details };
                    }
                }

                return {
                    userId: typedRow.user_id,
                    action,
                    details
                };
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get audit events by action", {
                action,
                error: errorMessage
            });
            return [];
        }
    }
}

// Export singleton instance
export const auditLoggerAdapter = new AuditLoggerAdapter();