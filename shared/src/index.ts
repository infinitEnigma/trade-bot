/** @format */

// ============================================
// User & Authentication Types
// ============================================

export enum UserLevel {
  BASIC = "BASIC",
  REGISTERED = "REGISTERED",
  VERIFIED = "VERIFIED",
}

export enum UserRole {
  QUALIFIED_ALPHA = "QUALIFIED_ALPHA",
}

export interface User {
  id: string;
  email: string;
  userLevel: UserLevel;
  roles?: UserRole[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRegistration {
  email: string;
  password: string;
}

export interface UserLogin {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ============================================
// Kodiak Credentials Types
// ============================================

export interface KodiakCredentials {
  id: string;
  userId: string;
  accountId: string;
  apiKey: string;
  secretKey: string;
  walletSignature?: string;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface KodiakConnectionRequest {
  accountId: string;
  apiKey: string;
  secretKey: string;
  walletSignature?: string;
}

// ============================================
// Market Data Types
// ============================================

export interface Ticker {
  symbol: string;
  price: number;
  price24h: number;
  volume24h: number;
  fundingRate: number;
  markPrice: number;
  indexPrice: number;
  timestamp: number;
}

export interface Kline {
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  startTime: number;
  endTime: number;
}

export interface OrderBook {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
}

// ============================================
// Trading Types
// ============================================

// Position interface removed - now using domain class from domain.ts

export interface Order {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: OrderType;
  price?: number;
  quantity: number;
  filledQuantity: number;
  averagePrice?: number;
  status: OrderStatus;
  reduceOnly: boolean;
  createdAt: number;
  updatedAt: number;
}

export enum OrderType {
  LIMIT = "LIMIT",
  MARKET = "MARKET",
  IOC = "IOC",
  FOK = "FOK",
  POST_ONLY = "POST_ONLY",
}

export enum OrderStatus {
  PENDING = "PENDING",
  OPEN = "OPEN",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
  REJECTED = "REJECTED",
}

export enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

// ============================================
// Strategy Types
// ============================================

export enum StrategyType {
  GRID = "GRID",
  TREND_FOLLOWING = "TREND_FOLLOWING",
  ARBITRAGE = "ARBITRAGE",
}

export interface Strategy {
  id: string;
  userId: string;
  name: string;
  type: StrategyType;
  config: StrategyConfig;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StrategyConfig {
  symbol: string;
  leverage?: number;
  gridSize?: number;
  gridRange?: number;
  orderQuantity?: number;
  takeProfit?: number;
  entryThreshold?: number;
  exitThreshold?: number;
  stopLoss?: number;
}

export interface BotStatus {
  botId: string;
  strategyId: string;
  status: "RUNNING" | "STOPPED" | "ERROR";
  runningTime: number;
  totalTrades: number;
  totalPnl: number;
  lastError?: string;
}

// ============================================
// Trade History Types
// ============================================

export interface Trade {
  id: string;
  userId: string;
  strategyId?: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  pnl?: number;
  fee: number;
  status: OrderStatus;
  executedAt: Date;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ============================================
// WebSocket Types
// ============================================

export interface WSMessage<T = unknown> {
  event: string;
  topic?: string;
  data: T;
  timestamp: number;
}

// ============================================
// Dashboard Types
// ============================================

export interface DashboardData {
  user: User;
  portfolio: {
    totalBalance: number;
    totalPnl: number;
    availableBalance: number;
    positions: import('./types/domain').Position[];
  };
  recentTrades: Trade[];
  activeStrategies: Strategy[];
}

// ============================================
// Infrastructure Interfaces - Contract Layer
// ============================================

export * from './types/infrastructure';

// ============================================
// Repository Interfaces - Data Access Contracts
// ============================================

export * from './types/repositories';

// ============================================
// Domain Models - Rich Business Objects
// ============================================

export * from './types/domain';

// ============================================
// Error Handling Types & Classes
// ============================================

export * from './types/errors';

// ============================================
// Logging Types & Utilities
// ============================================

export * from './types/logging';

// Explicitly export error classes for better discoverability
export {
  AppError,
  ValidationError,
  MissingRequiredFieldError,
  InvalidFormatError,
  AuthenticationError,
  AuthorizationError,
  InvalidCredentialsError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  ConnectionError,
  ExternalServiceError,
  ServiceUnavailableError,
  InsufficientBalanceError,
  PositionSizeExceededError,
  InternalError,
  ConfigurationError,
  ErrorCode,
  ErrorContext,
  isOperationalError,
  getErrorStatusCode,
  createErrorResponse,
  DataFreshnessMetadata,
  FreshnessAwareResponse,
  DataFreshnessUtils
} from './types/errors';

// Explicitly export logging types for better discoverability
export {
  LoggerErrorSeverity,
  LoggerErrorType,
  ErrorInfo,
  StackFrame,
  PerformanceMetrics,
  DatabaseMetrics,
  HttpRequestInfo,
  UserContextInfo,
  LogContext,
  ErrorCodes,
  createErrorInfo,
  createPerformanceMetrics,
  createDatabaseMetrics,
  createHttpRequestInfo,
  createUserContextInfo,
  parseStackTrace,
  classifyError,
  createEnhancedErrorInfo
} from './types/logging';
