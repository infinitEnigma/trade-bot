/**
 * Frontend-Backend Integration Contract - Formal API between frontend and backend
 *
 * Defines explicit request/response schema for frontend-backend communication.
 * This contract ensures strict boundaries, versioning, and type safety.
 *
 * Communication Pattern:
 * - Frontend → Backend: HTTP Requests (REST)
 * - Backend → Frontend: HTTP Responses + WebSocket Events
 *
 * @format
 */

// ===========================================
// VERSIONING
// ===========================================

export const FRONTEND_BACKEND_CONTRACT_VERSION = "1.0.0";

// ===========================================
// BASE TYPES
// ===========================================

/**
 * Base response interface for all API responses
 */
export interface ApiResponse<T = any> {
    success: boolean;
    data: T;
    message?: string;
}

/**
 * Base error response interface
 */
export interface ApiError {
    success: false;
    error: string;
    code?: string;
    details?: any;
}

/**
 * Pagination information
 */
export interface Pagination {
    page: number;
    limit: number;
    total: number;
    pages: number;
}

// ===========================================
// AUTHENTICATION & USER MANAGEMENT
// ===========================================

/**
 * Login request
 */
export interface LoginRequest {
    email: string;
    password: string;
}

/**
 * Login response
 */
export interface LoginResponse {
    user: FrontendUser;
    token?: string; // For future token-based auth
}

/**
 * Registration request
 */
export interface RegisterRequest {
    email: string;
    password: string;
}

/**
 * Registration response
 */
export interface RegisterResponse {
    user: FrontendUser;
}

/**
 * User profile response
 */
export interface UserProfileResponse {
    user: FrontendUser;
    kodiakCredentials?: FrontendKodiakCredentials;
}

/**
 * Kodiak credentials request
 */
export interface KodiakCredentialsRequest {
    apiKey: string;
    apiSecret: string;
}

/**
 * Kodiak credentials response
 */
export interface KodiakCredentialsResponse {
    apiKey: string;
    apiSecretMasked: string;
}

// ===========================================
// WALLET & BALANCE
// ===========================================

/**
 * Get balances response
 */
export interface GetBalancesResponse {
    balances: FrontendBalance[];
    total: number;
    currency: string;
}

// ===========================================
// BOT MANAGEMENT
// ===========================================

/**
 * Bot instance creation request
 */
export interface CreateBotRequest {
    strategyId: string;
    name?: string;
    config?: any; // Strategy-specific configuration
    riskLimits?: FrontendRiskLimits;
}

/**
 * Bot instance response
 */
