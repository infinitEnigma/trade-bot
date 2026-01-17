/** @format */

import { UserRole } from "@trade-bot/shared";
import { query } from "../database/pool";
import logger from "./logger";

export class RoleManagementService {
    /**
     * Assign a role to a user
     */
    async assignRole(
        userId: string,
        role: UserRole,
        grantedBy: string = 'system',
        criteria?: any
    ): Promise<void> {
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
            await query(
                "INSERT INTO user_roles (user_id, role, granted_by, criteria_met) VALUES ($1, $2, $3, $4)",
                [userId, role, grantedBy, criteria ? JSON.stringify(criteria) : null]
            );

            logger.info("Role assigned to user", {
                userId,
                role,
                grantedBy,
                criteria
            });

            // Log to audit trail
            await query(
                "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                [userId, "ROLE_ASSIGNED", { role, grantedBy, criteria }]
            );

        } catch (error) {
            logger.error("Failed to assign role", {
                userId,
                role,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Remove a role from a user
     */
    async removeRole(userId: string, role: UserRole): Promise<void> {
        try {
            const result = await query(
                "DELETE FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );

            if (result.rowCount && result.rowCount > 0) {
                logger.info("Role removed from user", { userId, role });

                // Log to audit trail
                await query(
                    "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                    [userId, "ROLE_REMOVED", { role }]
                );
            } else {
                logger.debug("Role not found for user", { userId, role });
            }

        } catch (error) {
            logger.error("Failed to remove role", {
                userId,
                role,
                error: (error as Error).message
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
            logger.error("Failed to check user role", {
                userId,
                role,
                error: (error as Error).message
            });
            return false;
        }
    }

    /**
     * Get all roles for a user
     */
    async getUserRoles(userId: string): Promise<UserRole[]> {
        try {
            const result = await query(
                "SELECT role FROM user_roles WHERE user_id = $1",
                [userId]
            );

            return result.rows.map(row => row.role as UserRole);
        } catch (error) {
            logger.error("Failed to get user roles", {
                userId,
                error: (error as Error).message
            });
            return [];
        }
    }

    /**
     * Get role details including grant information
     */
    async getRoleDetails(userId: string, role: UserRole): Promise<{
        grantedAt: Date;
        grantedBy: string;
        criteriaMet?: any;
    } | null> {
        try {
            const result = await query(
                "SELECT granted_at, granted_by, criteria_met FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0];
            return {
                grantedAt: row.granted_at,
                grantedBy: row.granted_by,
                criteriaMet: row.criteria_met ? JSON.parse(row.criteria_met) : undefined
            };

        } catch (error) {
            logger.error("Failed to get role details", {
                userId,
                role,
                error: (error as Error).message
            });
            return null;
        }
    }

    /**
     * List all users with a specific role (admin function)
     */
    async getUsersWithRole(role: UserRole): Promise<Array<{
        userId: string;
        grantedAt: Date;
        grantedBy: string;
    }>> {
        try {
            const result = await query(
                "SELECT user_id, granted_at, granted_by FROM user_roles WHERE role = $1 ORDER BY granted_at DESC",
                [role]
            );

            return result.rows.map(row => ({
                userId: row.user_id,
                grantedAt: row.granted_at,
                grantedBy: row.granted_by
            }));

        } catch (error) {
            logger.error("Failed to get users with role", {
                role,
                error: (error as Error).message
            });
            return [];
        }
    }

    /**
     * Revalidate role qualifications (periodic check)
     * This could be called by a cron job to ensure users still meet criteria
     */
    async revalidateRole(userId: string, role: UserRole): Promise<boolean> {
        try {
            // For now, only handle QUALIFIED_ALPHA revalidation
            if (role === UserRole.QUALIFIED_ALPHA) {
                const { walletQualificationService } = await import('./wallet-qualification.js');
                const result = await walletQualificationService.checkAlphaQualification(userId);

                if (!result.qualified) {
                    // Remove role if no longer qualified
                    await this.removeRole(userId, role);
                    logger.info("Role removed due to failed revalidation", { userId, role });
                    return false;
                }

                return true;
            }

            // For other roles, assume they remain valid
            return true;

        } catch (error) {
            logger.error("Role revalidation failed", {
                userId,
                role,
                error: (error as Error).message
            });
            return false;
        }
    }
}

// Export singleton instance
export const roleManagementService = new RoleManagementService();
