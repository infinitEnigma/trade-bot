/** @format */

/**
 * Authentication Feature
 *
 * Handles user authentication, authorization, and profile management.
 * This feature manages login/logout flows, user sessions, and permissions.
 */

// Core functionality
export { useAuth } from "./hooks";
export { authService } from "./services";

// Types
export type {
    AuthUser,
    LoginCredentials,
    RegisterData,
    AuthState,
    AuthActions,
    AuthContextType,
    QualificationStatus
} from "./types";

// Components (to be added)
// export { LoginForm } from "./components";
// export { RegisterForm } from "./components";
