/** @format */

import {
    IRoleRepository,
    UserRole,
    RoleDetails,
    UserRoleAssignment
} from '@trade-bot/shared';
import { query } from '../../../database/pool';
import { logger } from '../../../core/logging';

/**
 * Role Repository Adapter - Clean Architecture Implementation
 *
 * Implements IRoleRepository interface using direct database access.
 * This adapter translates between the domain interface and the database implementation,
 * enabling dependency injection and testability for pure business logic.
 */
export class RoleRepositoryAdapter implements IRoleRepository {

    /**
     * Assign a role to a user
     */
    async assignRole(userId: string, role: UserRole, grantedBy: string, criteria?: unknown): Promise<void> {
        try {
            // Check if role already exists
            const existingRole = await query(
                "SELECT id FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );

            if (existingRole.rows.length > 0) {
                logger.debug("User already has role", { userId, role });
                return; // Role already assigned
            }

            // Assign the role
            const criteriaJson = criteria ? JSON.stringify(criteria) : null;
            await query(
                "INSERT INTO user_roles (user_id, role, granted_by, criteria_met) VALUES ($1, $2, $3, $4)",
                [userId, role, grantedBy, criteriaJson]
            );

            logger.info("Role assigned to user", {
                userId,
                role,
                grantedBy,
                criteria
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to assign role", {
                userId,
                role,
                grantedBy,
                error: errorMessage
            });
            throw error;
        }
    }

    /**
     * Remove a role from a user
     */
    async removeRole(userId: string, role: UserRole): Promise<boolean> {
        try {
            const result = await query(
                "DELETE FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );

            const removed = result.rowCount !== null && result.rowCount > 0;

            if (removed) {
                logger.info("Role removed from user", { userId, role });
            } else {
                logger.debug("Role not found for user", { userId, role });
            }

            return removed;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to remove role", {
                userId,
                role,
                error: errorMessage
            });
            throw error;
        }
    }

    /**
     * Check if user has a specific role
     */
    async hasRole(userId: string, role: UserRole): Promise<boolean> {
        try {
            const result = await query(
                "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2 LIMIT 1",
                [userId, role]
            );

            return result.rows.length > 0;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to check user role", {
                userId,
                role,
                error: errorMessage
            });
            return false;
        }
    }

    /**
     * Get all roles for a user
     */
    async getUserRoles(userId: string): Promise<UserRole[]> {
        try {
            const result = await query<{ role: UserRole }>(
                "SELECT role FROM user_roles WHERE user_id = $1",
                [userId]
            );

            return result.rows.map(row => row.role);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get user roles", {
                userId,
                error: errorMessage
            });
            return [];
        }
    }

    /**
     * Get role details including grant information
     */
    async getRoleDetails(userId: string, role: UserRole): Promise<RoleDetails | null> {
        try {
            const result = await query(
                "SELECT granted_at, granted_by, criteria_met FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0] as {
                granted_at: Date;
                granted_by: string;
                criteria_met?: string;
            };

            let criteriaMet: unknown = undefined;
            if (row.criteria_met) {
                try {
                    criteriaMet = JSON.parse(row.criteria_met);
                } catch (_parseError) {
                    criteriaMet = row.criteria_met;
                }
            }

            return new RoleDetails(
                row.granted_at,
                row.granted_by,
                criteriaMet
            );

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get role details", {
                userId,
                role,
                error: errorMessage
            });
            return null;
        }
    }

    /**
     * List all users with a specific role (admin function)
     */
    async getUsersWithRole(role: UserRole): Promise<UserRoleAssignment[]> {
        try {
            const result = await query(
                "SELECT user_id, granted_at, granted_by, criteria_met FROM user_roles WHERE role = $1 ORDER BY granted_at DESC",
                [role]
            );

            return result.rows.map(row => {
                const typedRow = row as {
                    user_id: string;
                    granted_at: Date;
                    granted_by: string;
                    criteria_met?: string;
                };

                let criteriaMet: unknown = undefined;
                if (typedRow.criteria_met) {
                    try {
                        criteriaMet = JSON.parse(typedRow.criteria_met);
                    } catch (_parseError) {
                        criteriaMet = typedRow.criteria_met;
                    }
                }

                return new UserRoleAssignment(
                    typedRow.user_id,
                    role,
                    typedRow.granted_at,
                    typedRow.granted_by,
                    criteriaMet
                );
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to get users with role", {
                role,
                error: errorMessage
            });
            return [];
        }
    }
}

// Export singleton instance
export const roleRepositoryAdapter = new RoleRepositoryAdapter();