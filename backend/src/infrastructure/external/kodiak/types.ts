/**
 * Kodiak (Orderly) API type contracts.
 *
 * Single source of truth for all wire types used by the Kodiak integration
 * layer. Re-exported from `kodiak-integration.service.ts` for backward
 * compatibility with existing imports.
 */

export interface KodiakCredentials {
    accountId: string;
    apiKey: string;
    secretKey: string;
}

export interface KodiakApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface KodiakPosition {
    symbol: string;
    positionAmt: string;
    entryPrice: string;
    markPrice: string;
    pnl: string;
    rowTime: string;
}

export interface KodiakTrade {
    symbol: string;
    id: string;
    orderId: string;
    side: string;
    price: string;
    qty: string;
    realizedPnl: string;
    marginAsset: string;
    quoteQty: string;
    commission: string;
    commissionAsset: string;
    time: number;
    positionSide: string;
    buyer: boolean;
    maker: boolean;
}

export interface KodiakBalance {
    asset: string;
    free: string;
    locked: string;
    freeze: string;
    withdrawing: string;
    ipoable: string;
    btcValuation: string;
}

export interface KodiakAccountInfo {
    totalBalance: string;
    totalPnl24H: string;
    totalPnl30D: string;
    totalPnlAll: string;
    tradingVolume24H: string;
    accountType: string;
    balances: KodiakBalance[];
    maxLeverage?: string;
}

export interface KodiakApiAccountInfoResponse {
    total_pnl_24_h?: string;
    total_pnl_30_d?: string;
    total_pnl_all?: string;
    trading_volume_last_24_hours?: string;
    account_type?: string;
}

export interface KodiakPublicAccountInfo {
    address?: string;
    account_id?: string;
    [key: string]: unknown; // Allow for additional properties from API
}

export interface KodiakHolding {
    holding?: string;
    balance?: string;
    price?: string;
    [key: string]: unknown; // Allow for additional properties from API
}

export interface KodiakHoldingsResponse {
    holding?: KodiakHolding[];
    balance?: KodiakHolding[];
    [key: string]: unknown; // Allow for additional properties from API
}

/**
 * Market Ticker Data from Kodiak API
 */
export interface KodiakMarketTicker {
    symbol: string;
    index_price?: number;
    mark_price?: number;
    sum_unitary_funding?: number;
    est_funding_rate?: number;
    last_funding_rate?: number;
    next_funding_time?: number;
    open_interest?: string;
    '24h_open'?: number;
    '24h_close'?: number;
    '24h_high'?: number;
    '24h_low'?: number;
    '24h_amount'?: number;
    '24h_volume'?: number;
    [key: string]: unknown; // Allow for additional properties from API
}

/**
 * Orderbook Data from Kodiak API
 */
export interface KodiakOrderbook {
    asks: Array<[number, number]>; // [price, quantity]
    bids: Array<[number, number]>; // [price, quantity]
    timestamp?: number;
    symbol?: string;
    [key: string]: unknown; // Allow for additional properties from API
}

/**
 * TradingView Configuration from Kodiak API
 */
export interface KodiakTradingViewConfig {
    supported_resolutions: string[];
    exchanges?: Record<string, {
        value: string;
        name: string;
        desc: string;
    }>;
    symbols_types?: Record<string, {
        value: string;
        name: string;
    }>;
    [key: string]: unknown; // Allow for additional properties from API
}

/**
 * TradingView Symbols from Kodiak API
 */
export interface KodiakTradingViewSymbols {
    name: string;
    ticker: string;
    description: string;
    session: string;
    timezone: string;
    minmov: number;
    pricescale: number;
    has_intraday: boolean;
    has_daily: boolean;
    has_weekly_and_monthly: boolean;
    supported_resolutions: string[];
    intraday_multipliers?: string[];
    [key: string]: unknown; // Allow for additional properties from API
}

/**
 * TradingView History Data from Kodiak API
 */
export interface KodiakTradingViewHistory {
    s: string; // status
    t: number[]; // timestamps
    o: number[]; // open prices
    h: number[]; // high prices
    l: number[]; // low prices
    c: number[]; // close prices
    v: number[]; // volumes
    [key: string]: unknown; // Allow for additional properties from API
}
