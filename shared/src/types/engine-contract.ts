import { BotActualState } from "../protocol/bot-state";
/**
 * Engine Integration Contract - Formal API between backend and engine
 *
 * Defines explicit command and event schema for engine-backend communication.
 * This contract ensures strict boundaries, versioning, and type safety.
 *
 * Communication Pattern:
 * - Backend → Engine: Commands (via Redis Streams)
 * - Engine → Backend: Events (via Redis Streams)
 *
 * @format
 */

// ===========================================
// VERSIONING
// ===========================================

export const ENGINE_CONTRACT_VERSION = "1.0.0";

// ===========================================
// COMMANDS (Backend → Engine)
// ===========================================

/**
 * Base interface for all commands
 */
export interface EngineCommand {
  type: string;
  engineId: string;
  timestamp: number;
}

/**
 * Command to start the engine
 */
export interface StartEngineCommand extends EngineCommand {
  type: "START_ENGINE";
  strategyId: string;
  /** Strategy-specific configuration (non-secret). */
  config: Record<string, unknown>;
  riskLimits: RiskLimits;
  credentials: {
    accountId: string;
    accessKey: string;
    secretKey: string;
  };
}

/**
 * Command to stop the engine
 */
export interface StopEngineCommand extends EngineCommand {
  type: "STOP_ENGINE";
}

/**
 * Command to start a specific bot/strategy
 */
export interface StartBotCommand extends EngineCommand {
  type: "START_BOT";
  botId: string;
  strategyId: string;
  /** Strategy-specific configuration (non-secret). */
  config: Record<string, unknown>;
  riskLimits: RiskLimits;
  credentials: {
    accountId: string;
    accessKey: string;
    secretKey: string;
  };
}

/**
 * Command to stop a specific bot/strategy
 */
export interface StopBotCommand extends EngineCommand {
  type: "STOP_BOT";
  botId: string;
}

/**
 * Command to initiate emergency stop
 */
export interface EmergencyStopCommand extends EngineCommand {
  type: "EMERGENCY_STOP";
  botId?: string;
  action: "CANCEL_ALL_ORDERS" | "CLOSE_POSITIONS" | "FULL_SHUTDOWN";
}

/**
 * Command to update strategy configuration
 */
export interface UpdateStrategyConfigCommand extends EngineCommand {
  type: "UPDATE_STRATEGY_CONFIG";
  botId: string;
  /** Strategy-specific configuration (non-secret). */
  config: Record<string, unknown>;
}

// ===========================================
// EVENTS (Engine → Backend)
// ===========================================

/**
 * Base interface for all events
 */
export interface EngineEvent {
  type: string;
  engineId: string;
  timestamp: number;
}

/**
 * Event when engine has started successfully
 */
export interface EngineStartedEvent extends EngineEvent {
  type: "ENGINE_STARTED";
  uptime: number;
}

/**
 * Event when engine has stopped
 */
export interface EngineStoppedEvent extends EngineEvent {
  type: "ENGINE_STOPPED";
  reason: string;
  uptime: number;
}

/**
 * Event when a bot has started successfully
 */
export interface BotStartedEvent extends EngineEvent {
  type: "BOT_STARTED";
  botId: string;
  strategyId: string;
  symbol: string;
  strategyType: string;
}

/**
 * Event when a bot has stopped
 */
export interface BotStoppedEvent extends EngineEvent {
  type: "BOT_STOPPED";
  botId: string;
  reason: string;
}

/**
 * Event when a trade is executed
 */
export interface TradeExecutedEvent extends EngineEvent {
  type: "TRADE_EXECUTED";
  botId: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  fee?: number;
  pnl?: number;
  orderId: string;
}

/**
 * Event when engine encounters an error
 */
export interface EngineErrorEvent extends EngineEvent {
  type: "ENGINE_ERROR";
  botId?: string;
  error: string;
  stack?: string;
}

/**
 * Event with engine status and health information
 */
export interface EngineStatusEvent extends EngineEvent {
  type: "ENGINE_STATUS";
  running: boolean;
  bots: number;
  uptime: number;
  cpuUsage?: number;
  memoryUsage?: number;
}

