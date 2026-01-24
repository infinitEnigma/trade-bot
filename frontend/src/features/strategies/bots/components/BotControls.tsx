/** @format */

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { UserRole } from "@trade-bot/shared";
import {
  Play,
  Square,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Wallet,
  Shield,
  Zap
} from "lucide-react";

// Import from infrastructure
import { tradingApi, authApi } from "../../../../infrastructure/api";

// Import from features
import { useAuth } from "../../../auth";

// Import utilities
import { OperationToasts } from "../../../../shared/utils/toast";

interface BotControlsProps {
  strategyId: string;
  bot?: {
    id: string;
    status: "RUNNING" | "STOPPED" | "ERROR";
    total_trades: number;
    total_pnl: number;
  };
  onStatusChange: () => void;
}

/**
 * Enhanced Action Button Component
 */
const ActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  variant: 'success' | 'danger' | 'warning' | 'info';
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  fullWidth?: boolean;
}> = ({ icon, label, variant, loading, disabled, onClick, fullWidth = false }) => {
  const variantStyles = {
    success: "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30",
    danger: "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30",
    warning: "bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30",
    info: "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30"
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium
        border transition-all duration-200 hover-lift
        ${variantStyles[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${(disabled || loading) ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-lg'}
      `}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        icon
      )}
      <span className="text-sm">{loading ? 'Processing...' : label}</span>
    </button>
  );
};

/**
 * Qualification Gate Component
 */
const QualificationGate: React.FC<{
  title: string;
  description: string;
  action: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="glass-card p-6 text-center border-amber-500/20 bg-amber-500/5">
    <div className="w-12 h-12 mx-auto mb-4 bg-amber-500/20 rounded-full flex items-center justify-center">
      <Shield className="w-6 h-6 text-amber-400" />
    </div>
    <h3 className="text-lg font-semibold text-text mb-2">{title}</h3>
    <p className="text-textMuted mb-4 text-sm">{description}</p>
    {action}
  </div>
);

/**
 * Qualification Check Button
 */
const QualificationCheckButton: React.FC = () => {
  const [isChecking, setIsChecking] = useState(false);

  const handleCheckQualification = async () => {
    setIsChecking(true);
    try {
      const response = await authApi.checkQualification();
      if (response.success && response.qualified) {
        OperationToasts.qualificationSuccess();
        window.location.reload(); // Refresh to update UI
      } else {
        OperationToasts.qualificationFailed(response.reasons?.[0] || "Qualification check failed");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response: { data: { error: string } } }).response.data.error
          : "Failed to check qualification";
      OperationToasts.qualificationFailed(errorMessage);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <ActionButton
      icon={<Wallet className="w-4 h-4" />}
      label="Check Qualification"
      variant="info"
      loading={isChecking}
      onClick={handleCheckQualification}
      fullWidth
    />
  );
};

/**
 * BotControls Component - migrated to trading/bots feature
 */
export const BotControls: React.FC<BotControlsProps> = ({
  strategyId,
  bot,
  onStatusChange,
}) => {
  const { user } = useAuth();
  const hasQualification = user?.roles?.includes(UserRole.QUALIFIED_ALPHA);

  // Start bot mutation
  const startMutation = useMutation({
    mutationFn: () => tradingApi.startBot(strategyId),
    onSuccess: () => {
      OperationToasts.botStarted("Strategy");
      onStatusChange();
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response: { data: { error: string } } }).response.data.error
          : "Unknown error";
      OperationToasts.botError("start", errorMessage);
    },
  });

  // Stop bot mutation
  const stopMutation = useMutation({
    mutationFn: () => tradingApi.stopBot(bot!.id),
    onSuccess: () => {
      OperationToasts.botStopped("Strategy");
      onStatusChange();
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response: { data: { error: string } } }).response.data.error
          : "Unknown error";
      OperationToasts.botError("stop", errorMessage);
    },
  });

  // Emergency stop mutation
  const emergencyStopMutation = useMutation({
    mutationFn: () => tradingApi.emergencyStop(bot!.id),
    onSuccess: () => {
      OperationToasts.botEmergencyStop("Strategy");
      onStatusChange();
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response: { data: { error: string } } }).response.data.error
          : "Unknown error";
      OperationToasts.botError("emergency stop", errorMessage);
    },
  });

  const isStarting = startMutation.isPending;
  const isStopping = stopMutation.isPending;

  // Check if user has alpha qualification
  if (!hasQualification) {
    return (
      <QualificationGate
        title="Alpha Testing Access Required"
        description="Connect your wallet and meet qualification criteria to access advanced trading features."
        action={<QualificationCheckButton />}
      />
    );
  }

  if (!bot) {
    // No bot exists - show start button
    return (
      <div className="flex flex-col gap-3">
        <ActionButton
          icon={<Play className="w-4 h-4" />}
          label="Start Trading Bot"
          variant="success"
          loading={isStarting}
          onClick={() => startMutation.mutate()}
        />
        <div className="text-xs text-textMuted text-center">
          <Zap className="w-3 h-3 inline mr-1" />
          Automated trading will begin immediately
        </div>
      </div>
    );
  }

  // Bot exists - show appropriate controls based on status
  if (bot.status === "RUNNING") {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <ActionButton
            icon={<Square className="w-4 h-4" />}
            label="Stop Trading"
            variant="danger"
            loading={isStopping}
            onClick={() => stopMutation.mutate()}
          />
          <ActionButton
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Emergency Stop"
            variant="warning"
            loading={emergencyStopMutation.isPending}
            onClick={() => {
              if (window.confirm(
                "🚨 EMERGENCY STOP\n\nThis will immediately cancel ALL open orders and stop trading.\n\nAre you sure?"
              )) {
                emergencyStopMutation.mutate();
              }
            }}
          />
        </div>
        <div className="text-xs text-textMuted text-center flex items-center justify-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>Trading Active • {bot.total_trades} trades • ${(bot.total_pnl || 0).toFixed(2)} P&L</span>
        </div>
      </div>
    );
  }

  if (bot.status === "STOPPED") {
    return (
      <div className="flex flex-col gap-3">
        <ActionButton
          icon={<Play className="w-4 h-4" />}
          label="Resume Trading"
          variant="success"
          loading={isStarting}
          onClick={() => startMutation.mutate()}
        />
        <div className="text-xs text-textMuted text-center">
          <CheckCircle className="w-3 h-3 inline mr-1" />
          Bot ready to trade • Last session: {bot.total_trades} trades
        </div>
      </div>
    );
  }

  // Error state or other status
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <ActionButton
          icon={<Square className="w-4 h-4" />}
          label="Stop Bot"
          variant="danger"
          loading={isStopping}
          onClick={() => stopMutation.mutate()}
        />
        <ActionButton
          icon={<Play className="w-4 h-4" />}
          label="Restart Bot"
          variant="success"
          loading={isStarting}
          onClick={() => startMutation.mutate()}
        />
      </div>
      <div className="text-xs text-amber-400 text-center flex items-center justify-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        <span>Bot in error state • Check logs for details</span>
      </div>
    </div>
  );
};
