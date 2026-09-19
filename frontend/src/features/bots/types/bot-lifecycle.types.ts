/**
 * Bot Lifecycle Types for Frontend
 *
 * Types for managing bot lifecycle state from the backend.
 * The frontend should never assume immediate state transitions.
 *
 * @format
 */

/**
 * Actual lifecycle state as reported by the engine via backend.
 * UNKNOWN means the engine is unreachable / heartbeat lost.
 */
export type BotActualState =
  "STOPPED" | "STARTING" | "RUNNING" | "STOPPING" | "ERROR" | "UNKNOWN";

/**
 * Desired lifecycle state - what the backend/user wants.
 */
export type BotDesiredState = "RUNNING" | "STOPPED";

/**
 * Event emitted by the backend when a bot's state changes.
 */
export interface BotStateChangedEvent {
  botId: string;
  from: BotActualState;
  to: BotActualState;
  correlationId: string;
  timestamp: number;
}

/**
 * Connection status for WebSocket.
 */
export type ConnectionStatus =
  "connected" | "connecting" | "disconnected" | "reconnecting" | "error";

/**
 * Bot lifecycle state for a single bot.
 */
export interface BotLifecycleState {
  botId: string;
  actualState: BotActualState;
  desiredState: BotDesiredState;
  lastUpdated: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Map actual_state to display information.
 */
export const STATE_DISPLAY_INFO: Record<
  BotActualState,
  {
    label: string;
    color: string;
    icon: "stopped" | "loading" | "running" | "loading" | "error" | "unknown";
  }
> = {
  STOPPED: { label: "Stopped", color: "text-textMuted", icon: "stopped" },
  STARTING: { label: "Starting...", color: "text-warning", icon: "loading" },
  RUNNING: { label: "Running", color: "text-success", icon: "running" },
  STOPPING: { label: "Stopping...", color: "text-warning", icon: "loading" },
  ERROR: { label: "Error", color: "text-danger", icon: "error" },
  UNKNOWN: { label: "Connection Lost", color: "text-danger", icon: "unknown" },
};
