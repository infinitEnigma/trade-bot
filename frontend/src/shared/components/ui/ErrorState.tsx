/** @format */

import React from "react";
import {
  AlertTriangle,
  Wifi,
  Shield,
  AlertCircle,
  RefreshCw,
  Home,
  Clock,
  XCircle,
  Server,
  Lock,
} from "lucide-react";
import { Card } from "./Card";
import EmptyState from "../dashboard/EmptyState";

export type ErrorType =
  | "network"
  | "auth"
  | "permission"
  | "validation"
  | "server"
  | "timeout"
  | "not-found"
  | "maintenance"
  | "rate-limit"
  | "unknown";

export interface ErrorAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
}

export interface ErrorStateProps {
  type?: ErrorType;
  title?: string;
  message?: string;
  description?: string;
  actions?: ErrorAction[];
  showReport?: boolean;
  showHome?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

// Error type configurations
const errorConfigs = {
  network: {
    icon: <Wifi className="w-8 h-8" />,
    title: "Connection Lost",
    message: "Unable to connect to our servers",
    description: "Please check your internet connection and try again.",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  auth: {
    icon: <Lock className="w-8 h-8" />,
    title: "Authentication Required",
    message: "You need to sign in to continue",
    description: "Please log in to access this feature.",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/20",
  },
  permission: {
    icon: <Shield className="w-8 h-8" />,
    title: "Access Denied",
    message: "You don't have permission to view this",
    description: "Contact your administrator if you believe this is an error.",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
  },
  validation: {
    icon: <AlertCircle className="w-8 h-8" />,
    title: "Invalid Input",
    message: "Please check your information",
    description: "Some fields contain errors. Please review and try again.",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
  },
  server: {
    icon: <Server className="w-8 h-8" />,
    title: "Server Error",
    message: "Something went wrong on our end",
    description: "We're working to fix this issue. Please try again later.",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
  },
  timeout: {
    icon: <Clock className="w-8 h-8" />,
    title: "Request Timeout",
    message: "The request took too long to complete",
    description: "Please check your connection and try again.",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
  },
  "not-found": {
    icon: <XCircle className="w-8 h-8" />,
    title: "Not Found",
    message: "The page you're looking for doesn't exist",
    description: "The content may have been moved or deleted.",
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/20",
  },
  maintenance: {
    icon: <AlertTriangle className="w-8 h-8" />,
    title: "Under Maintenance",
    message: "We're currently updating our systems",
    description: "We'll be back online shortly. Thank you for your patience.",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  "rate-limit": {
    icon: <Clock className="w-8 h-8" />,
    title: "Too Many Requests",
    message: "You've made too many requests",
    description: "Please wait a moment before trying again.",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/20",
  },
  unknown: {
    icon: <AlertTriangle className="w-8 h-8" />,
    title: "Something Went Wrong",
    message: "An unexpected error occurred",
    description: "Please try again or contact support if the issue persists.",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
  },
};

export const ErrorState: React.FC<ErrorStateProps> = ({
  type = "unknown",
  title,
  message,
  description,
  actions,
  showReport = false,
  showHome = false,
  className = "",
  size = "md",
}) => {
  const config = errorConfigs[type];

  // Override config with custom props if provided
  const finalConfig = {
    ...config,
    title: title || config.title,
    message: message || config.message,
    description: description || config.description,
  };

  // Default actions based on error type
  const getDefaultActions = (): ErrorAction[] => {
    const defaultActions: ErrorAction[] = [];

    // Always add retry for most errors
    if (type !== "auth" && type !== "permission" && type !== "not-found") {
      defaultActions.push({
        label: "Try Again",
        onClick: () => window.location.reload(),
        icon: <RefreshCw className="w-4 h-4" />,
        variant: "primary",
      });
    }

    // Add home button for navigation errors
    if (showHome || type === "not-found") {
      defaultActions.push({
        label: "Go Home",
        onClick: () => window.location.href = "/",
        icon: <Home className="w-4 h-4" />,
        variant: "secondary",
      });
    }

    return defaultActions;
  };

  const finalActions = actions || getDefaultActions();

  return (
    <div className={`max-w-2xl mx-auto ${className}`}>
      <EmptyState
        size={size}
        variant={type === "network" || type === "maintenance" ? "info" :
                type === "auth" || type === "permission" || type === "rate-limit" ? "warning" :
                type === "server" || type === "timeout" || type === "validation" || type === "unknown" ? "error" : "neutral"}
        layout="card"
        icon={config.icon}
        title={finalConfig.title}
        subtitle={finalConfig.message}
        description={finalConfig.description}
        actions={finalActions}
        className={`${config.bgColor} ${config.borderColor} border-2`}
      />

      {/* Additional error reporting section */}
      {showReport && (
        <Card className="mt-6 p-6 bg-surface/50 border border-white/5">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-5 h-5 text-text-tertiary mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-medium text-text-primary mb-2">
                Help us improve
              </h4>
              <p className="text-xs text-text-tertiary mb-4">
                If this problem persists, please report it to our support team.
              </p>
              <button
                onClick={() => {
                  // In a real app, this would open a support ticket or feedback form
                  console.log("Error reported:", { type, title, message, description });
                }}
                className="text-xs text-primary hover:text-primary/80 underline"
              >
                Report this issue
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

// Page-level error component
export const PageError: React.FC<ErrorStateProps & { fullHeight?: boolean }> = ({
  fullHeight = true,
  ...props
}) => {
  return (
    <div className={`${fullHeight ? "min-h-screen flex items-center justify-center" : ""} px-4`}>
      <ErrorState {...props} size="lg" />
    </div>
  );
};

// Inline error component for smaller spaces
export const InlineError: React.FC<{
  message: string;
  type?: ErrorType;
  className?: string;
}> = ({ message, type = "unknown", className = "" }) => {
  const config = errorConfigs[type];

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${config.bgColor} border ${config.borderColor} ${className}`}>
      <div className={`shrink-0 ${config.color}`}>
        <div className="w-4 h-4 flex items-center justify-center">
          <AlertCircle className="w-4 h-4" />
        </div>
      </div>
      <p className="text-sm text-text-primary">{message}</p>
    </div>
  );
};

// Error boundary component
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

export class ErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  },
  ErrorBoundaryState
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
    this.props.onError?.(error, errorInfo);

    // In production, you might want to send this to an error reporting service
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error} resetError={this.resetError} />;
      }

      return (
        <PageError
          type="unknown"
          title="Something went wrong"
          message="An unexpected error occurred"
          description="We've been notified and are working to fix this issue."
          actions={[
            {
              label: "Try Again",
              onClick: this.resetError,
              icon: <RefreshCw className="w-4 h-4" />,
              variant: "primary",
            },
            {
              label: "Go Home",
              onClick: () => window.location.href = "/",
              icon: <Home className="w-4 h-4" />,
              variant: "secondary",
            },
          ]}
          showReport={true}
        />
      );
    }

    return this.props.children;
  }
}

// Hook for component-level error handling
export const useErrorHandler = () => {
  const [error, setError] = React.useState<ErrorStateProps | null>(null);

  const handleError = React.useCallback((errorProps: ErrorStateProps) => {
    setError(errorProps);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  const retry = React.useCallback(() => {
    clearError();
    // Additional retry logic can be added here
  }, [clearError]);

  return {
    error,
    handleError,
    clearError,
    retry,
    hasError: !!error,
  };
};

export default ErrorState;
