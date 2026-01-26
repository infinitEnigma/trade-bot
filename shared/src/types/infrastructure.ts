/**
 * Infrastructure Interfaces - Contract Layer
 *
 * Defines interfaces for infrastructure services that core business logic depends on.
 * These interfaces ensure core purity by abstracting technical concerns behind contracts.
 *
 * @format
 */

// ===========================================
// DOMAIN TYPE IMPORTS (from main index)
// ===========================================

import { Balance, Position } from './domain';
import { Trade } from '../index';

// ===========================================
// CACHE INFRASTRUCTURE
// ===========================================

export interface ICacheService {
    /**
     * Get a value from cache
     */
    get<T>(key: string): Promise<CacheResult<T>>;

    /**
     * Set a value in cache with optional TTL
     */
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<CacheResult<boolean>>;

    /**
     * Delete a value from cache
     */
    delete(key: string): Promise<CacheResult<boolean>>;

    /**
     * Check if a key exists in cache
     */
    exists(key: string): Promise<CacheResult<boolean>>;

    /**
     * Set a value with TTL (convenience method)
     */
    setex<T>(key: string, ttlSeconds: number, value: T): Promise<CacheResult<boolean>>;

    /**
     * Get multiple values by keys
     */
    mget<T>(keys: string[]): Promise<CacheResult<Record<string, T>>>;

    /**
     * Set multiple values
     */
    mset<T>(keyValues: Record<string, T>, ttlSeconds?: number): Promise<CacheResult<boolean>>;

    /**
     * Atomic conditional update - only set if key doesn't exist or matches expected value
     */
    atomicConditionalUpdate<T>(
        key: string,
        newValue: T,
        expectedValue?: T | null
    ): Promise<CacheResult<boolean>>;
}

export interface CacheResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

// ===========================================
// EXTERNAL API INFRASTRUCTURE
// ===========================================

export interface IExternalApiService {
    /**
     * Get user balance from external exchange
     */
    getBalance(userId: string): Promise<ApiResult<Balance>>;

    /**
     * Get user positions from external exchange
     */
    getPositions(userId: string): Promise<ApiResult<Position[]>>;

    /**
     * Get user trade history from external exchange
     */
    getTrades(userId: string, limit?: number): Promise<ApiResult<Trade[]>>;

    /**
     * Get account information from external exchange
     */
    getAccountInfo(userId: string): Promise<ApiResult<AccountInfo>>;

    /**
     * Test connectivity to external API
     */
    testConnectivity(credentials: ExternalCredentials): Promise<ApiResult<boolean>>;

    /**
     * Invalidate cached data for a user
     */
    invalidateUserCache(userId: string): Promise<void>;
}

export interface ApiResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: number;
}

// ===========================================
// HTTP CLIENT INFRASTRUCTURE
// ===========================================

export interface IHttpClient {
    /**
     * Make a GET request
     */
    get<T = unknown>(url: string, config?: HttpConfig): Promise<HttpResponse<T>>;

    /**
     * Make a POST request
     */
    post<T = unknown>(url: string, data?: unknown, config?: HttpConfig): Promise<HttpResponse<T>>;

    /**
     * Make a PUT request
     */
    put<T = unknown>(url: string, data?: unknown, config?: HttpConfig): Promise<HttpResponse<T>>;

    /**
     * Make a DELETE request
     */
    delete<T = unknown>(url: string, config?: HttpConfig): Promise<HttpResponse<T>>;
}

export interface HttpConfig {
    headers?: Record<string, string>;
    timeout?: number;
    retries?: number;
    baseURL?: string;
}

export interface HttpResponse<T = unknown> {
    status: number;
    statusText: string;
    data: T;
    headers: Record<string, string>;
}

// ===========================================
// LOGGING INFRASTRUCTURE
// ===========================================

export interface ILogger {
    /**
     * Debug level logging
     */
    debug(message: string, meta?: unknown): void;

    /**
     * Info level logging
     */
    info(message: string, meta?: unknown): void;

    /**
     * Warning level logging
     */
    warn(message: string, meta?: unknown): void;

    /**
     * Error level logging
     */
    error(message: string, meta?: unknown): void;

    /**
     * Create a child logger with context
     */
    child(meta: unknown): ILogger;
}

// ===========================================
// PASSWORD SECURITY INFRASTRUCTURE
// ===========================================

export interface IPasswordService {
    /**
     * Hash a password
     */
    hash(password: string, rounds?: number): Promise<string>;

    /**
     * Verify a password against its hash
     */
    verify(password: string, hash: string): Promise<boolean>;
}

// ===========================================
// ENCRYPTION INFRASTRUCTURE
// ===========================================

export interface IEncryptionService {
    /**
     * Encrypt API key
     */
    encryptApiKey(apiKey: string): string;

    /**
     * Decrypt API key
     */
    decryptApiKey(encryptedApiKey: string): string;

    /**
     * Encrypt secret key
     */
    encryptSecretKey(secretKey: string): string;

    /**
     * Decrypt secret key
     */
    decryptSecretKey(encryptedSecretKey: string): string;

    /**
     * Decrypt with version handling (for backward compatibility)
     */
    decryptWithVersion(encryptedData: string): Promise<string>;
}

// ===========================================
// TOKEN SECURITY INFRASTRUCTURE
// ===========================================

export interface ITokenService {
    /**
     * Generate access token
     */
    generateAccessToken(payload: TokenPayload): string;

