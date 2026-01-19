/**
 * ===========================================
 * 🔐 AUTH DOMAIN - Authentication & Authorization
 * ===========================================
 *
 * Core business logic for user authentication, authorization,
 * and role-based access control.
 *
 * RESPONSIBILITIES:
 * - JWT token management and validation
 * - User authentication (login/register)
 * - Role-based permissions and access control
 * - Password hashing and security
 * - Session management
 *
 * @format
 */

// Export auth-related services
export { authService } from './auth.service';
export { roleManagementService } from './role-management.service';

// Export types
export type { User, AuthTokens, LoginCredentials } from './auth.service';
export type { UserRole, Permission } from './role-management.service';
