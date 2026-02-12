/** @format */

import { authApi } from "../../../infrastructure/api/auth";

/**
 * Authentication Service
 * Handles all authentication-related business logic
 */
export class AuthService {
    private static instance: AuthService;

    private constructor() { }

    public static getInstance(): AuthService {
        if (!AuthService.instance) {
            AuthService.instance = new AuthService();
        }
        return AuthService.instance;
    }

    /**
     * Login user with email and password
     */
    async login(email: string, password: string) {
        try {
            const response = await authApi.login(email, password);
            return response;
        } catch (error) {
            console.error("Auth service login error:", error);
            throw error;
        }
    }

    /**
     * Register new user
     */
    async register(email: string, password: string) {
        try {
            const response = await authApi.register(email, password);
            return response;
        } catch (error) {
            console.error("Auth service register error:", error);
            throw error;
        }
    }

    /**
     * Get current user profile
     */
    async getProfile() {
        try {
            const response = await authApi.getMe();
            return response;
        } catch (error) {
            console.error("Auth service getProfile error:", error);
            throw error;
        }
    }

    /**
     * Check qualification status
     */
    async checkQualification() {
        try {
            const response = await authApi.checkQualification();
            return response;
        } catch (error) {
            console.error("Auth service checkQualification error:", error);
            throw error;
        }
    }

    /**
     * Get qualification configuration
     */
    async getQualificationConfig() {
        try {
            const response = await authApi.getQualificationConfig();
            return response;
        } catch (error) {
            console.error("Auth service getQualificationConfig error:", error);
            throw error;
        }
    }

    /**
     * Check admin qualification
     */
    async checkAdminQualification() {
        try {
            const response = await authApi.checkAdminQualification();
            return response;
        } catch (error) {
            console.error("Auth service checkAdminQualification error:", error);
            throw error;
        }
    }
}

export const authService = AuthService.getInstance();
