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
   * Executed price of the BUY fill that opened this level's long (Phase 5).
   * The exit leg prices itself from this — never from `price`, which is only
   * the level's limit line — and realised PnL is `(sellExec - entryPrice) ×
   * qty - fees`. Set on a BUY fill, cleared when the paired SELL closes the
   * leg; absent on a level whose long predates executed-price accounting, in
   * which case `price` is the fallback.
   */
  entryPrice?: number;
  /**
   * Slot id generation for this side (G1). `OrderManager.markFilled` bumps it
   * whenever a fill books, so the next cycle derives a fresh client order id
   * and the pre-submit lookup can never re-query the venue's terminal history
   * row for the spent id (stale `FOUND_FILLED` → phantom fill + blocked
   * re-placement, Gate 1 report §3.1). Absent = 0 (legacy snapshots).
   */
  buyGen?: number;
  sellGen?: number;
  /**
   * Long quantity this level holds (Phase 4): the sum of booked BUY segments
   * minus booked SELL segments, written only by `OrderManager`. The arming
   * rules read this instead of the boolean `filled`: buy while
   * `heldQty < orderQuantity − ε`, sell once `heldQty ≥ orderQuantity − ε`.
   * Absent = 0 (fresh levels, legacy snapshots — restore derives
   * `filled ? orderQuantity : 0`).
   */
  heldQty?: number;
  /**
   * Booked cumulative of the resting BUY order instance (Phase 4), persisted
   * so a restart seeds `OrderManager.adopt` and cannot double-apply a
   * re-observed cumulative to `heldQty` (risk A4). Reset when a new instance
   * is submitted; ignored when `buyOrderId` is absent.
   */
  buyFilledQty?: number;
  /** Booked cumulative of the resting SELL instance — see `buyFilledQty`. */
  sellFilledQty?: number;
  /**
   * Exit-only state (Phase 3, risk C2). Set when a remainder BUY is refused
   * outright as below the venue's minimum size: the level holds real inventory
   * it can never top up to a full slot, so it must (a) never place another
   * entry, and (b) exit its remaining *real* inventory via a reduce-only SELL.
   *
   * This is deliberately separate from `heldQty` (which always reflects
   * confirmed fills — never an unexecuted remainder) and from `filled` (which
   * keeps its strict "held ≥ slot" meaning). `exitOnly` clears only once a
   * confirmed exit drives `heldQty` to zero, at which point the level is
   * eligible for ordinary entry placement again. Survives restart unchanged.
   */
  exitOnly?: boolean;
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
  /** Reduce-only exit (N6) — see `ExchangeOrderRequest.reduceOnly`. */
  reduceOnly?: boolean;
}

export interface OrderResponse {
  orderId: string;
  status: string;
  executedPrice?: number;
  executedQuantity?: number;
}
