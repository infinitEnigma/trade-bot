/**
 * Infrastructure Interfaces - Contract Layer
 *
 * Defines interfaces for infrastructure services that core business logic depends on.
 * These interfaces ensure core purity by abstracting technical concerns behind contracts.
 *
 * @format
 */

import { Balance, Position } from './domain';

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

export interface CacheResult<T = any> {
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

export interface ApiResult<T = any> {
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
    get<T = any>(url: string, config?: HttpConfig): Promise<HttpResponse<T>>;

    /**
     * Make a POST request
     */
    post<T = any>(url: string, data?: any, config?: HttpConfig): Promise<HttpResponse<T>>;

    /**
     * Make a PUT request
     */
    put<T = any>(url: string, data?: any, config?: HttpConfig): Promise<HttpResponse<T>>;

    /**
     * Make a DELETE request
     */
    delete<T = any>(url: string, config?: HttpConfig): Promise<HttpResponse<T>>;
}

export interface HttpConfig {
    headers?: Record<string, string>;
    timeout?: number;
    retries?: number;
    baseURL?: string;
}

export interface HttpResponse<T = any> {
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
    debug(message: string, meta?: any): void;

    /**
     * Info level logging
     */
    info(message: string, meta?: any): void;

    /**
     * Warning level logging
     */
    warn(message: string, meta?: any): void;

    /**
     * Error level logging
     */
    error(message: string, meta?: any): void;

    /**
     * Create a child logger with context
     */
    child(meta: any): ILogger;
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
    query<T = any>(sql: string, params?: any[]): Promise<DatabaseResult<T>>;
}

export interface DatabaseResult<T = any> {
    rows: T[];
    rowCount: number;
}

// Domain types are imported at the top
// Position class is now in domain.ts

export interface Trade {
    id: string;
    userId: string;
    orderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    pnl?: number;
    fee: number;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    executedAt: Date;
}

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
