/** @format */

import { createContext } from "react";
import type { ErrorType, ErrorAction } from "../shared/components/ui/error-types";

export interface ErrorState {
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
    // Recovery UI state
    status?: 'idle' | 'pending' | 'success' | 'failed';
    retryCount?: number;
    lastRetryAt?: Date;
    maxRetries?: number;
    retryCooldownMs?: number;
    // Advanced recovery features
    circuitBreakerState?: 'closed' | 'open' | 'half-open';
    consecutiveFailures?: number;
    lastFailureAt?: Date;
    backoffMultiplier?: number;
    nextRetryAt?: Date;
}

interface ErrorContextValue {
    errors: ErrorState[];
    addError: (error: Omit<ErrorState, 'id' | 'timestamp'>) => string;
    removeError: (id: string) => void;
    clearErrors: () => void;
    updateError: (id: string, updates: Partial<ErrorState>) => void;
    retryError: (id: string) => void;
    hasErrors: boolean;
    errorCount: number;
}

export const ErrorContext = createContext<ErrorContextValue | undefined>(undefined);