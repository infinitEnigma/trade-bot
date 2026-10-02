/**
 * Order Reconciliation Service (Phase 2).
 *
 * The single place where exchange↔local failure semantics live. It maps the
 * `ExchangeClient` contract onto the explicit `OrderState` machine and writes
 * only through `OrderManager`. Two entry points, because the two situations
 * have different authority:
 *
 * - `ensureSlotOrder` — placement path. Uses `queryOrderByClientOrderId`
 *   (get-before-create) so a lost create response adopts the live order instead
 *   of double-placing.
 * - `checkSlot` — verification path for a slot that carries a handle. Uses
 *   `getOrder`, which resolves terminal states (fill/cancel) for both adapters,
 *   and classifies the thrown error into `NOT_FOUND` (safe to recreate) vs
 *   `UNREACHABLE` (freeze) — the fix for N3.
 *
 * `reconcileSymbol` runs once at startup (N4): it lists the venue's open orders,
 * resolves every restored handle, and reports orphans it does not own (never
 * auto-cancels — D4).
 *
 * @format
 */

import axios, { AxiosError } from "axios";
import {
  ExchangeClient,
  ExchangeOpenOrder,
  OrderLookup,
} from "../domain/exchange";
import { SlotOutcome, StartupReconcileReport } from "../domain/order-state";
import { ClientOrderIdGenerator } from "../utils/client-order-id";
import { CommandError } from "./command-error";
import { TradeReporter } from "./trade-reporter";
import { OrderManager } from "./order-manager";
import { logger } from "../utils/logger";

