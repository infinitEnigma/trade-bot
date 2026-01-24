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
import { errorConfigs } from "./error-utils";
import { ErrorType, ErrorAction, ErrorStateProps } from "./error-types";

// Helper function to get icon component from icon name
const getIconComponent = (iconName: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    Wifi: <Wifi className="w-8 h-8" />,
    Lock: <Lock className="w-8 h-8" />,
    Shield: <Shield className="w-8 h-8" />,
    AlertCircle: <AlertCircle className="w-8 h-8" />,
    Server: <Server className="w-8 h-8" />,
    Clock: <Clock className="w-8 h-8" />,
    XCircle: <XCircle className="w-8 h-8" />,
    AlertTriangle: <AlertTriangle className="w-8 h-8" />,
  };
  return iconMap[iconName] || <AlertTriangle className="w-8 h-8" />;
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

  // Simple inline EmptyState replacement
  const sizeClasses = {
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
    xl: "p-12"
  };

  return (
    <div className={`max-w-2xl mx-auto ${className}`}>
      <Card className={`${config.bgColor} ${config.borderColor} border-2 ${sizeClasses[size]}`}>
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className={`w-16 h-16 rounded-full ${config.bgColor} flex items-center justify-center`}>
              {getIconComponent(config.icon)}
            </div>
          </div>

          <h2 className="text-xl font-semibold text-text mb-2">
            {finalConfig.title}
          </h2>

          <p className="text-textMuted mb-4">
            {finalConfig.message}
          </p>

          {finalConfig.description && (
            <p className="text-sm text-textMuted mb-6">
              {finalConfig.description}
            </p>
          )}

          {finalActions.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {finalActions.map((action, index) => (
                <button
                  key={index}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className={`btn-${action.variant || 'primary'} flex items-center gap-2 ${
                    action.disabled ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

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
  constructor(props: {
    children: React.ReactNode;
    fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  }) {
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

export default ErrorState;
