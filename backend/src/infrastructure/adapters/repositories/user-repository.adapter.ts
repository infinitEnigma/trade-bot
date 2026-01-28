/**
 * User Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IUserRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for user data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    IUserRepository,
    User,
    UserLevel,
    UserRegistration
} from '../../../shared/src';
import { query } from '../../../database/pool';

/**
 * Database row interface for user data
 */
interface UserRow {
    id: string;
    email: string;
    user_level: string;
    created_at: string;
    updated_at: string;
}

/**
 * User Repository Adapter
 *
 * Implements the IUserRepository interface using PostgreSQL database operations.
 * Provides user data access with proper error handling and type safety.
 */
export class UserRepositoryAdapter implements IUserRepository {

    /**
     * Find user by email address
     */
    async findByEmail(email: string): Promise<User | null> {
        try {
            const result = await query(
                'SELECT id, email, user_level, created_at, updated_at FROM users WHERE email = $1',
                [email]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0] as UserRow;
            return this.mapRowToUser(row);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to find user by email: ${errorMessage}`);
        }
    }

    /**
     * Find user by email with password hash for authentication
     */
    async findByEmailWithPassword(email: string): Promise<(User & { passwordHash: string }) | null> {
        try {
            const result = await query(
                'SELECT id, email, password_hash, user_level, created_at, updated_at FROM users WHERE email = $1',
                [email]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0] as UserRow & { password_hash?: string };
            return {
                ...this.mapRowToUser(row),
                passwordHash: row.password_hash || ''
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to find user by email with password: ${errorMessage}`);
        }
    }

    /**
     * Find user by ID
     */
    async findById(id: string): Promise<User | null> {
        try {
            const result = await query(
                'SELECT id, email, user_level, created_at, updated_at FROM users WHERE id = $1',
                [id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0] as UserRow;
            return this.mapRowToUser(row);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to find user by ID: ${errorMessage}`);
        }
    }

    /**
     * Create a new user
     */
    async create(userData: UserRegistration): Promise<User> {
        try {
            const result = await query(
                'INSERT INTO users (email, password_hash, user_level, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id, email, user_level, created_at, updated_at',
                [userData.email, userData.password, UserLevel.BASIC]
            );

            if (result.rows.length === 0) {
                throw new Error('User creation failed - no rows returned');
            }

            const row = result.rows[0] as UserRow;
            return this.mapRowToUser(row);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Handle unique constraint violation
            if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
                throw new Error('Email already exists');
            }

            throw new Error(`Failed to create user: ${errorMessage}`);
        }
    }

    /**
     * Update user's level
     */
    async updateUserLevel(id: string, level: UserLevel): Promise<boolean> {
        try {
            const result = await query(
                'UPDATE users SET user_level = $1, updated_at = NOW() WHERE id = $2',
                [level, id]
            );

            return result.rowCount > 0;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update user level: ${errorMessage}`);
        }
    }

    /**
     * Get authenticated user data with roles and credentials info
     */
    async getAuthenticatedUserData(id: string): Promise<{
        user: User;
        roles: string[];
        hasCredentials: boolean;
    } | null> {
        try {
            const result = await query(`
                SELECT
                    u.id,
                    u.email,
                    u.user_level,
                    u.created_at,
                    u.updated_at,
                    COALESCE(
                        JSON_AGG(
                            DISTINCT ur.role
                            ORDER BY ur.role
                        ) FILTER (WHERE ur.role IS NOT NULL),
                        '[]'::json
                    ) as roles,
                    CASE WHEN kc.id IS NOT NULL THEN true ELSE false END as has_credentials
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN kodiak_credentials kc ON u.id = kc.user_id AND kc.verified = true
                WHERE u.id = $1
                GROUP BY u.id, u.email, u.user_level, u.created_at, u.updated_at, kc.id
            `, [id]);

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0] as {
                id: string;
                email: string;
                user_level: string;
                created_at: string;
                updated_at: string;
                roles?: string[];
                has_credentials?: boolean;
            };
            const user = this.mapRowToUser({
                id: row.id,
                email: row.email,
                user_level: row.user_level,
                created_at: row.created_at,
                updated_at: row.updated_at
            });

            return {
                user,
                roles: row.roles || [],
                hasCredentials: row.has_credentials || false
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get authenticated user data: ${errorMessage}`);
        }
    }

    /**
     * Map database row to User domain object
     */
    private mapRowToUser(row: UserRow): User {
        return {
            id: row.id,
            email: row.email,
            userLevel: row.user_level as UserLevel,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }
}

// Export singleton instance
export const userRepositoryAdapter = new UserRepositoryAdapter();