/** Venue status vocabulary → the machine. Covers Orderly and Lighter. */
const FILLED_STATUSES = new Set(["FILLED", "FULLY_FILLED", "COMPLETED"]);
const DEAD_STATUSES = new Set(["CANCELLED", "CANCELED", "REJECTED", "EXPIRED"]);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OrderReconciliationService {
  constructor(
    private botId: string,
    private exchange: ExchangeClient,
    private symbol: string,
    private ids: ClientOrderIdGenerator,
    private manager: OrderManager,
    /** Phase 4 ledger emission; absent in strategy unit tests. */
    private reporter?: TradeReporter
  ) {}

  /**
   * Idempotent slot placement: adopt an already-live order, or place one.
   * Returns the resulting state; the caller only records the trade on FILLED.
   *
   * Intent-before-create (Phase 4): right before `createOrder` the intent is
   * published to the ledger. If it cannot be persisted the order is NOT
   * placed — a submission the backend never saw is exactly the orphan the
   * durable ledger exists to prevent (fail-closed, same spirit as D1).
   */
  async ensureSlotOrder(
    levelIndex: number,
    side: "BUY" | "SELL",
    price: number,
    quantity: number
  ): Promise<SlotOutcome> {
    const clientOrderId = this.ids.generate(levelIndex, side);
    this.manager.beginSubmit(clientOrderId, levelIndex, side, price, quantity);
    this.manager.markSubmitting(clientOrderId);

    const pre = await this.lookupByClientOrderId(clientOrderId);
    if (pre.kind !== "SAFE_TO_RECREATE") return pre;

    if (this.reporter) {
      const intentPersisted = await this.reporter.reportOrderIntent({
        botId: this.botId,
        symbol: this.symbol,
        side,
        price,
        quantity,
        clientOrderId,
      });
      if (!intentPersisted) {
        this.manager.markUnavailable(
          clientOrderId,
          "order intent not persisted"
        );
        return { kind: "UNAVAILABLE", reason: "order intent not persisted" };
      }
    }

    try {
      const result = await this.exchange.createOrder({
        symbol: this.symbol,
        orderType: "LIMIT",
        side,
        orderPrice: price,
        orderQuantity: quantity,
        clientOrderId,
      });
      this.manager.markOpen(clientOrderId, result.orderId);
      logger.info("Placed order", {
        side,
        price,
        orderId: result.orderId,
        botId: this.botId,
        symbol: this.symbol,
      });
      return { kind: "OPEN", orderId: result.orderId };
    } catch (error) {
      // The exchange may have accepted while the response was lost. Reconcile
      // before giving up so we never double-place the same slot.
      const recovered = await this.lookupByClientOrderId(clientOrderId);
      if (recovered.kind === "OPEN" || recovered.kind === "FILLED") {
        logger.warn("Reconciled slot order after a submission error", {
          side,
          price,
          botId: this.botId,
          symbol: this.symbol,
        });
        return recovered;
      }
      this.manager.markUnavailable(clientOrderId, messageOf(error));
      logger.error("Failed to place order", {
        side,
        price,
        error: messageOf(error),
        botId: this.botId,
        symbol: this.symbol,
      });
      return { kind: "UNAVAILABLE", reason: messageOf(error) };
    }
  }

  /**
   * Verify a slot that carries a handle. Resolves fill/cancel; a gone order
   * clears the slot (SAFE_TO_RECREATE), an unreachable exchange freezes it.
   */
  async checkSlot(
    levelIndex: number,
    side: "BUY" | "SELL"
  ): Promise<SlotOutcome> {
    const record = this.manager.getBySlot(levelIndex, side);
    if (!record?.orderId) return { kind: "SAFE_TO_RECREATE" };

    const clientOrderId = record.clientOrderId;
    let order;
    try {
      order = await this.exchange.getOrder(record.orderId);
    } catch (error) {
      return this.classifyHandleError(clientOrderId, error);
    }

    const status = String(order.status ?? "").toUpperCase();
    const orderId = order.orderId ?? record.orderId;
    if (FILLED_STATUSES.has(status)) {
      this.manager.markFilled(clientOrderId, orderId, order.executedQuantity);
      return { kind: "FILLED", orderId, filledQty: order.executedQuantity };
    }
    if (DEAD_STATUSES.has(status)) {
      this.manager.markNotFound(clientOrderId);
      return { kind: "SAFE_TO_RECREATE" };
    }
    // OPEN / PARTIALLY_FILLED / anything still live: the handle we queried with
    // is authoritative — keep it stable rather than adopting the row's id.
    this.manager.markOpen(clientOrderId, record.orderId);
    return { kind: "OPEN", orderId: record.orderId };
  }

  /**
   * Startup reconciliation: resolve every restored handle against the venue and
   * report live orders the grid does not own. A failed listing is reported as
   * unreachable so the caller can fail closed.
   */
  async reconcileSymbol(): Promise<StartupReconcileReport> {
    let open: ExchangeOpenOrder[];
    try {
      open = await this.exchange.listOpenOrders(this.symbol);
    } catch (error) {
      return {
        reachable: false,
        reason: messageOf(error),
        adopted: 0,
        filled: 0,
        orphans: [],
      };
    }

    let adopted = 0;
    let filled = 0;
    for (const record of this.manager.all()) {
      if (!record.orderId) continue;
      const outcome = await this.checkSlot(record.levelIndex, record.side);
      if (outcome.kind === "OPEN") adopted += 1;
      else if (outcome.kind === "FILLED") filled += 1;
    }

    const known = new Set(
      this.manager
        .all()
        .map(record => record.orderId)
        .filter((id): id is string => Boolean(id))
    );
    const orphans = open.filter(order => !known.has(order.orderId));
    return { reachable: true, adopted, filled, orphans };
  }

  /** `queryOrderByClientOrderId` → machine, writing through the manager. */
  private async lookupByClientOrderId(
    clientOrderId: string
  ): Promise<SlotOutcome> {
    let lookup: OrderLookup;
    try {
      lookup = await this.exchange.queryOrderByClientOrderId(
        this.symbol,
        clientOrderId
      );
    } catch (error) {
      this.manager.markUnavailable(clientOrderId, messageOf(error));
      return { kind: "UNAVAILABLE", reason: messageOf(error) };
    }

    switch (lookup.kind) {
      case "FOUND_OPEN":
        this.manager.markOpen(clientOrderId, lookup.order.orderId);
        return { kind: "OPEN", orderId: lookup.order.orderId };
      case "FOUND_FILLED":
        this.manager.markFilled(
          clientOrderId,
          lookup.order.orderId,
          lookup.order.quantity
        );
        return {
          kind: "FILLED",
          orderId: lookup.order.orderId,
          filledQty: lookup.order.quantity,
        };
      case "FOUND_CANCELED":
      case "NOT_FOUND":
        this.manager.markNotFound(clientOrderId);
        return { kind: "SAFE_TO_RECREATE" };
      case "UNREACHABLE":
        this.manager.markUnavailable(clientOrderId, lookup.reason);
        return { kind: "UNAVAILABLE", reason: lookup.reason };
      default:
        this.manager.markUnavailable(clientOrderId, "unknown lookup result");
        return { kind: "UNAVAILABLE", reason: "unknown lookup result" };
    }
  }

  /**
   * Classify a thrown `getOrder` failure. Relying on the shared error
   * conventions both adapters already follow keeps this adapter-agnostic:
   * `CommandError(retryable=false)` and an HTTP 404 mean the order is gone.
   */
  private classifyHandleError(
    clientOrderId: string,
    error: unknown
  ): SlotOutcome {
    if (error instanceof CommandError) {
      if (error.retryable) {
        this.manager.markUnavailable(clientOrderId, error.message);
        return { kind: "UNAVAILABLE", reason: error.message };
      }
      this.manager.markNotFound(clientOrderId);
      return { kind: "SAFE_TO_RECREATE" };
    }
    if (axios.isAxiosError(error)) {
      const status = (error as AxiosError).response?.status;
      if (status === 404) {
        this.manager.markNotFound(clientOrderId);
        return { kind: "SAFE_TO_RECREATE" };
      }
    }
    this.manager.markUnavailable(clientOrderId, messageOf(error));
    return { kind: "UNAVAILABLE", reason: messageOf(error) };
  }
}
