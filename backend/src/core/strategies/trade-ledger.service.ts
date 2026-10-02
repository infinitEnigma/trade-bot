/**
 * Trade Ledger Service - durable financial-state ingest (Phase 4 / N7)
 *
 * Consumes the ledger event family (`ORDER_INTENT`, `TRADE_EXECUTED`,
 * `POSITION_UPDATED`, `PERFORMANCE_SNAPSHOT`) dispatched by
 * `BotEventProcessor` (which has already run the fail-closed engine-authority
 * check) and persists them through `TradeLedgerRepository`.
 *
 * Error policy matches the processor contract:
 * - Malformed payloads (bad side, non-finite numbers, unparseable timestamps)
 *   are business-level issues: logged at error and swallowed so the message is
 *   ACKed — a broken event must not redeliver forever.
 * - Persistence failures throw, leaving the message unacked for redelivery;
 *   the ledger's unique key makes the redelivery idempotent.
 * - UNKNOWN_BOT is a warning + swallow (identity is resolved server-side, so
 *   a spoofed/stale bot id can never write).
 *
 * @format
 */

import {
  BotEvent,
  isOrderIntentEvent,
  isPerformanceSnapshotEvent,
  isPositionUpdatedEvent,
  isTradeExecutedEvent,
  LedgerFillStatus,
} from "@trade-bot/shared";
import { contextLogger as logger } from "../logging";
import { LedgerStatus, TradeLedgerRepository } from "./trade-ledger.repository";

const ORDER_SIDES = new Set(["BUY", "SELL"]);
const POSITION_SIDES = new Set(["LONG", "SHORT", "FLAT"]);
const FILL_STATUSES = new Set(["FILLED", "PARTIALLY_FILLED"]);

function isSide(value: unknown): value is "BUY" | "SELL" {
  return ORDER_SIDES.has(value as string);
}

