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
 *   of double-placing. A dying row under the current id hands its remainder
 *   back (`SAFE_TO_RECREATE` + `pendingFill`) and defers the placement a tick
 *   (A3): the segment reaches the ledger and the re-placement gets a fresh id,
 *   instead of the fill being dropped under a row placed over it.
 * - `checkSlot` — verification path for a slot that carries a handle. Uses
 *   `getOrder`, which resolves terminal states (fill/cancel) for both adapters,
 *   and classifies the thrown error into `NOT_FOUND` (safe to recreate) vs
 *   `UNREACHABLE` (freeze) — the fix for N3.
 *
 * `reconcileSymbol` runs once at startup (N4): it lists the venue's open orders,
 * resolves every restored handle, and reports orphans it does not own (never
 * auto-cancels — D4).
 *
 * Phase 4 (partial fills): every observation that carries a venue **cumulative**
 * — a live row (`checkSlot`'s OPEN branch, `FOUND_OPEN`), a terminal row
 * (`FILLED`/`FOUND_FILLED`) or a dying one (`DEAD`/`FOUND_CANCELED`) — is routed
 * through `OrderManager.markBooked`/`markFilled` so the level books only the
 * unbooked delta, and the outcome hands that delta (plus the segment bounds) to
 * the grid. A venue that reports no cumulative changes nothing: `bookRemainder`
 * returns `undefined` and the outcome is byte-identical to pre-Phase-4 (risk
 * D1/A3), so the two adapters degrade independently.
 *
 * @format
 */

import axios, { AxiosError } from "axios";
import {
  ExchangeClient,
  ExchangeOpenOrder,
  OrderLookup,
} from "../domain/exchange";
import {
  SlotOutcome,
  PendingFill,
  StartupReconcileReport,
} from "../domain/order-state";
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
    private manager: OrderManager,
    /** Phase 4 ledger emission; absent in strategy unit tests. */
    private reporter?: TradeReporter
  ) {}

  /**
   * Idempotent slot placement: adopt an already-live order, or place one.
   * Returns the resulting state; the caller only records the trade on FILLED.
   *
   * The pre-submit lookup runs against the slot's **current generation**
   * (`manager.idFor`) — never the previous cycle's spent id — so the venue's
   * terminal history row for that id is unreachable and cannot short-circuit
   * the placement with a phantom `FOUND_FILLED` (G1). Within a cycle the id
   * is stable, which is what still lets a lost create response adopt the live
   * order instead of double-placing.
   *
   * Intent-before-create (Phase 4): right before `createOrder` the intent is
   * published to the ledger. If it cannot be persisted the order is NOT
   * placed — a submission the backend never saw is exactly the orphan the
   * durable ledger exists to prevent (fail-closed, same spirit as D1).
   *
   * `reduceOnly` is forwarded to the adapter on the create request; the grid
   * sets it on exit legs so a stale sell can never open a short (N6). It is the
   * caller's decision — this service never infers it from the side.
   */
  async ensureSlotOrder(
    levelIndex: number,
    side: "BUY" | "SELL",
    price: number,
    quantity: number,
    reduceOnly = false
  ): Promise<SlotOutcome> {
    const clientOrderId = this.manager.idFor(levelIndex, side);
    this.manager.beginSubmit(clientOrderId, levelIndex, side, price, quantity);
    this.manager.markSubmitting(clientOrderId);

    const pre = await this.lookupByClientOrderId(clientOrderId);
    if (pre.kind !== "SAFE_TO_RECREATE") return pre;
    // A dying row under this id leaves a fill the ledger still owes (A3). Do
    // not place over it in the same breath: `markNotFound` already spent the
    // slot's id (the booking proves it carried fills, B1), so handing the
    // segment back and letting the next tick place is both the honest answer
    // and the only one that cannot drop the row.
    if (pre.pendingFill) return pre;

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
        reduceOnly,
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
      if (
        recovered.kind === "OPEN" ||
        recovered.kind === "FILLED" ||
        recovered.kind === "PARTIALLY_FILLED"
      ) {
        logger.warn("Reconciled slot order after a submission error", {
          side,
          price,
          botId: this.botId,
          symbol: this.symbol,
        });
        return recovered;
      }
      // A dying row's remainder was booked during that lookup (A3): report it
      // rather than a bare failure. The handle is already cleared and the id
      // spent, so the slot re-arms on the next tick — the alternative returns
      // UNAVAILABLE and drops the segment from the ledger for good.
      if (recovered.kind === "SAFE_TO_RECREATE" && recovered.pendingFill) {
        logger.warn("Booked a dead order's remainder after a submit error", {
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
   *
   * Phase 4: the three branches all carry a venue **cumulative** now, and all
   * three book through the manager before returning, so no fill that the venue
   * admits to is ever dropped from the position:
   * - executed: `markFilled` books the remainder (after any partial segment,
   *   risk A2) and always spends the slot's id (G1);
   * - still live with executions: `markBooked` books the new segment and the
   *   outcome is `PARTIALLY_FILLED` — the order stays on the slot (risk B1:
   *   the id is not spent, the option value of the resting order is);
   * - dead (canceled/rejected/expired): a fill can land between the last poll
   *   and the cancel (risk A3), so its executions are booked as a `pendingFill`
   *   **before** `markNotFound` decides whether to spend the id (B1).
   *
   * The handle the observation was answered under (`record.orderId`) is the one
   * every outcome — and therefore every ledger row it produces — carries, even
   * where the venue's own `order_id` mutates across fills (risk B2).
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
      const delta = this.manager.markFilled(
        clientOrderId,
        orderId,
        order.executedQuantity
      );
      return {
        kind: "FILLED",
        orderId,
        filledQty: order.executedQuantity,
        // A2: the ledger books the remainder this observation added, never the
        // whole cumulative (`filledQty`) — a prior PARTIALLY_FILLED row already
        // booked its share of the same order.
        delta: delta ?? 0,
        executedPrice: order.executedPrice,
        clientOrderId,
      };
    }
    if (DEAD_STATUSES.has(status)) {
      // A3: the venue admits to executions on the dying row — book them before
      // the handle is cleared, so a fill landing between the last poll and the
      // cancel reaches both the ledger and the position.
      const pendingFill = this.bookRemainder(
        clientOrderId,
        record.orderId,
        order.executedQuantity,
        order.executedPrice
      );
      this.manager.markNotFound(clientOrderId);
      return pendingFill
        ? { kind: "SAFE_TO_RECREATE", pendingFill }
        : { kind: "SAFE_TO_RECREATE" };
    }
    // OPEN / PARTIALLY_FILLED / anything still live: the handle we queried with
    // is authoritative — keep it stable rather than adopting the row's id.
    const partial = this.bookRemainder(
      clientOrderId,
      record.orderId,
      order.executedQuantity,
      order.executedPrice
    );
    this.manager.markOpen(clientOrderId, record.orderId);
    if (partial) {
      return {
        kind: "PARTIALLY_FILLED",
        orderId: record.orderId,
        cumQty: partial.cumQty,
        delta: partial.delta,
        executedPrice: partial.executedPrice,
        clientOrderId,
      };
    }
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
      // A partially executed but still-live slot is an adopted slot — counting
      // it only as `filled` would report it as terminated and hide a live order
      // from the operator (its segment is reported separately by the grid).
      if (outcome.kind === "OPEN" || outcome.kind === "PARTIALLY_FILLED") {
        adopted += 1;
      } else if (outcome.kind === "FILLED") filled += 1;
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

  /**
   * `queryOrderByClientOrderId` → machine, writing through the manager.
   *
   * Phase 4: this lookup is also an *observation*. A partially executed row
   * (`FOUND_OPEN`) books its unbooked cumulative exactly like the live
   * `checkSlot` branch — a fill can land between a placement attempt and the
   * pre-submit lookup that adopts it, and that fill must not be lost just
   * because the placement never returned. `FOUND_FILLED` prefers the venue's
   * cumulative over the row's *size* (they differ on a partly-filled order that
   * has since completed, A2), and `FOUND_CANCELED` books a dying row's
   * remainder as a `pendingFill` before the id is spent (A3/B1).
   *
   * `FOUND_CANCELED` and `NOT_FOUND` stay a single arm only in what they do to
   * the slot: both clear it. They differ in what the venue told us.
   */
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
      case "FOUND_OPEN": {
        const handle = lookup.order.orderId;
        this.manager.markOpen(clientOrderId, handle);
        const partial = this.bookRemainder(
          clientOrderId,
          handle,
          lookup.order.executedQuantity,
          lookup.order.price
        );
        if (!partial) return { kind: "OPEN", orderId: handle };
        return {
          kind: "PARTIALLY_FILLED",
          orderId: handle,
          cumQty: partial.cumQty,
          delta: partial.delta,
          executedPrice: partial.executedPrice,
          clientOrderId,
        };
      }
      case "FOUND_FILLED": {
        // The venue's cumulative wins over the row's size: on a partly filled
        // order that has since completed they agree for Lighter's listing
        // (`initial_base_amount`) but not for a tape that only carries the
        // remaining size. Never `record.quantity` — a restored record is zeroed
        // by `adopt`, so it can neither over- nor under-book the segment.
        const cum = lookup.order.executedQuantity ?? lookup.order.quantity;
        const delta = this.manager.markFilled(
          clientOrderId,
          lookup.order.orderId,
          cum
        );
        return {
          kind: "FILLED",
          orderId: lookup.order.orderId,
          filledQty: cum,
          delta: delta ?? 0,
          // The row's price is the order's limit price — the honest executed
          // price for a resting maker fill, and the only one the listing
          // carries (see `SlotOutcome.FILLED.executedPrice`).
          executedPrice: lookup.order.price,
          clientOrderId,
        };
      }
      case "FOUND_CANCELED": {
        const pendingFill = this.bookRemainder(
          clientOrderId,
          lookup.order.orderId,
          lookup.order.executedQuantity,
          lookup.order.price
        );
        this.manager.markNotFound(clientOrderId);
        return pendingFill
          ? { kind: "SAFE_TO_RECREATE", pendingFill }
          : { kind: "SAFE_TO_RECREATE" };
      }
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
   * Book whatever a live-or-dying observation admits to (Phase 4).
   *
   * Returns the segment the caller must emit, or `undefined` when there is
   * nothing to book:
   * - the venue reported no cumulative at all (risk D1 — an adapter whose tape
   *   carries no filled quantity): never guess, exactly the pre-Phase-4
   *   behavior;
   * - everything the venue reports is already booked, which `markBooked`
   *   answers with `null` (and which also covers a *backwards* cumulative and a
   *   non-finite one — risk A5: a cumulative only grows, and a smaller value is
   *   an anomaly to warn about, never a negative booking).
   *
   * The manager has already applied the delta to the level, so the caller only
   * has to hand the numbers to the grid. `orderId` is the handle we observed
   * under, never the row's own id (risk B2).
   */
  private bookRemainder(
    clientOrderId: string,
    orderId: string | undefined,
    cumQty: number | undefined,
    executedPrice: number | undefined
  ): PendingFill | undefined {
    if (cumQty === undefined) return undefined;
    const delta = this.manager.markBooked(clientOrderId, cumQty);
    if (delta === null) return undefined;
    return { cumQty, delta, executedPrice, clientOrderId, orderId };
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