export interface BotInstanceResponse {
    id: string;
    strategyId: string;
    name: string;
    status: "RUNNING" | "STOPPED" | "ERROR" | "PAUSED";
    config: any;
    riskLimits: FrontendRiskLimits;
    position?: number;
    exposure?: number;
    lastHeartbeat?: Date;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Get bot instances response
 */
export interface GetBotInstancesResponse {
    bots: BotInstanceResponse[];
    pagination: Pagination;
    stats: {
        total: number;
        running: number;
        stopped: number;
        error: number;
        paused: number;
    };
}

// ===========================================
// TRADING & STRATEGIES
// ===========================================

/**
 * Create strategy request
 */
export interface CreateStrategyRequest {
    name: string;
    type: 'GRID' | 'TREND_FOLLOWING' | 'ARBITRAGE';
    symbol: string;
    config: FrontendStrategyConfig;
    isActive?: boolean;
}

/**
 * Strategy response
 */
export interface StrategyResponse {
    id: string;
    userId: string;
    name: string;
    type: 'GRID' | 'TREND_FOLLOWING' | 'ARBITRAGE';
    symbol: string;
    config: FrontendStrategyConfig;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Get strategies response
 */
export interface GetStrategiesResponse {
    strategies: StrategyResponse[];
    pagination: Pagination;
    stats: {
        total: number;
        active: number;
        inactive: number;
        byType: {
            GRID: number;
            TREND_FOLLOWING: number;
            ARBITRAGE: number;
        };
    };
}

/**
 * Market price request
 */
export interface GetMarketPriceRequest {
    symbol: string;
    timeFrame?: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    limit?: number;
}

/**
 * Market price response
 */
export interface GetMarketPriceResponse {
    symbol: string;
    currentPrice: number;
    priceChange24h: number;
    priceChangePercentage24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    chartData?: FrontendMarketDataPoint[];
}

// ===========================================
// TRADES & POSITIONS
// ===========================================

/**
 * Get trades response
 */
export interface GetTradesResponse {
    trades: TradeResponse[];
    pagination: Pagination;
    stats: {
        total: number;
        profitable: number;
        totalPnl: number;
        avgPnl: number;
    };
}

/**
 * Trade response
 */
export interface TradeResponse {
    id: string;
    userId: string;
    orderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    fee: number;
    pnl: number;
    status: 'EXECUTED' | 'PENDING' | 'CANCELED';
    executedAt: Date;
}

/**
 * Get positions response
 */
export interface GetPositionsResponse {
    positions: PositionResponse[];
    total: number;
    totalPnl: number;
}

/**
 * Position response
 */
export interface PositionResponse {
    id: string;
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    entryPrice: number;
    markPrice: number;
    leverage: number;
    marginRatio: number;
    liquidationPrice?: number;
    pnl: number;
    pnlPercentage: number;
}

// ===========================================
// ANALYTICS & PERFORMANCE
// ===========================================

/**
 * Get analytics response
 */
export interface GetAnalyticsResponse {
    performance: FrontendPerformanceMetrics;
    risk: FrontendRiskMetrics;
    sector: FrontendSectorPerformance;
    recentTrades: TradeResponse[];
}

/**
 * Performance metrics
 */
export interface FrontendPerformanceMetrics {
    totalTrades: number;
    totalPnl: number;
    winRate: number;
    maxDrawdown: number;
    profitFactor: number;
    sharpeRatio?: number;
}

/**
 * Risk metrics
 */
export interface FrontendRiskMetrics {
    totalExposure: number;
    maxLeverage: number;
    VaR: number; // Value at Risk
    expectedShortfall: number;
    drawdownPercentage: number;
    marginUtilization: number;
}

/**
 * Sector performance
 */
export interface FrontendSectorPerformance {
    total: number;
    bySector: {
        name: string;
        count: number;
        pnl: number;
        percentage: number;
    }[];
}

// ===========================================
// SYSTEM HEALTH & STATUS
// ===========================================

/**
 * System health response
 */
export interface SystemHealthResponse {
    status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    timestamp: Date;
    uptime: number;
    services: {
        api: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
        database: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
        engine: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
        redis: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    };
    metrics: {
        cpu: number;
        memory: number;
        disk: number;
        network: {
            in: number;
            out: number;
        };
    };
}

// ===========================================
// WEB SOCKET EVENTS
// ===========================================

/**
 * Base interface for all WebSocket events
 */
export interface FrontendWebSocketEvent {
    type: string;
    timestamp: number;
}

/**
 * Trade executed event
 */
export interface FrontendTradeExecutedEvent extends FrontendWebSocketEvent {
    type: 'trade:executed';
    data: TradeResponse;
}

/**
 * Position updated event
 */
export interface FrontendPositionUpdatedEvent extends FrontendWebSocketEvent {
    type: 'position:updated';
    data: PositionResponse;
}

/**
 * Bot status changed event
 */
export interface FrontendBotStatusEvent extends FrontendWebSocketEvent {
    type: 'bot:status';
    data: {
        botId: string;
        status: 'RUNNING' | 'STOPPED' | 'ERROR' | 'PAUSED';
        position?: number;
        exposure?: number;
    };
}

/**
 * Engine status changed event
 */
export interface FrontendEngineStatusEvent extends FrontendWebSocketEvent {
    type: 'engine:status';
    data: {
        running: boolean;
        bots: number;
        uptime: number;
        cpuUsage?: number;
        memoryUsage?: number;
    };
}

/**
 * Error event
 */
export interface FrontendErrorEvent extends FrontendWebSocketEvent {
    type: 'error';
    data: {
        message: string;
        code?: string;
        details?: any;
    };
}

// ===========================================
// SUPPORTING TYPES (from domain.ts)
// ===========================================

export interface FrontendBalance {
    total: number;
    available: number;
    locked: number;
    currency: string;
    lastUpdated: Date;
}

export interface FrontendStrategyConfig {
    leverage?: number;
    gridSize?: number;
    gridRange?: number;
    orderQuantity?: number;
    takeProfit?: number;
    entryThreshold?: number;
    exitThreshold?: number;
    stopLoss?: number;
}

export interface FrontendRiskLimits {
    maxLeverage: number;
    maxPositionSize: number;
    maxDailyLoss: number;
    stopLossPercentage: number;
    takeProfitPercentage: number;
    maxOrdersPerMinute: number;
}

export interface FrontendUser {
    id: string;
    email: string;
    userLevel: 'BASIC' | 'REGISTERED' | 'VERIFIED';
    roles?: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface FrontendKodiakCredentials {
    apiKey: string;
    apiSecretMasked: string;
}

export interface FrontendMarketDataPoint {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// ===========================================
// TYPE GUARDS
// ===========================================

export function isApiResponse(obj: any): obj is ApiResponse {
    return obj && typeof obj === 'object' && typeof obj.success === 'boolean';
}

export function isApiError(obj: any): obj is ApiError {
    return obj && typeof obj === 'object' && obj.success === false && typeof obj.error === 'string';
}

export function isLoginRequest(obj: any): obj is LoginRequest {
    return obj && typeof obj === 'object' && typeof obj.email === 'string' && typeof obj.password === 'string';
}

export function isRegisterRequest(obj: any): obj is RegisterRequest {
    return obj && typeof obj === 'object' && typeof obj.email === 'string' && typeof obj.password === 'string';
}

export function isCreateBotRequest(obj: any): obj is CreateBotRequest {
    return obj && typeof obj === 'object' && typeof obj.strategyId === 'string';
}

export function isCreateStrategyRequest(obj: any): obj is CreateStrategyRequest {
    return obj && typeof obj === 'object' && typeof obj.name === 'string' && ['GRID', 'TREND_FOLLOWING', 'ARBITRAGE'].includes(obj.type);
}