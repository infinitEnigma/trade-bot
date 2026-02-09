/** @format */

import { UserRole } from '../index';
import { ICacheService, ILogger } from './infrastructure';

// ===========================================
// ROLE MANAGEMENT REPOSITORY INTERFACE
// ===========================================

export interface IRoleRepository {
    /**
     * Assign a role to a user
     */
    assignRole(userId: string, role: UserRole, grantedBy: string, criteria?: unknown): Promise<void>;

    /**
     * Remove a role from a user
     */
    removeRole(userId: string, role: UserRole): Promise<boolean>;

    /**
     * Check if user has a specific role
     */
    hasRole(userId: string, role: UserRole): Promise<boolean>;

    /**
     * Get all roles for a user
     */
    getUserRoles(userId: string): Promise<UserRole[]>;

    /**
     * Get role details including grant information
     */
    getRoleDetails(userId: string, role: UserRole): Promise<RoleDetails | null>;

    /**
     * List all users with a specific role (admin function)
     */
    getUsersWithRole(role: UserRole): Promise<UserRoleAssignment[]>;
}

// ===========================================
// AUDIT LOGGING INTERFACE
// ===========================================

export interface IAuditLogger {
    /**
     * Log an audit event
     */
    logEvent(event: AuditEvent): Promise<void>;
}

export interface AuditEvent {
    userId: string | null;
    action: string;
    details: Record<string, unknown>;
}

// ===========================================
// DOMAIN MODELS FOR ROLE MANAGEMENT
// ===========================================

export class UserRoleAssignment {
    constructor(
        public userId: string,
        public role: UserRole,
        public grantedAt: Date,
        public grantedBy: string,
        public criteriaMet?: unknown
    ) { }

    /**
     * Check if assignment is valid
     */
    isValid(): boolean {
        return (
            this.userId.length > 0 &&
            this.role !== undefined &&
            this.grantedAt instanceof Date &&
            this.grantedBy.length > 0
        );
    }

    /**
     * Get assignment age in days
     */
    getAgeInDays(): number {
        const now = new Date();
        const diff = now.getTime() - this.grantedAt.getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    }

    /**
     * Check if assignment was granted by system
     */
    isSystemGranted(): boolean {
        return this.grantedBy === 'system';
    }
}

export class RoleDetails {
    constructor(
        public grantedAt: Date,
        public grantedBy: string,
        public criteriaMet?: unknown
    ) { }

    /**
     * Check if criteria were met during assignment
     */
    hasCriteria(): boolean {
        return this.criteriaMet !== undefined && this.criteriaMet !== null;
    }

    /**
     * Get criteria as specific type
     */
    getCriteria<T>(): T | undefined {
        return this.criteriaMet as T | undefined;
    }
}

// ===========================================
// ROLE HIERARCHY AND PERMISSIONS
// ===========================================

export class RoleHierarchy {
    private static readonly HIERARCHY = new Map<UserRole, number>([
        [UserRole.QUALIFIED_ALPHA, 100]
    ]);

    /**
     * Check if user role has permission for required role
     */
    static hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
        const userLevel = this.HIERARCHY.get(userRole) || 0;
        const requiredLevel = this.HIERARCHY.get(requiredRole) || 0;
        return userLevel >= requiredLevel;
    }

    /**
     * Get role level (higher number = higher privilege)
     */
    static getRoleLevel(role: UserRole): number {
        return this.HIERARCHY.get(role) || 0;
    }

    /**
     * Check if role is administrative
     */
    static isAdminRole(role: UserRole): boolean {
        return this.getRoleLevel(role) >= 50;
    }

    /**
     * Get all roles at or above specified level
     */
    static getRolesAtOrAbove(level: number): UserRole[] {
        return Array.from(this.HIERARCHY.entries())
            .filter(([_, roleLevel]) => roleLevel >= level)
            .map(([role, _]) => role);
    }
}

// ===========================================
// ROLE MANAGEMENT SERVICE INTERFACE
// ===========================================

export interface IRoleManagementService {
    /**
     * Assign a role to a user
     */
    assignRole(userId: string, role: UserRole, grantedBy?: string, criteria?: unknown): Promise<void>;

    /**
     * Remove a role from a user
     */
    removeRole(userId: string, role: UserRole): Promise<void>;

    /**
     * Check if user has a specific role
     */
    hasRole(userId: string, role: UserRole): Promise<boolean>;

    /**
     * Get all roles for a user
     */
    getUserRoles(userId: string): Promise<UserRole[]>;

    /**
     * Get role details including grant information
     */
    getRoleDetails(userId: string, role: UserRole): Promise<RoleDetails | null>;

    /**
     * List all users with a specific role (admin function)
     */
    getUsersWithRole(role: UserRole): Promise<UserRoleAssignment[]>;

    /**
     * Revalidate role qualifications (periodic check)
     */
    revalidateRole(userId: string, role: UserRole): Promise<boolean>;
}

// ===========================================
// ROLE MANAGEMENT SERVICE DEPENDENCIES
// ===========================================

export interface RoleManagementServiceDependencies {
    roleRepository: IRoleRepository;
    auditLogger: IAuditLogger;
    cache: ICacheService;
    logger: ILogger;
}

// ===========================================
// ROLE QUALIFICATION INTERFACES
// ===========================================

export interface RoleQualificationResult {
    qualified: boolean;
    criteria?: unknown;
    reason?: string;
}

export interface IRoleQualificationService {
    /**
     * Check if user qualifies for a role
     */
    checkQualification(userId: string, role: UserRole): Promise<RoleQualificationResult>;

    /**
     * Get qualification criteria for a role
     */
    getQualificationCriteria(role: UserRole): Promise<unknown>;

    /**
     * Validate qualification criteria
     */
    validateCriteria(criteria: unknown, role: UserRole): boolean;
}