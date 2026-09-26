/**
 * BotControls Component
 *
 * Uses the `useBotLifecycle` hook to get authoritative server state.
 * The frontend NEVER assumes immediate state transitions.
 *
 * UI States:
 * - Stopped: Bot is stopped and ready to start
 * - Starting...: Bot is in the process of starting (loading)
 * - Running: Bot is actively trading
 * - Stopping...: Bot is in the process of stopping (loading)
 * - Connection lost: WebSocket connection lost
 * - Error: Bot encountered an error
 *
 * @format
 */

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRole } from "../../../../shared/types";
import {
  Play,
  Square,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Wallet,
  Shield,
  Zap,
  WifiOff,
} from "lucide-react";

import { tradingApi, authApi } from "../../../../infrastructure/api";
import {
  accountsApi,
  ExchangeAccountDto,
} from "../../../../infrastructure/api/accounts";
import { useAuth } from "../../../auth";
import { OperationToasts } from "../../../../shared/utils/toast";
import {
  useBotState,
  BOT_INSTANCES_QUERY_KEY,
} from "../../../bots/hooks/useBotLifecycle";
import { BotInstance } from "../../../strategies/types/strategies.types";

interface BotControlsProps {
  strategyId: string;
  bot?: BotInstance;
  onStatusChange: () => void;
}

/**
 * Enhanced Action Button Component
 */
const ActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  variant: "success" | "danger" | "warning" | "info";
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  fullWidth?: boolean;
}> = ({
  icon,
  label,
  variant,
  loading,
  disabled,
  onClick,
  fullWidth = false,
}) => {
  const variantStyles = {
    success:
      "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30",
    danger: "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30",
    warning:
      "bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30",
    info: "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium
        border transition-all duration-200 hover-lift
        ${variantStyles[variant]}
        ${fullWidth ? "w-full" : ""}
        ${disabled || loading ? "opacity-50 cursor-not-allowed" : "hover:shadow-lg"}
      `}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      <span className="text-sm">{loading ? "Processing..." : label}</span>
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
      if (response.success && response.data?.qualified) {
        OperationToasts.qualificationSuccess();
        window.location.reload(); // Refresh to update UI
      } else {
        OperationToasts.qualificationFailed(
          response.data?.reasons?.[0] || "Qualification check failed"
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "response" in error
            ? (error as { response: { data: { error: string } } }).response.data
                .error
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

/** Mirrors the backend's position-validator floor ($10 minimum notional). */
const MIN_NOTIONAL_AMOUNT = 10;
/** Pre-filled size; the operator can change it before every start. */
const DEFAULT_NOTIONAL_AMOUNT = 1000;

/**
 * AccountSizePicker (C3a)
 *
 * The venue account a bot trades on plus the notional size. Both are required
 * by `POST /api/bot/management/start`: with many accounts per user the backend refuses to
 * guess which one the engine should trade.
 */
const AccountSizePicker: React.FC<{
  accounts: ExchangeAccountDto[];
  isLoading: boolean;
  selectedAccountId: string;
  onSelectAccount: (accountId: string) => void;
  notionalAmount: string;
  onNotionalChange: (value: string) => void;
}> = ({
  accounts,
  isLoading,
  selectedAccountId,
  onSelectAccount,
  notionalAmount,
  onNotionalChange,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-textMuted">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading accounts...
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-warning">
          No verified exchange account. Connect and verify one in Settings
          before starting a bot.
        </p>
      </div>
    );
  }

  const amount = Number(notionalAmount);
  const amountValid = Number.isFinite(amount) && amount >= MIN_NOTIONAL_AMOUNT;

  return (
    <div className="space-y-2">
      <label className="block text-xs text-textMuted">
        Trading account
        <select
          value={selectedAccountId}
          onChange={event => onSelectAccount(event.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-surface border border-white/10 text-sm text-text focus:border-primary/50 focus:outline-none"
        >
          <option value="">Select an account...</option>
          {accounts.map(account => (
            <option key={account.id} value={account.id}>
              {account.exchange} · {account.environment} · {account.accountRef}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-textMuted">
        Notional size (USDC)
        <input
          type="number"
          min={MIN_NOTIONAL_AMOUNT}
          step="any"
          value={notionalAmount}
          onChange={event => onNotionalChange(event.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-surface border border-white/10 text-sm text-text focus:border-primary/50 focus:outline-none"
        />
      </label>

      {!amountValid && (
        <p className="text-xs text-danger">
          Enter a size of at least ${MIN_NOTIONAL_AMOUNT}.
        </p>
      )}
    </div>
  );
};

/**
 * BotControls Component
 *
 * Uses the `useBotLifecycle` hook to get authoritative server state.
 * The frontend NEVER assumes immediate state transitions.
 */
export const BotControls: React.FC<BotControlsProps> = ({
  strategyId,
  bot,
  onStatusChange,
}) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const hasQualification = user?.roles?.includes(UserRole.QUALIFIED_ALPHA);

  // Use the bot lifecycle hook for authoritative server state
  const { actualState, isTransitional, isConnectionLost } = useBotState(
    bot?.id ?? strategyId
  );

  // C3a: a bot trades on one explicit venue account — only verified accounts
  // can back it, and the picker never offers anything else.
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [notionalAmount, setNotionalAmount] = useState(
    String(DEFAULT_NOTIONAL_AMOUNT)
  );

  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", user?.id],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const activeAccounts = (accountsQuery.data?.data?.accounts ?? []).filter(
    account => account.status === "ACTIVE"
  );

  // One ACTIVE account leaves no choice, so default to it (derived during
  // render — the operator's explicit pick always wins). With several, the
  // backend refuses to guess, so the picker stays empty until one is chosen.
  const effectiveAccountId =
    selectedAccountId ||
    (activeAccounts.length === 1 ? activeAccounts[0].id : "");

  const parsedAmount = Number(notionalAmount);
  const canStart =
    !!effectiveAccountId &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= MIN_NOTIONAL_AMOUNT;

  // Invalidate query cache when mutations succeed
  const invalidateCache = () => {
    queryClient.invalidateQueries({ queryKey: [BOT_INSTANCES_QUERY_KEY] });
    onStatusChange();
  };

  // Start bot mutation — bound to the picked account and size (C3a)
  const startMutation = useMutation({
    mutationFn: () =>
      tradingApi.startBot(strategyId, effectiveAccountId, parsedAmount),
    onSuccess: () => {
      OperationToasts.botStarted("Strategy");
      invalidateCache();
    },
    onError: (error: unknown) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "response" in error
            ? (error as { response: { data: { error: string } } }).response.data
                .error
            : "Unknown error";
      OperationToasts.botError("start", errorMessage);
    },
  });

  // Stop bot mutation
  const stopMutation = useMutation({
    mutationFn: () => tradingApi.stopBot(bot!.id),
    onSuccess: () => {
      OperationToasts.botStopped("Strategy");
      invalidateCache();
    },
    onError: (error: unknown) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "response" in error
            ? (error as { response: { data: { error: string } } }).response.data
                .error
            : "Unknown error";
      OperationToasts.botError("stop", errorMessage);
    },
  });

  // Emergency stop mutation
  const emergencyStopMutation = useMutation({
    mutationFn: () => tradingApi.emergencyStop(bot!.id),
    onSuccess: () => {
      OperationToasts.botEmergencyStop("Strategy");
      invalidateCache();
    },
    onError: (error: unknown) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "response" in error
            ? (error as { response: { data: { error: string } } }).response.data
                .error
            : "Unknown error";
      OperationToasts.botError("emergency stop", errorMessage);
    },
  });

  // Determine loading state from server state (not local assumptions)
  const isLoading =
    isTransitional || startMutation.isPending || stopMutation.isPending;

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

  // Connection lost state
  if (isConnectionLost && bot) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <ActionButton
            icon={<Square className="w-4 h-4" />}
            label="Stop Trading"
            variant="danger"
            disabled={true}
            onClick={() => stopMutation.mutate()}
          />
          <ActionButton
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Emergency Stop"
            variant="warning"
            disabled={true}
            onClick={() => {}}
          />
        </div>
        <div className="text-xs text-danger text-center flex items-center justify-center gap-1">
          <WifiOff className="w-3 h-3" />
          <span>Connection lost • Reconnecting...</span>
        </div>
      </div>
    );
  }

  if (!bot) {
    // No bot exists - show start button
    return (
      <div className="flex flex-col gap-3">
        <AccountSizePicker
          accounts={activeAccounts}
          isLoading={accountsQuery.isLoading}
          selectedAccountId={effectiveAccountId}
          onSelectAccount={setSelectedAccountId}
          notionalAmount={notionalAmount}
          onNotionalChange={setNotionalAmount}
        />
        <ActionButton
          icon={<Play className="w-4 h-4" />}
          label="Start Trading Bot"
          variant="success"
          loading={isLoading}
          disabled={!canStart}
          onClick={() => startMutation.mutate()}
        />
        <div className="text-xs text-textMuted text-center">
          <Zap className="w-3 h-3 inline mr-1" />
          {canStart
            ? `Trades ${parsedAmount} USDC on the selected account`
            : "Select an account and size to begin"}
        </div>
      </div>
    );
  }

  // Bot exists - show appropriate controls based on actual server state
  // Use actualState from the hook if available, otherwise fall back to bot.status
  const currentState = actualState ?? bot.status;

  // RUNNING state
  if (currentState === "RUNNING") {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <ActionButton
            icon={<Square className="w-4 h-4" />}
            label="Stop Trading"
            variant="danger"
            loading={isLoading}
            onClick={() => stopMutation.mutate()}
          />
          <ActionButton
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Emergency Stop"
            variant="warning"
            loading={emergencyStopMutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "🚨 EMERGENCY STOP\n\nThis will immediately cancel ALL open orders and stop trading.\n\nAre you sure?"
                )
              ) {
                emergencyStopMutation.mutate();
              }
            }}
          />
        </div>
        <div className="text-xs text-textMuted text-center flex items-center justify-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>
            Trading Active • {bot.total_trades} trades • $
            {(bot.total_pnl || 0).toFixed(2)} P&L
          </span>
        </div>
      </div>
    );
  }

  // STARTING state (transitional)
  if (currentState === "STARTING") {
    return (
      <div className="space-y-3">
        <ActionButton
          icon={<Loader2 className="w-4 h-4 animate-spin" />}
          label="Starting Bot..."
          variant="info"
          loading={true}
          disabled={true}
          onClick={() => {}}
        />
        <div className="text-xs text-warning text-center flex items-center justify-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Initializing trading engine...</span>
        </div>
      </div>
    );
  }

  // STOPPING state (transitional)
  if (currentState === "STOPPING") {
    return (
      <div className="space-y-3">
        <ActionButton
          icon={<Loader2 className="w-4 h-4 animate-spin" />}
          label="Stopping Bot..."
          variant="info"
          loading={true}
          disabled={true}
          onClick={() => {}}
        />
        <div className="text-xs text-warning text-center flex items-center justify-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Safely stopping trading engine...</span>
        </div>
      </div>
    );
  }

  // STOPPED state
  if (currentState === "STOPPED") {
    return (
      <div className="flex flex-col gap-3">
        {/* Restarting creates a fresh bound bot, so the account is picked here. */}
        <AccountSizePicker
          accounts={activeAccounts}
          isLoading={accountsQuery.isLoading}
          selectedAccountId={effectiveAccountId}
          onSelectAccount={setSelectedAccountId}
          notionalAmount={notionalAmount}
          onNotionalChange={setNotionalAmount}
        />
        <ActionButton
          icon={<Play className="w-4 h-4" />}
          label="Resume Trading"
          variant="success"
          loading={isLoading}
          disabled={!canStart}
          onClick={() => startMutation.mutate()}
        />
        <div className="text-xs text-textMuted text-center">
          <CheckCircle className="w-3 h-3 inline mr-1" />
          Bot ready to trade • Last session: {bot.total_trades} trades
        </div>
      </div>
    );
  }

  // ERROR or UNKNOWN state
  return (
    <div className="space-y-3">
      <AccountSizePicker
        accounts={activeAccounts}
        isLoading={accountsQuery.isLoading}
        selectedAccountId={effectiveAccountId}
        onSelectAccount={setSelectedAccountId}
        notionalAmount={notionalAmount}
        onNotionalChange={setNotionalAmount}
      />
      <div className="flex gap-2">
        <ActionButton
          icon={<Square className="w-4 h-4" />}
          label="Stop Bot"
          variant="danger"
          loading={isLoading}
          onClick={() => stopMutation.mutate()}
        />
        <ActionButton
          icon={<Play className="w-4 h-4" />}
          label="Restart Bot"
          variant="success"
          loading={isLoading}
          disabled={!canStart}
          onClick={() => startMutation.mutate()}
        />
      </div>
      <div className="text-xs text-amber-400 text-center flex items-center justify-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        <span>
          {currentState === "UNKNOWN"
            ? "Connection lost • Bot state unknown"
            : "Bot in error state • Check logs for details"}
        </span>
      </div>
    </div>
  );
};
