/** @format */

export interface GridStrategyConfig {
  symbol: string;
  gridSize: number; // Number of grid levels
  orderQuantity: number; // Size per order
  gridRangePercent: number; // Price range as percentage
  takeProfitPercent?: number; // Optional take profit
  stopLossPercent?: number; // Optional stop loss
}

export interface GridLevel {
  price: number;
  buyOrderId?: string;
  sellOrderId?: string;
  filled: boolean;
}

export interface BotStatus {
  botId: string;
  strategyId: string;
  status: "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "ERROR";
  currentPrice: number;
  totalTrades: number;
  totalPnl: number;
  lastError?: string;
  updatedAt: Date;
}

export interface Trade {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  executedAt: Date;
  pnl?: number;
}

export interface OrderRequest {
  symbol: string;
  orderType: "LIMIT" | "MARKET";
  side: "BUY" | "SELL";
  orderPrice?: number;
  orderQuantity: number;
  clientOrderId?: string;
}

export interface OrderResponse {
  orderId: string;
  status: string;
  executedPrice?: number;
  executedQuantity?: number;
}
