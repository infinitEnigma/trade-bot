/** @format */

import { httpClient } from "./client";
import type {
  ApiResponse,
  LoginResponse,
  RegisterResponse,
} from "@trade-bot/shared";

/**
 * User record as returned by the auth endpoints. Kept intentionally loose
 * (timestamps are ISO strings over the wire) so it stays directly assignable
 * from the parsed JSON without leaking `any`.
 */
export interface AuthUserProfile {
  id: string;
  email: string;
  userLevel: string;
  roles?: string[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * Payload of `GET /api/user/profile`.
 */
export interface UserProfilePayload {
  user: AuthUserProfile;
  kodiakStatus?: {
    accountId: string;
    verified: boolean;
  };
}

/**
 * Payload of the qualification endpoints (`check-qualification`,
 * `qualification-config`, `check-admin-qualification`).
 *
 * NOTE: the backend serialises these fields at the top level of the response
 * body rather than under `data`; the client reads them from `data`, so this
 * mirrors the existing client-side view. Reconciling the two would change
 * which roles the UI reports and is tracked separately.
 */
export interface QualificationPayload {
  qualified?: boolean;
  /** Field name read by the admin-qualification flow. */
  isQualified?: boolean;
  reasons?: string[];
  reason?: string;
  criteria?: unknown;
  walletConnected?: boolean;
  chainValid?: boolean;
  config?: Record<string, unknown>;
}

/**
 * Authentication API endpoints
 * Handles user registration, login, and profile management
 */
export const authApi = {
  // Authentication endpoints
  async register(
    email: string,
    password: string
  ): Promise<ApiResponse<RegisterResponse>> {
    const response = await httpClient.getClient().post("/api/auth/register", {
      email,
      password,
    });
    return response.data;
  },

  async login(
    email: string,
    password: string
  ): Promise<ApiResponse<LoginResponse>> {
    console.log("API: Making login request for:", email);
    const response = await httpClient.getClient().post("/api/auth/login", {
      email,
      password,
    });
    console.log("API: Login response received:", response.data);
    return response.data;
  },

  async getMe(): Promise<ApiResponse<AuthUserProfile>> {
    console.log(
      "🔍 API: getMe() called from:",
      new Error().stack?.split("\n")[2]?.trim()
    );
    const response = await httpClient.getClient().get("/api/auth/me");
    console.log("🔍 API: getMe() response:", response.data);
    return response.data;
  },

  // Qualification endpoints
  async checkQualification(): Promise<ApiResponse<QualificationPayload>> {
    const response = await httpClient
      .getClient()
      .post("/api/auth/check-qualification");
    return response.data;
  },

  async getQualificationConfig(): Promise<ApiResponse<QualificationPayload>> {
    const response = await httpClient
      .getClient()
      .get("/api/auth/qualification-config");
    return response.data;
  },

  /**
   * Get user profile information
   */
  async getProfile(): Promise<ApiResponse<UserProfilePayload>> {
    const response = await httpClient.getClient().get("/api/user/profile");
    return response.data;
  },

  /**
   * Check admin qualification
   */
  async checkAdminQualification(): Promise<ApiResponse<QualificationPayload>> {
    const response = await httpClient
      .getClient()
      .post("/api/auth/check-admin-qualification");
    return response.data;
  },
};
