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
  UserRegistration,
} from "@trade-bot/shared";
import { query } from "../../../database/pool";

/**
 * Database row interface for user data
 */
interface UserRow {
  id: string;
  username: string;
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
        "SELECT id, username, email, user_level, created_at, updated_at FROM users WHERE email = $1",
        [email]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as UserRow;
      return this.mapRowToUser(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to find user by email: ${errorMessage}`);
    }
  }

  /**
   * Find user by email with password hash for authentication
   */
  async findByEmailWithPassword(
    email: string
  ): Promise<(User & { passwordHash: string }) | null> {
    try {
      const result = await query(
        "SELECT id, username, email, password_hash, user_level, created_at, updated_at FROM users WHERE email = $1",
        [email]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as UserRow & { password_hash?: string };
      return {
        ...this.mapRowToUser(row),
        passwordHash: row.password_hash || "",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to find user by email with password: ${errorMessage}`
      );
    }
  }

  /**
   * Find user by username handle — registration uniqueness checks (C1).
   * Case-insensitive to match the uq_users_username index on LOWER(username).
   */
  async findByUsername(username: string): Promise<User | null> {
    try {
      const result = await query(
        "SELECT id, username, email, user_level, created_at, updated_at FROM users WHERE LOWER(username) = LOWER($1)",
        [username]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as UserRow;
      return this.mapRowToUser(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to find user by username: ${errorMessage}`);
    }
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    try {
      const result = await query(
        "SELECT id, username, email, user_level, created_at, updated_at FROM users WHERE id = $1",
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as UserRow;
      return this.mapRowToUser(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to find user by ID: ${errorMessage}`);
    }
  }

  /**
   * Create a new user
   */
  async create(userData: UserRegistration): Promise<User> {
    try {
      // One atomic statement: the user row plus its password identity row
      // (C1 identity redesign — mirrors the 011 backfill shape).
      const userResult = await query(
        `WITH new_user AS (
           INSERT INTO users (username, email, password_hash, user_level, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING id, username, email, user_level, created_at, updated_at
         ),
         password_identity AS (
           INSERT INTO user_identities (user_id, provider, identifier, secret_hash, is_primary, verified_at)
           SELECT id, 'password', lower($2), $3, TRUE, now() FROM new_user
         )
         SELECT * FROM new_user`,
        [userData.username, userData.email, userData.password, UserLevel.BASIC]
      );

      if (userResult.rows.length === 0) {
        throw new Error("User creation failed - no rows returned");
      }

      const row = userResult.rows[0] as UserRow;
      return this.mapRowToUser(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Handle unique constraint violations — the username index and the
      // email constraint get distinct friendly messages (C1).
      if (
        errorMessage.includes("duplicate key") ||
        errorMessage.includes("unique constraint")
      ) {
        if (errorMessage.includes("username")) {
          throw new Error("Username already exists");
        }
        throw new Error("Email already exists");
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
        "UPDATE users SET user_level = $1, updated_at = NOW() WHERE id = $2",
        [level, id]
      );

      return result.rowCount > 0;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update user level: ${errorMessage}`);
    }
  }

  /**
   * Update user profile information
   */
  async updateProfile(
    id: string,
    updates: Partial<{ email: string; userLevel: UserLevel }>
  ): Promise<User | null> {
    try {
      // Build update query dynamically based on provided fields
      const updateFields: string[] = [];
      const updateValues: unknown[] = [];
      let valueIndex = 1;

      if (updates.email) {
        updateFields.push(`email = $${valueIndex}`);
        updateValues.push(updates.email.toLowerCase());
        valueIndex++;
      }

      if (updates.userLevel) {
        updateFields.push(`user_level = $${valueIndex}`);
        updateValues.push(updates.userLevel);
        valueIndex++;
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(id); // For the WHERE clause

      const result = await query(
        `UPDATE users SET ${updateFields.join(", ")} WHERE id = $${valueIndex} RETURNING id, username, email, user_level, created_at, updated_at`,
        updateValues
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as UserRow;
      return this.mapRowToUser(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Handle unique constraint violation for email
      if (
        errorMessage.includes("duplicate key") ||
        errorMessage.includes("unique constraint")
      ) {
        throw new Error("Email already exists");
      }

      throw new Error(`Failed to update user profile: ${errorMessage}`);
    }
  }

  /**
   * Mirror the current email into user_identities (provider='email').
   *
   * C1 bookkeeping: login still reads users.email, so a failure here must
   * not fail the profile update itself — log-and-continue semantics live in
   * the caller. The statement drops this user's previous email rows and
   * inserts the current one; ON CONFLICT re-homes a stale row (possible only
   * if another user's history still references this address) to the owner of
   * the address users.email says is current.
   */
  async upsertEmailIdentity(userId: string, email: string): Promise<void> {
    try {
      await query(
        `WITH del AS (
           DELETE FROM user_identities
           WHERE user_id = $1 AND provider = 'email'
         )
         INSERT INTO user_identities (user_id, provider, identifier, is_primary)
         VALUES ($1, 'email', lower($2), FALSE)
         ON CONFLICT (provider, identifier)
         DO UPDATE SET user_id = EXCLUDED.user_id`,
        [userId, email]
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to upsert email identity: ${errorMessage}`);
    }
  }

  /**
   * Get authenticated user data with roles and credentials info
   */
  async getAuthenticatedUserData(id: string): Promise<{
    user: User;
    roles: string[];
    hasCredentials: boolean;
    kodiakAccountId?: string;
    kodiakVerified?: boolean;
  } | null> {
    try {
      const result = await query(
        `
                SELECT
                    u.id,
                    u.username,
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
                    CASE WHEN kc.id IS NOT NULL THEN true ELSE false END as has_credentials,
                    kc.account_id as kodiak_account_id,
                    kc.verified as kodiak_verified
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN kodiak_credentials kc ON u.id = kc.user_id
                WHERE u.id = $1
                GROUP BY u.id, u.username, u.email, u.user_level, u.created_at, u.updated_at, kc.id, kc.account_id, kc.verified
            `,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        id: string;
        username: string;
        email: string;
        user_level: string;
        created_at: string;
        updated_at: string;
        roles?: string[];
        has_credentials?: boolean;
        kodiak_account_id?: string;
        kodiak_verified?: boolean;
      };
      const user = this.mapRowToUser({
        id: row.id,
        username: row.username,
        email: row.email,
        user_level: row.user_level,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });

      return {
        user,
        roles: row.roles || [],
        hasCredentials: row.has_credentials || false,
        kodiakAccountId: row.kodiak_account_id,
        kodiakVerified: row.kodiak_verified,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get authenticated user data: ${errorMessage}`);
    }
  }

  /**
   * Get user's linked wallet address
   *
   * Reads from wallet_addresses (linked via signed-message verification).
   * Falls back to kodiak_credentials for legacy rows created before the
   * wallet-first flow (addresses fetched from the Kodiak API).
   */
  async getWalletAddress(userId: string): Promise<string | null> {
    try {
      const result = await query<{ wallet_address: string }>(
        "SELECT wallet_address FROM wallet_addresses WHERE user_id = $1",
        [userId]
      );

      if (result.rows.length > 0 && result.rows[0].wallet_address) {
        return result.rows[0].wallet_address;
      }

      // Legacy fallback: wallets stored alongside Kodiak credentials
      const legacy = await query<{ wallet_address: string }>(
        "SELECT wallet_address FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
        [userId]
      );

      if (legacy.rows.length === 0) {
        return null;
      }

      return legacy.rows[0].wallet_address;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get wallet address: ${errorMessage}`);
    }
  }

  /**
   * Link a wallet address to a user (upsert)
   */
  async setWalletAddress(
    userId: string,
    walletAddress: string
  ): Promise<boolean> {
    try {
      const result = await query(
        `INSERT INTO wallet_addresses (user_id, wallet_address, verified, updated_at)
         VALUES ($1, $2, true, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET
           wallet_address = EXCLUDED.wallet_address,
           verified = true,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, walletAddress]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to set wallet address: ${errorMessage}`);
    }
  }

  /**
   * Remove the wallet linked to a user
   */
  async clearWalletAddress(userId: string): Promise<boolean> {
    try {
      const result = await query(
        "DELETE FROM wallet_addresses WHERE user_id = $1",
        [userId]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to clear wallet address: ${errorMessage}`);
    }
  }

  /**
   * Map database row to User domain object
   */
  private mapRowToUser(row: UserRow): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      userLevel: row.user_level as UserLevel,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Export singleton instance
export const userRepositoryAdapter = new UserRepositoryAdapter();
