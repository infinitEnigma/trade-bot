/** @format */

import { useContext, useCallback } from "react";
import { ErrorContext } from "./error-context";
import type { ErrorType, ErrorAction } from "../shared/components/ui/error-types";

/**
 * Hook to use error context
 * Must be used within an ErrorProvider
 */
export const useErrorContext = (): {
    errors: {
        id: string;
        timestamp: Date;
        type?: ErrorType;
        title?: string;
        message?: string;
        description?: string;
        actions?: ErrorAction[];
        showReport?: boolean;
        showHome?: boolean;
        className?: string;
        size?: "sm" | "md" | "lg" | "xl";
        icon?: React.ReactNode;
        status?: 'idle' | 'pending' | 'success' | 'failed';
        retryCount?: number;
        lastRetryAt?: Date;
        maxRetries?: number;
        retryCooldownMs?: number;
        circuitBreakerState?: 'closed' | 'open' | 'half-open';
        consecutiveFailures?: number;
        lastFailureAt?: Date;
        backoffMultiplier?: number;
        nextRetryAt?: Date;
    }[];
    addError: (error: Omit<{
        id: string;
        timestamp: Date;
        type?: ErrorType;
        title?: string;
        message?: string;
        description?: string;
        actions?: ErrorAction[];
        showReport?: boolean;
        showHome?: boolean;
        className?: string;
        size?: "sm" | "md" | "lg" | "xl";
        icon?: React.ReactNode;
        status?: 'idle' | 'pending' | 'success' | 'failed';
        retryCount?: number;
        lastRetryAt?: Date;
        maxRetries?: number;
        retryCooldownMs?: number;
        circuitBreakerState?: 'closed' | 'open' | 'half-open';
        consecutiveFailures?: number;
        lastFailureAt?: Date;
        backoffMultiplier?: number;
        nextRetryAt?: Date;
    }, 'id' | 'timestamp'>) => string;
    removeError: (id: string) => void;
    clearErrors: () => void;
    updateError: (id: string, updates: Partial<{
        id: string;
        timestamp: Date;
        type?: ErrorType;
        title?: string;
        message?: string;
        description?: string;
        actions?: ErrorAction[];
        showReport?: boolean;
        showHome?: boolean;
        className?: string;
        size?: "sm" | "md" | "lg" | "xl";
        icon?: React.ReactNode;
        status?: 'idle' | 'pending' | 'success' | 'failed';
        retryCount?: number;
        lastRetryAt?: Date;
        maxRetries?: number;
        retryCooldownMs?: number;
        circuitBreakerState?: 'closed' | 'open' | 'half-open';
        consecutiveFailures?: number;
        lastFailureAt?: Date;
        backoffMultiplier?: number;
        nextRetryAt?: Date;
    }>) => void;
    retryError: (id: string) => void;
    hasErrors: boolean;
    errorCount: number;
} => {
    const context = useContext(ErrorContext);
    if (!context) {
        throw new Error('useErrorContext must be used within an ErrorProvider');
    }
    return context;
};

/**
 * Helper hook for component-level error handling
 * Provides convenient methods for common error types
 */
export const useErrorHandler = () => {
    const { addError, removeError } = useErrorContext();

    const handleError = useCallback((
        type: ErrorType,
        title?: string,
        message?: string,
        actions?: ErrorAction[]
    ) => {
        return addError({ type, title, message, actions });
    }, [addError]);

    const handleNetworkError = useCallback((message?: string) => {
        return handleError('network', undefined, message);
    }, [handleError]);

    const handleAuthError = useCallback((message?: string) => {
        return handleError('auth', undefined, message);
    }, [handleError]);

    const handleValidationError = useCallback((message?: string) => {
        return handleError('validation', undefined, message);
    }, [handleError]);

    const handleServerError = useCallback((message?: string) => {
        return handleError('server', undefined, message);
    }, [handleError]);

    const handleTimeoutError = useCallback((message?: string) => {
        return handleError('timeout', undefined, message);
    }, [handleError]);

    const handlePermissionError = useCallback((message?: string) => {
        return handleError('permission', undefined, message);
    }, [handleError]);

    return {
        handleError,
        handleNetworkError,
        handleAuthError,
        handleValidationError,
        handleServerError,
        handleTimeoutError,
        handlePermissionError,
        removeError,
    };
};