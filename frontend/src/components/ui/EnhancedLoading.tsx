/** @format */

import React from "react";
import { Loader2, CheckCircle, Circle, AlertTriangle } from "lucide-react";
import { Card } from "./Card";

// Enhanced Loading Spinner with Context
interface ContextualSpinnerProps {
  size?: "sm" | "md" | "lg";
  message?: string;
  showProgress?: boolean;
  progress?: number;
  className?: string;
}

export const ContextualSpinner: React.FC<ContextualSpinnerProps> = ({
  size = "md",
  message,
  showProgress = false,
  progress,
  className = ""
}) => {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className={`relative ${sizeClasses[size]}`}>
        <Loader2 className="animate-spin text-primary" />
        {showProgress && progress !== undefined && (
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
            <path
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={`${progress}, 100`}
              className="text-primary/20"
            />
            <path
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={`${progress}, 100`}
              className="text-primary animate-pulse"
            />
          </svg>
        )}
      </div>
      {message && (
        <p className="text-sm text-textMuted animate-pulse text-center max-w-xs">
          {message}
        </p>
      )}
    </div>
  );
};

// Operation Status Tracker
interface OperationTrackerProps {
  operation: string;
  status: "idle" | "loading" | "success" | "error";
  progress?: number;
  message?: string;
  className?: string;
}