    /**
     * Generate refresh token
     */
    generateRefreshToken(payload: TokenPayload): string;

    /**
     * Verify and decode token
     */
    verifyToken(token: string): TokenPayload | null;

    /**
     * Hash token for storage (not for security, just for key length)
     */
    hashTokenForStorage(token: string): string;
}

// ===========================================
// TRADING ENGINE INFRASTRUCTURE
// ===========================================

export interface ITradingEngineService {
    /**
     * Ensure trading engine is running
     */
    ensureEngineRunning(): Promise<void>;

    /**
     * Get engine status and health information
     */
    getEngineStatus(): Promise<{
        running: boolean;
        health?: {
            status: string;
            bots: number;
            uptime: number;
        };
    }>;

    /**
     * Stop engine if no active bots
     */
    stopEngineIfNoActiveBots(): Promise<void>;

    /**
     * Force stop trading engine
     */
    forceStopEngine(): Promise<void>;

    /**
     * Check if engine process is alive
     */
    isEngineProcessAlive(): boolean;
}

// ===========================================
// BOT STATUS MANAGEMENT INFRASTRUCTURE
// ===========================================

export enum BotStatus {
    STOPPED = 'STOPPED',
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    PAUSED = 'PAUSED',
    RECOVERING = 'RECOVERING',
    ERROR = 'ERROR',
    FORCE_STOPPING = 'FORCE_STOPPING'
}

export interface IBotStatusService {
    /**
     * Start a bot instance
     */
    startBot(botId: string, userId: string): Promise<{ success: boolean; error?: string }>;

    /**
     * Stop a bot instance
     */
    stopBot(botId: string, userId: string): Promise<{ success: boolean; error?: string }>;

    /**
     * Get comprehensive bot status information
     */
    getBotStatusInfo(botId: string, userId: string): Promise<{
        status: BotStatus;
        lastHeartbeat?: number;
        errorMessage?: string;
        performance?: {
            totalTrades: number;
            totalPnl: number;
        };
        [key: string]: unknown;
    }>;

    /**
     * Send heartbeat for bot health monitoring
     */
    sendBotHeartbeat(botId: string, statusInfo?: {
        timestamp?: number;
        memoryUsage?: number;
        cpuUsage?: number;
        [key: string]: unknown;
    }): Promise<{ success: boolean; error?: string }>;

    /**
     * Validate bot status and perform reconciliation
     */
    validateBotStatus(botData: {
        id: string;
        status: string;
        lastHeartbeat?: number;
        [key: string]: unknown;
    }, currentTime: number): Promise<{
        updatedStatus: string;
        errorMessage: string | null;
        isStale: boolean;
        lastHeartbeatAge: number;
    }>;

    /**
     * Get bot statistics for monitoring
     */
    getBotStats(): Promise<{
        totalBots: number;
        runningBots: number;
        errorBots: number;
        staleBots: number;
    }>;
}

// ===========================================
// BOT PERFORMANCE TRACKING INFRASTRUCTURE
// ===========================================

export interface IBotPerformanceService {
    /**
     * Record trade execution for performance tracking
     */
    recordTrade(botId: string, tradeData: {
        symbol: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        price: number;
        pnl: number;
        fee: number;
        timestamp: number;
    }): Promise<void>;

    /**
     * Get bot performance metrics
     */
    getBotPerformance(botId: string, timeframe: '1h' | '24h' | '7d' | '30d'): Promise<{
        totalTrades: number;
        totalVolume: number;
        totalPnl: number;
        winRate: number;
        averageTrade: number;
        sharpeRatio?: number;
        maxDrawdown: number;
    }>;

    /**
     * Get performance summary for multiple bots
     */
    getPerformanceSummary(userId: string): Promise<{
        totalBots: number;
        activeBots: number;
        totalPnl: number;
        totalVolume: number;
        bestPerformingBot: string;
        worstPerformingBot: string;
    }>;

    /**
     * Calculate risk metrics for bot
     */
    calculateRiskMetrics(botId: string): Promise<{
        volatility: number;
        maxDrawdown: number;
        valueAtRisk: number;
        expectedShortfall: number;
    }>;
}

import { UserLevel } from '../index';

export interface TokenPayload {
    userId: string;
    email: string;
    userLevel: UserLevel;
    exp?: number;
    iat?: number;
}

// ===========================================
// DATABASE INFRASTRUCTURE (Low-level, used by repositories)
// ===========================================

export interface IDatabaseConnection {
    /**
     * Execute a query
     */
    query<T = unknown>(sql: string, params?: unknown[]): Promise<DatabaseResult<T>>;
}

export interface DatabaseField {
    name: string;
    dataType: string;
    columnID?: number;
    [key: string]: unknown;
}

export interface DatabaseResult<T = unknown> {
    rows: T[];
    rowCount: number;
    fields?: DatabaseField[];
    command?: string;
    oid?: number;
}

// Domain types are imported at the top
// All domain classes (Balance, Position, Trade) are now imported from domain.ts

export interface AccountInfo {
    totalBalance: string;
    totalPnl24H: string;
    totalPnl30D: string;
    totalPnlAll: string;
    accountType: string;
    balances: AccountBalance[];
}

export interface AccountBalance {
    asset: string;
    free: string;
    locked: string;
}

export interface ExternalCredentials {
    accountId: string;
    apiKey: string;
    secretKey: string;
}

// UserLevel is already imported above for TokenPayload
