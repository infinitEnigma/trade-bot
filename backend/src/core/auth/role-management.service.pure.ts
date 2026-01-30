/** @format */

import {
    IRoleManagementService,
    UserRole,
    RoleDetails,
    UserRoleAssignment,
    RoleHierarchy,
    RoleQualificationResult,
    IRoleQualificationService
} from '@trade-bot/shared';
import { IRoleRepository, IAuditLogger, ICacheService, ILogger } from '@trade-bot/shared';
import { logger } from '../logging';

/**
 * Pure Role Management Service - Clean Architecture Implementation
 *
 * Business logic for role management with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IRoleRepository: Data access abstraction for role operations
 * - IAuditLogger: Audit logging abstraction for security events
 * - ICacheService: Caching abstraction for performance
 * - ILogger: Logging abstraction for structured logging
 * - IRoleQualificationService: Role qualification abstraction (optional)
 *
 * @format
 */

export interface RoleManagementServiceDependencies {
    roleRepository: IRoleRepository;
    auditLogger: IAuditLogger;
    cache: ICacheService;
    logger: ILogger;
    qualificationService?: IRoleQualificationService;
}

/**
 * Pure Role Management Service
 *
 * Implements role management business logic using dependency injection.
 * No direct dependencies on databases, audit tables, or logging frameworks.
 */
export class RoleManagementService implements IRoleManagementService {
    private readonly CACHE_TTL = 300; // 5 minutes for role data
    private readonly CACHE_PREFIX = 'role';

    constructor(private deps: RoleManagementServiceDependencies) { }

