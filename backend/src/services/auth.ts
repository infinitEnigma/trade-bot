/** @format */

import "dotenv/config";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { UserLevel } from "@trade-bot/shared";
import { pool } from "../database";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "your-refresh-secret";
const ACCESS_TOKEN_EXPIRY = "1h";
const REFRESH_TOKEN_EXPIRY = "7d";

export interface TokenPayload {
  userId: string;
  email: string;
  userLevel: UserLevel;
}

export interface AuthResult {
  success: boolean;
  message?: string;
  user?: {
    id: string;
    email: string;
    userLevel: UserLevel;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

export class AuthService {
  async register(email: string, password: string): Promise<AuthResult> {
    try {
      const existingUser = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );
      if (existingUser.rows.length > 0) {
        return { success: false, message: "Email already registered" };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        "INSERT INTO users (email, password_hash, user_level) VALUES ($1, $2, $3) RETURNING id, email, user_level",
        [email, passwordHash, UserLevel.BASIC]
      );

      const user = result.rows[0];
      const tokens = this.generateTokens(user);

      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [user.id, "USER_REGISTERED", { email: user.email }]
      );

      return {
        success: true,
        user: { id: user.id, email: user.email, userLevel: user.user_level },
        tokens,
      };
    } catch (error) {
      console.error("Registration error:", error);
      return { success: false, message: "Registration failed" };
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const result = await pool.query(
        "SELECT id, email, password_hash, user_level FROM users WHERE email = $1",
        [email]
      );

      if (result.rows.length === 0) {
        return { success: false, message: "Invalid credentials" };
      }

      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        return { success: false, message: "Invalid credentials" };
      }

      const tokens = this.generateTokens(user);

      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [user.id, "USER_LOGIN", { email: user.email }]
      );

      return {
        success: true,
        user: { id: user.id, email: user.email, userLevel: user.user_level },
        tokens,
      };
    } catch (error) {
      console.error("Login error:", error);
      return { success: false, message: "Login failed" };
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      const decoded = jwt.verify(
        refreshToken,
        JWT_REFRESH_SECRET
      ) as TokenPayload;

      const result = await pool.query(
        "SELECT id, email, user_level FROM users WHERE id = $1",
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return { success: false, message: "User not found" };
      }

      const user = result.rows[0];
      const tokens = this.generateTokens(user);

      return {
        success: true,
        user: { id: user.id, email: user.email, userLevel: user.user_level },
        tokens,
      };
    } catch (error) {
      return { success: false, message: "Invalid refresh token" };
    }
  }

  async validateToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  async getUserById(
    userId: string
  ): Promise<{ id: string; email: string; userLevel: UserLevel } | null> {
    try {
      const result = await pool.query(
        "SELECT id, email, user_level FROM users WHERE id = $1",
        [userId]
      );

      if (result.rows.length === 0) return null;

      const user = result.rows[0];
      return { id: user.id, email: user.email, userLevel: user.user_level };
    } catch {
      return null;
    }
  }

  async updateUserLevel(userId: string, level: UserLevel): Promise<boolean> {
    try {
      await pool.query(
        "UPDATE users SET user_level = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [level, userId]
      );
      return true;
    } catch {
      return false;
    }
  }

  private generateTokens(user: {
    id: string;
    email: string;
    user_level: UserLevel;
  }) {
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      userLevel: user.user_level,
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    });

    const expiresIn = 60 * 60; // 1 hour in seconds

    return { accessToken, refreshToken, expiresIn };
  }
}

export const authService = new AuthService();
