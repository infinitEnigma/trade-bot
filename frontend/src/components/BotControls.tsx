/** @format */

import React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Play, Square, Loader2 } from "lucide-react";

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

export const BotControls: React.FC<BotControlsProps> = ({
  strategyId,
  bot,
  onStatusChange,
}) => {
  // Start bot mutation
  const startMutation = useMutation({
    mutationFn: () => api.startBot(strategyId),
    onSuccess: () => {
      toast.success("Bot started successfully!");
      onStatusChange();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Failed to start bot");
    },
  });

  // Stop bot mutation
  const stopMutation = useMutation({
    mutationFn: () => api.stopBot(bot!.id),
    onSuccess: () => {
      toast.success("Bot stopped successfully!");
      onStatusChange();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Failed to stop bot");
    },
  });

  const isStarting = startMutation.isPending;
  const isStopping = stopMutation.isPending;

  if (!bot) {
    // No bot exists - show start button
    return (
      <button
        onClick={() => startMutation.mutate()}
        disabled={isStarting}
        className="p-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
        title="Start Bot"
      >
        {isStarting ? (
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        ) : (
          <Play className="w-4 h-4 text-green-400 hover:text-green-300" />
        )}
      </button>
    );
  }

  // Bot exists - show appropriate controls based on status
  if (bot.status === "RUNNING") {
    return (
      <button
        onClick={() => stopMutation.mutate()}
        disabled={isStopping}
        className="p-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
        title="Stop Bot"
      >
        {isStopping ? (
          <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
        ) : (
          <Square className="w-4 h-4 text-red-400 hover:text-red-300" />
        )}
      </button>
    );
  }

  if (bot.status === "STOPPED") {
    return (
      <button
        onClick={() => startMutation.mutate()}
        disabled={isStarting}
        className="p-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
        title="Start Bot"
      >
        {isStarting ? (
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        ) : (
          <Play className="w-4 h-4 text-green-400 hover:text-green-300" />
        )}
      </button>
    );
  }

  // Error state or other status
  return (
    <div className="flex gap-2">
      <button
        onClick={() => stopMutation.mutate()}
        disabled={isStopping}
        className="p-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
        title="Stop Bot"
      >
        {isStopping ? (
          <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
        ) : (
          <Square className="w-4 h-4 text-red-400 hover:text-red-300" />
        )}
      </button>
      <button
        onClick={() => startMutation.mutate()}
        disabled={isStarting}
        className="p-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
        title="Restart Bot"
      >
        {isStarting ? (
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        ) : (
          <Play className="w-4 h-4 text-green-400 hover:text-green-300" />
        )}
      </button>
    </div>
  );
};
