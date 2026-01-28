/** @format */

import { User } from "../../../../../shared/src";

/**
 * Authentication-related type definitions
 */

export type AuthUser = User;

export interface LoginCredentials {
    email: string;
    password: string;
}

export interface RegisterData {
    email: string;
    password: string;
}

export interface AuthState {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
}

export interface AuthActions {
    login: (credentials: LoginCredentials) => Promise<void>;
    register: (data: RegisterData) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    checkAuth: () => Promise<void>;
}

export interface AuthContextType extends AuthState, AuthActions { }

export interface QualificationStatus {
    isQualified: boolean;
    requirements: string[];
    progress: number;
}
