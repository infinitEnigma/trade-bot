import { BotActualState } from "@trade-bot/shared";

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
  /**
   * Slot id generation for this side (G1). `OrderManager.markFilled` bumps it
   * whenever a fill books, so the next cycle derives a fresh client order id
   * and the pre-submit lookup can never re-query the venue's terminal history
   * row for the spent id (stale `FOUND_FILLED` → phantom fill + blocked
   * re-placement, Gate 1 report §3.1). Absent = 0 (legacy snapshots).
   */
  buyGen?: number;
  sellGen?: number;
}

export interface BotStatus {
  botId: string;
  strategyId: string;
  status: BotActualState;
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