/**
 * Event with bot heartbeat and status
 */
export interface BotHeartbeatEvent extends EngineEvent {
  type: "BOT_HEARTBEAT";
  botId: string;
  status: BotActualState;
  position: number;
  exposure: number;
  currentPrice: number;
  totalTrades: number;
  totalPnl: number;
}

/**
 * Event when position is updated
 */
export interface PositionUpdatedEvent extends EngineEvent {
  type: "POSITION_UPDATED";
  botId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
}

/**
 * Event with strategy performance metrics
 */
export interface PerformanceSnapshotEvent extends EngineEvent {
  type: "PERFORMANCE_SNAPSHOT";
  botId: string;
  timestamp: number;
  metrics: {
    totalTrades: number;
    totalPnl: number;
    winRate: number;
    maxDrawdown: number;
    profitFactor: number;
    sharpeRatio?: number;
  };
}

// ===========================================
// SUPPORTING TYPES
// ===========================================

/**
 * Risk limits configuration
 */
export interface RiskLimits {
  maxLeverage: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  stopLossPercentage: number;
  takeProfitPercentage: number;
  maxOrdersPerMinute: number;
}

/**
 * Engine health status
 */
export interface EngineHealth {
  status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  bots: number;
  uptime: number;
  cpuUsage?: number;
  memoryUsage?: number;
  lastHeartbeat: number;
}

/**
 * Bot status information
 */
export interface BotStatus {
  botId: string;
  strategyId: string;
  status: BotActualState;
  symbol: string;
  currentPrice: number;
  totalTrades: number;
  totalPnl: number;
  updatedAt: number;
}

// ===========================================
// TYPE GUARDS
// ===========================================

/**
 * Guards accept `unknown` (values arrive from the wire) and narrow through a
 * partial view of the target shape, so no `any` leaks into the contract.
 */

export function isEngineCommand(obj: unknown): obj is EngineCommand {
  const candidate = obj as Partial<EngineCommand> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.type === "string" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number"
  );
}

export function isEngineEvent(obj: unknown): obj is EngineEvent {
  const candidate = obj as Partial<EngineEvent> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.type === "string" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number"
  );
}

export function isStartEngineCommand(obj: unknown): obj is StartEngineCommand {
  const candidate = obj as Partial<StartEngineCommand> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "START_ENGINE" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number" &&
    typeof candidate.strategyId === "string" &&
    !!candidate.config &&
    !!candidate.credentials
  );
}

export function isStopEngineCommand(obj: unknown): obj is StopEngineCommand {
  const candidate = obj as Partial<StopEngineCommand> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "STOP_ENGINE" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number"
  );
}

export function isStartBotCommand(obj: unknown): obj is StartBotCommand {
  const candidate = obj as Partial<StartBotCommand> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "START_BOT" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number" &&
    typeof candidate.botId === "string" &&
    typeof candidate.strategyId === "string" &&
    !!candidate.config &&
    !!candidate.credentials
  );
}

export function isStopBotCommand(obj: unknown): obj is StopBotCommand {
  const candidate = obj as Partial<StopBotCommand> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "STOP_BOT" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number" &&
    typeof candidate.botId === "string"
  );
}

export function isEmergencyStopCommand(
  obj: unknown
): obj is EmergencyStopCommand {
  const candidate = obj as Partial<EmergencyStopCommand> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "EMERGENCY_STOP" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number" &&
    ["CANCEL_ALL_ORDERS", "CLOSE_POSITIONS", "FULL_SHUTDOWN"].includes(
      candidate.action as string
    )
  );
}

export function isUpdateStrategyConfigCommand(
  obj: unknown
): obj is UpdateStrategyConfigCommand {
  const candidate = obj as Partial<UpdateStrategyConfigCommand> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "UPDATE_STRATEGY_CONFIG" &&
    typeof candidate.engineId === "string" &&
    typeof candidate.timestamp === "number" &&
    typeof candidate.botId === "string" &&
    !!candidate.config
  );
}
