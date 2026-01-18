/** @format */

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ErrorType, ErrorAction } from "../components/ui/ErrorState";

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

  // Retry error (calls retry function if available)
  const retryError = useCallback((id: string) => {
    const error = errors.find(e => e.id === id);
    if (error?.actions) {
      const retryAction = error.actions.find(action =>
        action.label.toLowerCase().includes('try again') ||
        action.label.toLowerCase().includes('retry')
      );
      if (retryAction) {
        retryAction.onClick();
        // Optionally remove the error after retry
        removeError(id);
      }
    }
  }, [errors, removeError]);

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
                {error.icon || <div className="w-5 h-5 bg-red-500/20 rounded-full flex items-center justify-center">
                  <span className="text-red-400 text-xs">!</span>
                </div>}
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