export const OperationTracker: React.FC<OperationTrackerProps> = ({
  operation,
  status,
  progress,
  message,
  className = ""
}) => {
  const statusConfig = {
    idle: {
      icon: Circle,
      color: "text-textMuted",
      bg: "bg-surface/50"
    },
    loading: {
      icon: Loader2,
      color: "text-primary",
      bg: "bg-primary/10"
    },
    success: {
      icon: CheckCircle,
      color: "text-green-400",
      bg: "bg-green-500/10"
    },
    error: {
      icon: AlertTriangle,
      color: "text-red-400",
      bg: "bg-red-500/10"
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${config.bg} ${className}`}>
      <Icon
        className={`w-5 h-5 ${status === "loading" ? "animate-spin" : ""} ${config.color}`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">{operation}</p>
        {message && (
          <p className="text-xs text-textMuted truncate">{message}</p>
        )}
        {progress !== undefined && status === "loading" && (
          <div className="w-full bg-surface/50 rounded-full h-1 mt-2">
            <div
              className="bg-primary h-1 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// Page-Level Loader with Steps
interface PageLoaderProps {
  title: string;
  subtitle?: string;
  steps?: string[];
  currentStep?: number;
  className?: string;
}

export const PageLoader: React.FC<PageLoaderProps> = ({
  title,
  subtitle,
  steps,
  currentStep,
  className = ""
}) => (
  <div className={`min-h-screen flex items-center justify-center bg-background px-4 ${className}`}>
    <Card className="p-8 text-center max-w-md w-full">
      <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>

      <h2 className="text-xl font-semibold text-text mb-2">{title}</h2>
      {subtitle && <p className="text-textMuted mb-6">{subtitle}</p>}

      {steps && steps.length > 0 && (
        <div className="space-y-3 text-left">
          {steps.map((step, index) => (
            <div key={step} className="flex items-center gap-3">
              {currentStep !== undefined && index < currentStep ? (
                <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
              ) : currentStep !== undefined && index === currentStep ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-textMuted shrink-0" />
              )}
              <span
                className={`text-sm ${
                  currentStep !== undefined && index <= currentStep
                    ? "text-text"
                    : "text-textMuted"
                }`}
              >
                {step}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  </div>
);

// Realistic Skeleton Screens

// Enhanced skeleton base styles
const skeletonVariants = {
  pulse: "animate-pulse",
  wave: "animate-pulse", // For now, using pulse; can be enhanced with CSS animations
  shimmer: "relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent before:animate-[shimmer_1.5s_ease-in-out_infinite]",
};

const skeletonSpeeds = {
  slow: "animate-pulse",
  normal: "animate-pulse",
  fast: "animate-pulse",
};

// Dashboard Card Skeleton
export const DashboardCardSkeleton: React.FC<{
  className?: string;
  variant?: "pulse" | "wave" | "shimmer";
  speed?: "slow" | "normal" | "fast";
}> = ({
  className = "",
  variant = "pulse",
  speed = "normal"
}) => (
  <Card className={`${skeletonVariants[variant]} ${skeletonSpeeds[speed]} ${className}`}>
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-surface rounded-lg"></div>
          <div className="space-y-2">
            <div className="w-24 h-4 bg-surface rounded"></div>
            <div className="w-16 h-3 bg-surface rounded"></div>
          </div>
        </div>
        <div className="w-16 h-6 bg-surface rounded-full"></div>
      </div>

      <div className="space-y-3">
        <div className="w-20 h-8 bg-surface rounded"></div>
        <div className="w-14 h-4 bg-surface rounded"></div>
      </div>
    </div>
  </Card>
);

// Strategy Card Skeleton
export const StrategyCardSkeleton: React.FC<{ className?: string }> = ({ className = "" }) => (
  <Card className={`animate-pulse ${className}`}>
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-surface rounded-lg"></div>
          <div className="space-y-2">
            <div className="w-32 h-5 bg-surface rounded"></div>
            <div className="w-20 h-4 bg-surface rounded"></div>
          </div>
        </div>
        <div className="w-16 h-6 bg-surface rounded-full"></div>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between">
          <div className="w-16 h-4 bg-surface rounded"></div>
          <div className="w-12 h-4 bg-surface rounded"></div>
        </div>
        <div className="flex justify-between">
          <div className="w-20 h-4 bg-surface rounded"></div>
          <div className="w-10 h-4 bg-surface rounded"></div>
        </div>
        <div className="flex justify-between">
          <div className="w-14 h-4 bg-surface rounded"></div>
          <div className="w-8 h-4 bg-surface rounded"></div>
        </div>
      </div>

      <div className="bg-surface rounded p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="w-20 h-4 bg-surface/50 rounded"></div>
          <div className="w-12 h-5 bg-surface/50 rounded"></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex justify-between">
            <div className="w-10 h-3 bg-surface/50 rounded"></div>
            <div className="w-8 h-3 bg-surface/50 rounded"></div>
          </div>
          <div className="flex justify-between">
            <div className="w-8 h-3 bg-surface/50 rounded"></div>
            <div className="w-12 h-3 bg-surface/50 rounded"></div>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="w-24 h-8 bg-surface rounded-lg"></div>
        <div className="w-8 h-8 bg-surface rounded"></div>
        <div className="w-8 h-8 bg-surface rounded"></div>
      </div>
    </div>
  </Card>
);

// User Progress Card Skeleton
export const UserProgressCardSkeleton: React.FC<{ className?: string }> = ({ className = "" }) => (
  <Card className={`animate-pulse ${className}`}>
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="w-32 h-5 bg-surface rounded mb-2"></div>
          <div className="w-24 h-3 bg-surface rounded"></div>
        </div>
        <div className="text-right">
          <div className="w-12 h-6 bg-surface rounded mb-1"></div>
          <div className="w-16 h-3 bg-surface rounded"></div>
        </div>
      </div>

      <div className="mb-6">
        <div className="w-full bg-surface rounded-full h-2"></div>
        <div className="flex justify-between mt-2">
          <div className="w-12 h-3 bg-surface rounded"></div>
          <div className="w-16 h-3 bg-surface rounded"></div>
        </div>
      </div>

      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-4">
            <div className="w-8 h-8 bg-surface rounded-full shrink-0"></div>
            <div className="flex-1 space-y-2">
              <div className="w-24 h-4 bg-surface rounded"></div>
              <div className="w-48 h-3 bg-surface rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </Card>
);

// Table Row Skeleton
export const TableRowSkeleton: React.FC<{ columns?: number; className?: string }> = ({
  columns = 5,
  className = ""
}) => (
  <tr className={`animate-pulse ${className}`}>
    {Array.from({ length: columns }, (_, i) => (
      <td key={i} className="py-3 px-4">
        <div className={`bg-surface rounded h-4 ${i === columns - 1 ? 'w-16' : 'w-20'}`}></div>
      </td>
    ))}
  </tr>
);

// Chart Skeleton
export const ChartSkeleton: React.FC<{ height?: number; className?: string }> = ({
  height = 300,
  className = ""
}) => (
  <Card className={`animate-pulse ${className}`}>
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="w-32 h-5 bg-surface rounded"></div>
        <div className="w-20 h-8 bg-surface rounded"></div>
      </div>
      <div className={`bg-surface rounded-lg`} style={{ height: `${height}px` }}></div>
    </div>
  </Card>
);

// Form Skeleton
export const FormSkeleton: React.FC<{ fields?: number; className?: string }> = ({
  fields = 4,
  className = ""
}) => (
  <Card className={`animate-pulse ${className}`}>
    <div className="p-6 space-y-6">
      <div className="w-48 h-6 bg-surface rounded mb-4"></div>

      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-2">
          <div className="w-24 h-4 bg-surface rounded"></div>
          <div className={`bg-surface rounded h-10 ${i % 2 === 0 ? 'w-full' : 'w-1/2'}`}></div>
        </div>
      ))}

      <div className="flex gap-3 pt-4">
        <div className="w-24 h-10 bg-surface rounded-lg"></div>
        <div className="w-20 h-10 bg-surface rounded-lg"></div>
      </div>
    </div>
  </Card>
);

// List Skeleton
export const ListSkeleton: React.FC<{
  items?: number;
  showAvatar?: boolean;
  className?: string;
}> = ({
  items = 5,
  showAvatar = false,
  className = ""
}) => (
  <Card className={`animate-pulse ${className}`}>
    <div className="p-6">
      <div className="w-48 h-6 bg-surface rounded mb-6"></div>

      <div className="space-y-4">
        {Array.from({ length: items }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            {showAvatar && (
              <div className="w-10 h-10 bg-surface rounded-full shrink-0"></div>
            )}
            <div className="flex-1 space-y-2">
              <div className="w-3/4 h-4 bg-surface rounded"></div>
              <div className="w-1/2 h-3 bg-surface rounded"></div>
            </div>
            <div className="w-16 h-6 bg-surface rounded-full"></div>
          </div>
        ))}
      </div>
    </div>
  </Card>
);

// Profile Skeleton
export const ProfileSkeleton: React.FC<{ className?: string }> = ({ className = "" }) => (
  <Card className={`animate-pulse ${className}`}>
    <div className="p-8">
      <div className="flex items-center gap-6 mb-8">
        <div className="w-20 h-20 bg-surface rounded-full"></div>
        <div className="flex-1 space-y-3">
          <div className="w-48 h-6 bg-surface rounded"></div>
          <div className="w-32 h-4 bg-surface rounded"></div>
          <div className="flex gap-4">
            <div className="w-16 h-5 bg-surface rounded"></div>
            <div className="w-20 h-5 bg-surface rounded"></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2">
            <div className="w-24 h-4 bg-surface rounded"></div>
            <div className="w-full h-12 bg-surface rounded"></div>
          </div>
        ))}
      </div>
    </div>
  </Card>
);

// Content Block Skeleton
export const ContentSkeleton: React.FC<{
  lines?: number;
  showImage?: boolean;
  className?: string;
}> = ({
  lines = 4,
  showImage = false,
  className = ""
}) => (
  <Card className={`animate-pulse ${className}`}>
    <div className="p-6">
      {showImage && (
        <div className="w-full h-48 bg-surface rounded-lg mb-4"></div>
      )}

      <div className="w-3/4 h-6 bg-surface rounded mb-4"></div>

      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={`bg-surface rounded h-4 ${
              i === lines - 1 ? 'w-2/3' : 'w-full'
            }`}
          ></div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-6">
        <div className="w-8 h-8 bg-surface rounded-full"></div>
        <div className="flex-1">
          <div className="w-24 h-4 bg-surface rounded"></div>
        </div>
        <div className="w-16 h-6 bg-surface rounded-full"></div>
      </div>
    </div>
  </Card>
);

// Loading States Configuration
export const LoadingStates = {
  creatingStrategy: {
    message: "Creating your trading strategy...",
    steps: ["Validating parameters", "Connecting to exchange", "Deploying strategy"],
  },

  startingBot: {
    message: "Starting trading bot...",
    steps: ["Initializing engine", "Connecting to exchange", "Starting automated trading"],
  },

  stoppingBot: {
    message: "Stopping trading bot...",
    steps: ["Sending stop signal", "Closing positions", "Shutting down engine"],
  },

  checkingQualification: {
    message: "Verifying wallet qualification...",
    steps: ["Connecting to wallet", "Checking NFT ownership", "Validating token balance"],
  },

  loadingPortfolio: {
    message: "Loading portfolio data...",
    subtitle: "Fetching positions, balances, and trading history",
  },

  loadingStrategies: {
    message: "Loading trading strategies...",
    subtitle: "Fetching your automated trading configurations",
  },

  loadingAnalytics: {
    message: "Loading analytics data...",
    subtitle: "Processing performance metrics and trading statistics",
  },

  savingChanges: {
    message: "Saving your changes...",
    subtitle: "Updating profile and preferences",
  },
};