    /**
     * Assign a role to a user with validation and audit logging
     *
     * Business Logic:
     * 1. Validate role assignment permissions
     * 2. Check if user already has the role
     * 3. Assign role through repository
     * 4. Log audit event
     * 5. Invalidate user cache
     */
    async assignRole(userId: string, role: UserRole, grantedBy: string = 'system', criteria?: unknown): Promise<void> {
        try {
            this.deps.logger.debug("Role assignment attempt", { userId, role, grantedBy });

            // Check if user already has the role
            const existingRole = await this.deps.roleRepository.hasRole(userId, role);
            if (existingRole) {
                this.deps.logger.debug("User already has role", { userId, role });
                return;
            }

            // Assign the role through repository
            await this.deps.roleRepository.assignRole(userId, role, grantedBy, criteria);

            // Log audit event
            await this.deps.auditLogger.logEvent({
                userId,
                action: 'ROLE_ASSIGNED',
                details: { role, grantedBy, criteria }
            });

            // Invalidate user cache to ensure fresh data on next request
            await this.invalidateUserCache(userId);

            this.deps.logger.info("Role assigned successfully", {
                userId,
                role,
                grantedBy,
                criteria
            });

        } catch (error) {
            this.deps.logger.error("Role assignment failed", {
                userId,
                role,
                grantedBy,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Remove a role from a user with audit logging
     *
     * Business Logic:
     * 1. Remove role through repository
     * 2. Log audit event if removal was successful
     * 3. Invalidate user cache
     */
    async removeRole(userId: string, role: UserRole): Promise<void> {
        try {
            this.deps.logger.debug("Role removal attempt", { userId, role });

            // Remove role through repository
            const removed = await this.deps.roleRepository.removeRole(userId, role);

            if (removed) {
                // Log audit event
                await this.deps.auditLogger.logEvent({
                    userId,
                    action: 'ROLE_REMOVED',
                    details: { role }
                });

                // Invalidate user cache
                await this.invalidateUserCache(userId);

                this.deps.logger.info("Role removed successfully", { userId, role });
            } else {
                this.deps.logger.debug("Role not found for user", { userId, role });
            }

        } catch (error) {
            this.deps.logger.error("Role removal failed", {
                userId,
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Check if user has a specific role
     *
     * Business Logic:
     * - Query repository for role existence
     * - Return boolean result
     */
    async hasRole(userId: string, role: UserRole): Promise<boolean> {
        try {
            return await this.deps.roleRepository.hasRole(userId, role);
        } catch (error) {
            this.deps.logger.error("Failed to check user role", {
                userId,
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Get all roles for a user
     *
     * Business Logic:
     * - Query repository for all user roles
     * - Return array of roles
     */
    async getUserRoles(userId: string): Promise<UserRole[]> {
        try {
            return await this.deps.roleRepository.getUserRoles(userId);
        } catch (error) {
            this.deps.logger.error("Failed to get user roles", {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Get role details including grant information
     *
     * Business Logic:
     * - Query repository for role details
     * - Return structured role information
     */
    async getRoleDetails(userId: string, role: UserRole): Promise<RoleDetails | null> {
        try {
            return await this.deps.roleRepository.getRoleDetails(userId, role);
        } catch (error) {
            this.deps.logger.error("Failed to get role details", {
                userId,
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * List all users with a specific role (admin function)
     *
     * Business Logic:
     * - Query repository for users with role
     * - Return array of role assignments
     */
    async getUsersWithRole(role: UserRole): Promise<UserRoleAssignment[]> {
        try {
            return await this.deps.roleRepository.getUsersWithRole(role);
        } catch (error) {
            this.deps.logger.error("Failed to get users with role", {
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Revalidate role qualifications (periodic check)
     *
     * Business Logic:
     * - Check if qualification service is available
     * - Validate user still meets role criteria
     * - Remove role if qualification failed
     */
    async revalidateRole(userId: string, role: UserRole): Promise<boolean> {
        try {
            this.deps.logger.debug("Role revalidation attempt", { userId, role });

            // Check if qualification service is available
            if (!this.deps.qualificationService) {
                this.deps.logger.debug("No qualification service available, assuming role is valid", { userId, role });
                return true;
            }

            // Check if user still qualifies for the role
            const result = await this.deps.qualificationService.checkQualification(userId, role);

            if (!result.qualified) {
                // User no longer qualifies - remove the role
                await this.removeRole(userId, role);

                // Log the revalidation failure
                await this.deps.auditLogger.logEvent({
                    userId,
                    action: 'ROLE_REVALIDATION_FAILED',
                    details: { role, reason: result.reason, criteria: result.criteria }
                });

                this.deps.logger.info("Role removed due to failed revalidation", {
                    userId,
                    role,
                    reason: result.reason
                });

                return false;
            }

            this.deps.logger.debug("Role revalidation successful", { userId, role });
            return true;

        } catch (error) {
            this.deps.logger.error("Role revalidation failed", {
                userId,
                role,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Check if user has permission for a required role
     *
     * Business Logic:
     * - Use role hierarchy to check permissions
     * - Query user's roles if needed
     */
    async hasPermission(userId: string, requiredRole: UserRole): Promise<boolean> {
        try {
            // Get user's current roles
            const userRoles = await this.getUserRoles(userId);

            // Check if any of the user's roles has permission for the required role
            for (const userRole of userRoles) {
                if (RoleHierarchy.hasPermission(userRole, requiredRole)) {
                    return true;
                }
            }

            return false;

        } catch (error) {
            this.deps.logger.error("Failed to check user permissions", {
                userId,
                requiredRole,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Get user's highest role level
     */
    async getUserHighestRoleLevel(userId: string): Promise<number> {
        try {
            const userRoles = await this.getUserRoles(userId);
            let highestLevel = 0;

            for (const role of userRoles) {
                const level = RoleHierarchy.getRoleLevel(role);
                if (level > highestLevel) {
                    highestLevel = level;
                }
            }

            return highestLevel;

        } catch (error) {
            this.deps.logger.error("Failed to get user's highest role level", {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }

    /**
     * Check if user has administrative privileges
     */
    async isAdminUser(userId: string): Promise<boolean> {
        try {
            const userRoles = await this.getUserRoles(userId);

            for (const role of userRoles) {
                if (RoleHierarchy.isAdminRole(role)) {
                    return true;
                }
            }

            return false;

        } catch (error) {
            this.deps.logger.error("Failed to check if user is admin", {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Invalidate user cache after role changes
     */
    private async invalidateUserCache(userId: string): Promise<void> {
        const cacheKeys = [
            `${this.CACHE_PREFIX}:user:${userId}`,
            `${this.CACHE_PREFIX}:user:${userId}:roles`,
            `${this.CACHE_PREFIX}:user:${userId}:details`
        ];

        for (const cacheKey of cacheKeys) {
            try {
                await this.deps.cache.delete(cacheKey);
                this.deps.logger.debug("User cache invalidated", { userId, cacheKey });
            } catch (error) {
                this.deps.logger.warn("Failed to invalidate user cache", {
                    userId,
                    cacheKey,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }
}

// Export factory function for creating service instances
export function createRoleManagementService(deps: RoleManagementServiceDependencies): RoleManagementService {
    return new RoleManagementService(deps);
}