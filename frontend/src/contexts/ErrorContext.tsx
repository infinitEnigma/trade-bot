/** @format */

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ErrorType, ErrorAction } from "../shared/components/ui/ErrorState";

interface ErrorState {
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

const ErrorContext = createContext<ErrorContextValue | undefined>(undefined);

interface ErrorProviderProps {
  children: React.ReactNode;
  maxErrors?: number; // Maximum number of errors to keep in memory
  autoDismissTimeout?: number; // Auto dismiss timeout in ms
}

export const ErrorProvider: React.FC<ErrorProviderProps> = ({
  children,
  maxErrors = 10,
  autoDismissTimeout = 10000, // 10 seconds
}) => {
  const [errors, setErrors] = useState<ErrorState[]>([]);

  // Generate unique ID for errors
  const generateId = useCallback(() => {
    return `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Add new error
  const addError = useCallback((errorData: Omit<ErrorState, 'id' | 'timestamp'>): string => {
    const id = generateId();
    const newError: ErrorState = {
      ...errorData,
      id,
      timestamp: new Date(),
    };

    setErrors(prev => {
      const updated = [newError, ...prev];
      // Keep only the most recent maxErrors
      return updated.slice(0, maxErrors);
    });

    return id;
  }, [generateId, maxErrors]);

  // Remove error by ID
  const removeError = useCallback((id: string) => {
    setErrors(prev => prev.filter(error => error.id !== id));
  }, []);

  // Clear all errors
  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  // Update error by ID
  const updateError = useCallback((id: string, updates: Partial<ErrorState>) => {
    setErrors(prev => prev.map(error =>
      error.id === id ? { ...error, ...updates } : error
    ));
  }, []);

  // Calculate exponential backoff delay
  const calculateBackoffDelay = useCallback((retryCount: number, baseDelay: number = 1000): number => {
    const multiplier = Math.pow(2, retryCount); // Exponential backoff
    const jitter = Math.random() * 0.1 * baseDelay; // Add 10% jitter
    return Math.min(baseDelay * multiplier + jitter, 30000); // Cap at 30 seconds
  }, []);

  // Check circuit breaker state
  const getCircuitBreakerState = useCallback((error: ErrorState): 'closed' | 'open' | 'half-open' => {
    const now = Date.now();
    const consecutiveFailures = error.consecutiveFailures || 0;
    const lastFailure = error.lastFailureAt?.getTime() || 0;

    // Circuit breaker thresholds
    const failureThreshold = 5; // Open after 5 consecutive failures
    const recoveryTimeout = 60000; // Try half-open after 60 seconds

    if (consecutiveFailures >= failureThreshold) {
      if (now - lastFailure > recoveryTimeout) {
        return 'half-open'; // Time to try again
      }
      return 'open'; // Still in failure state
    }

    return 'closed'; // Normal operation
  }, []);

  // Retry error with advanced patterns (calls retry function if available)
  const retryError = useCallback(async (id: string) => {
    const error = errors.find(e => e.id === id);
    if (!error?.actions) return;

    const now = Date.now();
    const currentRetries = error.retryCount || 0;
    const maxRetries = error.maxRetries || 3;
    const consecutiveFailures = error.consecutiveFailures || 0;

    // Check circuit breaker state
    const circuitState = getCircuitBreakerState(error);
    if (circuitState === 'open') {
      console.warn(`Circuit breaker open for error ${id}, skipping retry`);
      updateError(id, {
        message: `${error.message} Circuit breaker open`,
        circuitBreakerState: 'open'
      });
      return;
    }

    // Check if we're within retry limits
    if (currentRetries >= maxRetries && circuitState !== 'half-open') {
      console.warn(`Max retries exceeded for error ${id}`);
      updateError(id, {
        status: 'failed',
        message: `${error.message}  Max retries: ${maxRetries}`,
        circuitBreakerState: 'open'
      });
      return;
    }

    // Check next retry timing
    const nextRetryAt = error.nextRetryAt?.getTime() || 0;
    if (now < nextRetryAt) {
      const remainingMs = nextRetryAt - now;
      console.warn(`Next retry not ready for error ${id}, ${remainingMs}ms remaining`);
      return;
    }

    const retryAction = error.actions.find(action =>
      action.label.toLowerCase().includes('try again') ||
      action.label.toLowerCase().includes('retry')
    );

    if (retryAction) {
      try {
        // Calculate backoff delay for next retry
        const backoffMultiplier = error.backoffMultiplier || 1;
        const baseDelay = error.retryCooldownMs || 1000;
        const backoffDelay = calculateBackoffDelay(currentRetries, baseDelay * backoffMultiplier);

        // Update error status to pending with circuit breaker state
        updateError(id, {
          status: 'pending',
          retryCount: currentRetries + 1,
          lastRetryAt: new Date(),
          nextRetryAt: new Date(now + backoffDelay),
          message: `${error.message} Retrying...`,
          circuitBreakerState: circuitState === 'half-open' ? 'half-open' : 'closed',
          backoffMultiplier
        });

        // Execute retry action
        await retryAction.onClick();

        // On success, reset circuit breaker and update status
        updateError(id, {
          status: 'success',
          consecutiveFailures: 0,
          circuitBreakerState: 'closed',
          message: error.message?.replace(' (Retrying...)', ' (Success!)'),
          nextRetryAt: undefined // Clear next retry time
        });

        // Auto-remove successful retries after 2 seconds
        setTimeout(() => {
          removeError(id);
        }, 2000);

      } catch {
        // On failure, update circuit breaker state
        const newConsecutiveFailures = consecutiveFailures + 1;
        const newCircuitState = getCircuitBreakerState({
          ...error,
          consecutiveFailures: newConsecutiveFailures,
          lastFailureAt: new Date()
        });

        updateError(id, {
          status: 'failed',
          consecutiveFailures: newConsecutiveFailures,
          lastFailureAt: new Date(),
          circuitBreakerState: newCircuitState,
          message: error.message?.replace(' (Retrying...)', ` (Retry failed - ${newConsecutiveFailures} failures)`)
        });
      }
    }
  }, [errors, removeError, updateError, calculateBackoffDelay, getCircuitBreakerState]);

  // Auto-dismiss errors after timeout
  useEffect(() => {
    if (autoDismissTimeout <= 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setErrors(prev => prev.filter(error => {
        const errorTime = error.timestamp.getTime();
        return (now - errorTime) < autoDismissTimeout;
      }));
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [autoDismissTimeout]);

  // Keyboard shortcut to clear errors (Escape key)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && errors.length > 0) {
        clearErrors();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [errors.length, clearErrors]);

  const value: ErrorContextValue = {
    errors,
    addError,
    removeError,
    clearErrors,
    updateError,
    retryError,
    hasErrors: errors.length > 0,
    errorCount: errors.length,
  };

  return (
    <ErrorContext.Provider value={value}>
      {children}
    </ErrorContext.Provider>
  );
};

// Hook to use error context
export const useErrorContext = (): ErrorContextValue => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useErrorContext must be used within an ErrorProvider');
  }
  return context;
};

// Helper hook for component-level error handling
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

// Error notification component
interface ErrorNotificationsProps {
  className?: string;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center';
}

export const ErrorNotifications: React.FC<ErrorNotificationsProps> = ({
  className = "",
  position = 'top-right'
}) => {
  const { errors, removeError } = useErrorContext();

  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-center': 'top-4 left-1/2 transform -translate-x-1/2',
  };

  if (errors.length === 0) return null;

  return (
    <div className={`fixed z-50 ${positionClasses[position]} ${className}`}>
      <div className="space-y-2 max-w-sm">
        {errors.map((error) => (
          <div
            key={error.id}
            className="bg-surface border border-white/10 rounded-lg p-4 shadow-lg backdrop-blur-sm animate-in slide-in-from-right-2 duration-300"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                {error.status === 'pending' ? (
                  <div className="w-5 h-5 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : error.status === 'success' ? (
                  <div className="w-5 h-5 bg-green-500/20 rounded-full flex items-center justify-center">
                    <span className="text-green-400 text-xs">✓</span>
                  </div>
                ) : error.icon || (
                  <div className="w-5 h-5 bg-red-500/20 rounded-full flex items-center justify-center">
                    <span className="text-red-400 text-xs">!</span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-text">
                  {error.title}
                </h4>
                {error.message && (
                  <p className="text-sm text-textMuted mt-1">
                    {error.message}
                  </p>
                )}
              </div>

              <button
                onClick={() => removeError(error.id)}
                className="shrink-0 text-textMuted hover:text-text transition-colors"
                aria-label="Dismiss error"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error.actions && error.actions.length > 0 && (
              <div className="flex gap-2 mt-3">
                {error.actions.map((action, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      action.onClick();
                      if (!action.disabled) {
                        removeError(error.id);
                      }
                    }}
                    disabled={action.disabled}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      action.variant === 'primary'
                        ? 'bg-primary hover:bg-primary/80 text-white'
                        : action.variant === 'secondary'
                        ? 'bg-surface hover:bg-surface/80 text-text'
                        : 'text-primary hover:text-primary/80 underline'
                    }`}
                  >
                    {action.icon && <span className="mr-1">{action.icon}</span>}
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ErrorContext;
