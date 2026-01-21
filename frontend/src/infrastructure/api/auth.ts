/** @format */

import { httpClient } from "./client";

/**
 * Authentication API endpoints
 * Handles user registration, login, and profile management
 */
export const authApi = {
    // Authentication endpoints
    async register(email: string, password: string) {
        const response = await httpClient.getClient().post("/api/auth/register", {
            email,
            password,
        });
        return response.data;
    },

    async login(email: string, password: string) {
        console.log("API: Making login request for:", email);
        const response = await httpClient.getClient().post("/api/auth/login", {
            email,
            password,
        });
        console.log("API: Login response received:", response.data);
        return response.data; // Now includes { success: true, user: {...} }
    },

    async getMe() {
        console.log("🔍 API: getMe() called from:", new Error().stack?.split('\n')[2]?.trim());
        const response = await httpClient.getClient().get("/api/auth/me");
        console.log("🔍 API: getMe() response:", response.data);
        return response.data;
    },

    // Qualification endpoints
    async checkQualification() {
        const response = await httpClient.getClient().post("/api/auth/check-qualification");
        return response.data;
    },

    async getQualificationConfig() {
        const response = await httpClient.getClient().get("/api/auth/qualification-config");
        return response.data;
    },
};
