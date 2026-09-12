/**
 * Exchange Client Interface
 *
 * Defines the contract that all exchange implementations must fulfill.
 * This allows the engine to work with any exchange (Kodiak, Uniswap, etc.)
 * without coupling to specific exchange APIs.
 *
 * @format
 */

/**
 * Ticker information for a trading pair.
 */
export interface ExchangeTicker {
    symbol: string;
    price: number;
    mark_price?: number;
    index_price?: number;
}

/**
 * Order request parameters.
 */
export interface ExchangeOrderRequest {
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'LIMIT' | 'MARKET';
    orderPrice?: number;
    orderQuantity: number;
    clientOrderId?: string;
}

/**
 * Order response from exchange.
 */
export interface ExchangeOrderResponse {
    orderId: string;
    status: string;
    executedPrice?: number;
    executedQuantity?: number;
}

/**
 * Position information.
 */
export interface ExchangePosition {
    symbol: string;
    position_qty: number;
    mark_price: number;
    [key: string]: unknown;
}

/**
 * Account information.
 */
export interface ExchangeAccountInfo {
    total_value: number;
    max_leverage: number;
    max_notional?: Record<string, number>;
    [key: string]: unknown;
}

/**
 * Exchange client interface.
 * All exchange implementations must implement this interface.
 */
export interface ExchangeClient {
    /**
     * Get current ticker for a symbol.
     */
    getTicker(symbol: string): Promise<ExchangeTicker>;

    /**
     * Place a new order.
     */
    createOrder(request: ExchangeOrderRequest): Promise<ExchangeOrderResponse>;

    /**
     * Cancel an existing order.
     */
    cancelOrder(orderId: string, symbol: string): Promise<{ status: string }>;

    /**
     * Get order status.
     */
    getOrder(orderId: string): Promise<ExchangeOrderResponse>;

    /**
     * Get all open positions.
     */
    getPositions(): Promise<ExchangePosition[]>;

    /**
     * Get account information.
     */
    getAccountInfo(): Promise<ExchangeAccountInfo>;
}
