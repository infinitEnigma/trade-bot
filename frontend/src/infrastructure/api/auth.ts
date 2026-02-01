/** @format */

import { httpClient } from "./client";
import type { ApiResponse, LoginResponse, RegisterResponse, UserProfileResponse } from "@trade-bot/shared";

/**
 * Authentication API endpoints
 * Handles user registration, login, and profile management
 */
export const authApi = {
    // Authentication endpoints
    async register(email: string, password: string): Promise<ApiResponse<RegisterResponse>> {
        const response = await httpClient.getClient().post("/api/auth/register", {
            email,
            password,
        });
        return response.data;
    },

    async login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
        console.log("API: Making login request for:", email);
        const response = await httpClient.getClient().post("/api/auth/login", {
            email,
            password,
        });
        console.log("API: Login response received:", response.data);
        return response.data;
    },

    async getMe(): Promise<ApiResponse<any>> {
        console.log("🔍 API: getMe() called from:", new Error().stack?.split('\n')[2]?.trim());
        const response = await httpClient.getClient().get("/api/auth/me");
        console.log("🔍 API: getMe() response:", response.data);
        return response.data;
    },

    // Qualification endpoints
    async checkQualification(): Promise<ApiResponse<any>> {
        const response = await httpClient.getClient().post("/api/auth/check-qualification");
        return response.data;
    },

    async getQualificationConfig(): Promise<ApiResponse<any>> {
        const response = await httpClient.getClient().get("/api/auth/qualification-config");
        return response.data;
    },

    /**
     * Get user profile information
     */
    async getProfile(): Promise<ApiResponse<UserProfileResponse>> {
        const response = await httpClient.getClient().get("/api/user/profile");
        return response.data;
    },
};