function isPositionSide(value: unknown): value is "LONG" | "SHORT" | "FLAT" {
  return POSITION_SIDES.has(value as string);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Narrow the engine fill vocabulary into what both `bot_trade_fills` and the
 * legacy `trades.status` CHECK accept (N7): PARTIALLY_FILLED → PARTIAL.
 */
function narrowFillStatus(status: LedgerFillStatus): LedgerStatus {
  return status === "PARTIALLY_FILLED" ? "PARTIAL" : "FILLED";
}

export class TradeLedgerService {
  constructor(
    private readonly repository: TradeLedgerRepository = new TradeLedgerRepository()
  ) {}

  /** Dispatch one ledger event. Wired as the processor's ledger handler. */
  async handle(event: BotEvent): Promise<void> {
    switch (event.type) {
      case "ORDER_INTENT":
        await this.onOrderIntent(event);
        break;
      case "TRADE_EXECUTED":
        await this.onTradeExecuted(event);
        break;
      case "POSITION_UPDATED":
        await this.onPositionUpdated(event);
        break;
      case "PERFORMANCE_SNAPSHOT":
        await this.onPerformanceSnapshot(event);
        break;
      default:
        logger.warn("Trade ledger received a non-ledger event", {
          type: event.type,
          messageId: event.messageId,
        });
    }
  }

  private async onOrderIntent(event: BotEvent): Promise<void> {
    if (!isOrderIntentEvent(event)) {
      return this.ignore(event, "malformed ORDER_INTENT payload");
    }
    const payload = event.payload;
    if (
      !isSide(payload.side) ||
      !isNonEmptyString(payload.symbol) ||
      !isPositiveFinite(payload.quantity) ||
      !isNonNegativeFinite(payload.price)
    ) {
      return this.ignore(event, "invalid ORDER_INTENT fields");
    }

    const known = await this.repository.upsertIntent({
      botId: payload.botId,
      clientOrderId: payload.clientOrderId,
      symbol: payload.symbol,
      side: payload.side,
      price: payload.price,
      quantity: payload.quantity,
    });
    if (!known) {
      logger.warn("Order intent for unknown bot - ignored", {
        botId: payload.botId,
        clientOrderId: payload.clientOrderId,
        messageId: event.messageId,
      });
    }
  }

  private async onTradeExecuted(event: BotEvent): Promise<void> {
    if (!isTradeExecutedEvent(event)) {
      return this.ignore(event, "malformed TRADE_EXECUTED payload");
    }
    const payload = event.payload;
    if (
      !isSide(payload.side) ||
      !isNonEmptyString(payload.symbol) ||
      !isNonEmptyString(payload.exchangeOrderId) ||
      !isPositiveFinite(payload.quantity) ||
      !isNonNegativeFinite(payload.price) ||
      !FILL_STATUSES.has(payload.status) ||
      !Number.isFinite(Date.parse(payload.executedAt)) ||
      (payload.fee !== undefined && !isNonNegativeFinite(payload.fee)) ||
      (payload.pnl !== undefined && !isFiniteNumber(payload.pnl))
    ) {
      return this.ignore(event, "invalid TRADE_EXECUTED fields");
    }

    const result = await this.repository.recordFill({
      botId: payload.botId,
      clientOrderId: payload.clientOrderId,
      exchangeOrderId: payload.exchangeOrderId,
      fillId: payload.fillId,
      symbol: payload.symbol,
      side: payload.side,
      quantity: payload.quantity,
      price: payload.price,
      fee: payload.fee ?? 0,
      pnl: payload.pnl ?? 0,
      status: narrowFillStatus(payload.status),
      executedAt: new Date(Date.parse(payload.executedAt)).toISOString(),
    });

    if (result === "DUPLICATE") {
      // Idempotent replay (stream redelivery, G1 re-detection, live gate
      // replay) — exactly what the unique key is for.
      logger.info("Duplicate fill event ignored (idempotent ledger)", {
        botId: payload.botId,
        clientOrderId: payload.clientOrderId,
        fillId: payload.fillId,
        messageId: event.messageId,
      });
    } else if (result === "UNKNOWN_BOT") {
      logger.warn("Fill for unknown bot - ignored", {
        botId: payload.botId,
        clientOrderId: payload.clientOrderId,
        messageId: event.messageId,
      });
    } else {
      logger.info("Fill recorded in ledger", {
        botId: payload.botId,
        clientOrderId: payload.clientOrderId,
        fillId: payload.fillId,
        side: payload.side,
        price: payload.price,
        quantity: payload.quantity,
        pnl: payload.pnl ?? 0,
        messageId: event.messageId,
      });
    }
  }

  private async onPositionUpdated(event: BotEvent): Promise<void> {
    if (!isPositionUpdatedEvent(event)) {
      return this.ignore(event, "malformed POSITION_UPDATED payload");
    }
    const payload = event.payload;
    if (
      !isPositionSide(payload.side) ||
      !isNonEmptyString(payload.symbol) ||
      !isNonNegativeFinite(payload.quantity) ||
      !isNonNegativeFinite(payload.entryPrice) ||
      !isNonNegativeFinite(payload.markPrice) ||
      !isFiniteNumber(payload.pnl)
    ) {
      return this.ignore(event, "invalid POSITION_UPDATED fields");
    }

    const known = await this.repository.upsertPosition({
      botId: payload.botId,
      symbol: payload.symbol,
      side: payload.side,
      quantity: payload.quantity,
      entryPrice: payload.entryPrice,
      markPrice: payload.markPrice,
      pnl: payload.pnl,
    });
    if (!known) {
      logger.warn("Position update for unknown bot - ignored", {
        botId: payload.botId,
        symbol: payload.symbol,
        messageId: event.messageId,
      });
    }
  }

  private async onPerformanceSnapshot(event: BotEvent): Promise<void> {
    if (!isPerformanceSnapshotEvent(event)) {
      return this.ignore(event, "malformed PERFORMANCE_SNAPSHOT payload");
    }
    const payload = event.payload;
    const metrics = payload.metrics;
    if (
      !isNonNegativeFinite(metrics.totalTrades) ||
      !isFiniteNumber(metrics.totalPnl) ||
      (metrics.winRate !== undefined &&
        !isNonNegativeFinite(metrics.winRate)) ||
      (metrics.maxDrawdown !== undefined &&
        !isFiniteNumber(metrics.maxDrawdown)) ||
      (metrics.profitFactor !== undefined &&
        !isFiniteNumber(metrics.profitFactor)) ||
      (metrics.sharpeRatio !== undefined &&
        !isFiniteNumber(metrics.sharpeRatio))
    ) {
      return this.ignore(event, "invalid PERFORMANCE_SNAPSHOT fields");
    }

    const known = await this.repository.upsertPerformance({
      botId: payload.botId,
      totalTrades: metrics.totalTrades,
      totalPnl: metrics.totalPnl,
      winRate: metrics.winRate,
      maxDrawdown: metrics.maxDrawdown,
      profitFactor: metrics.profitFactor,
      sharpeRatio: metrics.sharpeRatio,
    });
    if (!known) {
      logger.warn("Performance snapshot for unknown bot - ignored", {
        botId: payload.botId,
        messageId: event.messageId,
      });
    }
  }

  /**
   * Business-level rejection: log loudly and swallow so the consumer ACKs.
   * A malformed event must not poison the stream.
   */
  private ignore(event: BotEvent, reason: string): void {
    logger.error("Trade ledger event rejected", undefined, {
      reason,
      type: event.type,
      messageId: event.messageId,
      correlationId: event.correlationId,
    });
  }
}

/** Singleton ingest path wired into `BotEventProcessor` at startup. */
export const tradeLedgerService = new TradeLedgerService();
