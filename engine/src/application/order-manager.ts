/**
 * Order Manager (Phase 2, extended in Phase 4).
 *
 * Owns the local order records for one bot's grid (`clientOrderId → OrderRecord`)
 * and is the **only** writer of slot identity and quantity state. The
 * reconciliation service decides *what* the state is; this class records it and
 * projects the handle / filled flag / held quantity back onto the `GridLevel`
 * the snapshot persists.
 *
 * Phase 4 (partial fills): the projection is no longer boolean-only. Each level
 * carries `heldQty` — the long quantity actually booked (BOOKED buy segments
 * minus booked sell segments) — and `filled` is derived from it as
 * `heldQty ≥ orderQuantity − ε`. Every booking is a **delta** against the
 * record's instance cumulative (`record.filledQty`), so a partially-filled
 * order books each observed segment exactly once, across polls and across
 * restarts (risks A2/A4: never the whole order again, never twice).
 *
 * The projection is what keeps the rest of the strategy (and the snapshot
 * format) unchanged: the tick still asks "does this level have a live order?"
 * via `level.buyOrderId` / `level.sellOrderId`, but nothing but this class ever
 * writes those fields.
 *
 * @format
 */

import { GridLevel } from "../types/strategy";
import { ClientOrderIdGenerator } from "../utils/client-order-id";
import { OrderRecord } from "../domain/order-state";
import { logger } from "../utils/logger";

function now(): string {
  return new Date().toISOString();
}

/**
 * Quantity tolerance (Phase 4): "is this delta new fill", "is the level
 * fully long" and the monotonic-cumulative guard all treat differences ≤ ε
 * as no difference — comfortably above float noise on 8-dp quantities, far
 * below any venue's minimum size step (a real fill can never hide inside it).
 */
export const QTY_EPSILON = 1e-8;

export class OrderManager {
  private records = new Map<string, OrderRecord>();
  /** `${levelIndex}:${side}` → clientOrderId, so a slot resolves to its record. */
  private bySlot = new Map<string, string>();

  constructor(
    private levels: GridLevel[],
    private ids: ClientOrderIdGenerator,
    /**
     * Configured size of one slot's order — the quantity a level holds when
     * fully long, and the target every `filled` projection compares against
     * (`record.quantity` is unusable for this: `adopt` zeroes it, and a
     * remainder order submits less than the slot target).
     */
    private orderQuantity: number
  ) {
    if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) {
      throw new Error(
        `OrderManager requires a positive orderQuantity (got ${orderQuantity})`
      );
    }
    this.seedFromLevels();
  }

  private slotKey(levelIndex: number, side: "BUY" | "SELL"): string {
    return `${levelIndex}:${side}`;
  }

  /**
   * Bring a restored grid under management: a level that carries a handle in
   * the snapshot becomes an `UNKNOWN` record, resolved by the startup
   * reconciliation pass (we do not yet know whether it is still live).
   *
   * Phase 4 seeding (risk A4/E3):
   * - `heldQty` is the authoritative quantity. A legacy snapshot (or a test
   *   fixture) that only carries the boolean seeds it from `filled`, so a
   *   restored long is never forgotten; when both are present `filled` is
   *   recomputed so the two can never disagree.
   * - A resting side's instance cumulative comes from `buyFilledQty`/
   *   `sellFilledQty` and lands in `record.filledQty`, so re-observing the
   *   venue's cumulative books only the delta instead of double-applying it
   *   to `heldQty` (the ledger would dedup the row, but the level would not).
   */
  private seedFromLevels(): void {
    this.levels.forEach((level, levelIndex) => {
      if (level.heldQty === undefined) {
        if (level.filled) level.heldQty = this.orderQuantity;
      } else {
        level.filled = this.isFullyLong(level.heldQty);
      }
      if (level.buyOrderId) {
        this.adopt(
          levelIndex,
          "BUY",
          level.price,
          level.buyOrderId,
          level.buyFilledQty ?? 0
        );
      }
      if (level.sellOrderId) {
        this.adopt(
          levelIndex,
          "SELL",
          level.price,
          level.sellOrderId,
          level.sellFilledQty ?? 0
        );
      }
    });
  }

  private adopt(
    levelIndex: number,
    side: "BUY" | "SELL",
    price: number,
    orderId: string,
    bookedQty: number
  ): void {
    const clientOrderId = this.idFor(levelIndex, side);
    this.write({
      clientOrderId,
      levelIndex,
      side,
      price,
      quantity: 0,
      filledQty: bookedQty,
      orderId,
      state: "UNKNOWN",
      updatedAt: now(),
    });
  }

  /** Level is fully long: the projection behind the boolean `filled`. */
  private isFullyLong(heldQty: number): boolean {
    return heldQty >= this.orderQuantity - QTY_EPSILON;
  }

  /** Held long of a level (absent = nothing booked yet). */
  private heldOf(level: GridLevel): number {
    return level.heldQty ?? 0;
  }

  /**
   * The client order id this slot would submit with right now: the slot's
   * current generation of `(levelIndex, side)`. Generation 0 is the legacy
   * id — it must keep resolving an order already live on the venue.
   */
  idFor(levelIndex: number, side: "BUY" | "SELL"): string {
    const level = this.levels[levelIndex];
    const generation = (side === "BUY" ? level?.buyGen : level?.sellGen) ?? 0;
    return this.ids.generate(levelIndex, side, generation);
  }

  private write(record: OrderRecord): OrderRecord {
    this.records.set(record.clientOrderId, record);
    this.bySlot.set(
      this.slotKey(record.levelIndex, record.side),
      record.clientOrderId
    );
    return record;
  }

  private mutate(
    clientOrderId: string,
    patch: Partial<OrderRecord>
  ): OrderRecord | undefined {
    const record = this.records.get(clientOrderId);
    if (!record) return undefined;
    return this.write({ ...record, ...patch, updatedAt: now() });
  }

  private setHandle(
    levelIndex: number,
    side: "BUY" | "SELL",
    orderId?: string
  ): void {
    const level = this.levels[levelIndex];
    if (!level) return;
    if (side === "BUY") level.buyOrderId = orderId;
    else level.sellOrderId = orderId;
  }

  get(clientOrderId: string): OrderRecord | undefined {
    return this.records.get(clientOrderId);
  }

  getBySlot(levelIndex: number, side: "BUY" | "SELL"): OrderRecord | undefined {
    const key = this.bySlot.get(this.slotKey(levelIndex, side));
    return key ? this.records.get(key) : undefined;
  }

  all(): OrderRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Record the intent to submit a slot order.
   *
   * Phase 4: a new instance starts its cumulative at zero — both on the
   * record and on the level's persisted side field, so a crash before the
   * first booking can never seed the *next* instance with the spent one's
   * cumulative (the instance identity is what fill segments key on, B3).
   */
  beginSubmit(
    clientOrderId: string,
    levelIndex: number,
    side: "BUY" | "SELL",
    price: number,
    quantity: number
  ): OrderRecord {
    const record = this.write({
      clientOrderId,
      levelIndex,
      side,
      price,
      quantity,
      filledQty: 0,
      state: "INTENDED",
      updatedAt: now(),
    });
    const level = this.levels[levelIndex];
    if (level) {
      if (side === "BUY") level.buyFilledQty = 0;
      else level.sellFilledQty = 0;
    }
    return record;
  }

  markSubmitting(clientOrderId: string): void {
    this.mutate(clientOrderId, { state: "SUBMITTING" });
  }

  /** Confirmed live: record the handle and project it onto the level. */
  markOpen(clientOrderId: string, orderId: string): void {
    const record = this.mutate(clientOrderId, {
      state: "OPEN",
      orderId,
      reason: undefined,
    });
    if (record) this.setHandle(record.levelIndex, record.side, orderId);
  }

  /**
   * Terminal execution: book the venue's cumulative, clear the handle and
   * spend the slot's id — the generation for this side bumps so the next
   * cycle derives a fresh client order id (G1: a pre-submit lookup must
   * never find the venue's terminal history row for an id whose fill is
   * already booked; that row booked phantom fills and blocked re-placement).
   *
   * Phase 4 (A2): the booking is **delta-only** — the level's held quantity
   * moves by `cum − filledQty`, never by the whole order, so an order that
   * already booked partial segments books only its remainder here. Returns
   * that delta for the caller to emit into the ledger, or `null` when the
   * observation added nothing (a re-detection of an already-booked fill —
   * the ledger's idempotency already collapsed it, and the level must not
   * move either).
   *
   * `cumQty === undefined` means the venue reported no cumulative on the
   * terminal row: assume the slot's own submitted quantity (the record's —
   * a remainder order's — falling back to the configured size for an
   * adopted record whose quantity is zero). That is exactly the legacy
   * whole-fill semantics, and never less than what is already booked (A5's
   * monotonic guard: a cumulative can go forwards, never backwards).
   */
  markFilled(
    clientOrderId: string,
    orderId?: string,
    cumQty?: number
  ): number | null {
    const existing = this.records.get(clientOrderId);
    if (!existing) return null;
    const assumed =
      existing.quantity > 0 ? existing.quantity : this.orderQuantity;
    const cum =
      cumQty === undefined
        ? Math.max(existing.filledQty, assumed)
        : Math.max(cumQty, existing.filledQty);
    const delta = cum - existing.filledQty;
    const record = this.write({
      ...existing,
      state: "FILLED",
      orderId: orderId ?? existing.orderId,
      filledQty: cum,
      reason: undefined,
      updatedAt: now(),
    });
    this.setHandle(record.levelIndex, record.side, undefined);
    if (delta > QTY_EPSILON) this.projectFill(record, delta);
    const level = this.levels[record.levelIndex];
    if (level) {
      // Always spend the id — even when the delta added nothing — so a
      // terminal row is never re-queried (G1), regardless of how it booked.
      if (record.side === "BUY") {
        level.buyGen = (level.buyGen ?? 0) + 1;
      } else {
        level.sellGen = (level.sellGen ?? 0) + 1;
      }
    }
    return delta > QTY_EPSILON ? delta : null;
  }

  /**
   * Observe a venue cumulative on a still-live order (Phase 4). Books the
   * delta into the record and the level's quantity projection and returns
   * it; returns `null` when the observation adds nothing.
   *
   * `null` covers both benign cases — unchanged cumulative (the normal
   * poll) and a cumulative already booked — and the hostile one: a
   * *regression* (risk A5). A cumulative can only grow, so a smaller value
   * is a venue/tape anomaly: warn and skip, never book negative.
   */
  markBooked(clientOrderId: string, cumQty: number): number | null {
    const existing = this.records.get(clientOrderId);
    if (!existing) return null;
    if (!Number.isFinite(cumQty) || cumQty < 0) {
      logger.warn("Ignoring invalid venue cumulative", {
        clientOrderId,
        cumQty,
        booked: existing.filledQty,
      });
      return null;
    }
    const delta = cumQty - existing.filledQty;
    if (delta <= QTY_EPSILON) {
      if (cumQty < existing.filledQty - QTY_EPSILON) {
        logger.warn("Venue cumulative went backwards - ignoring", {
          clientOrderId,
          booked: existing.filledQty,
          cumQty,
        });
      }
      return null;
    }
    const record = this.write({
      ...existing,
      filledQty: cumQty,
      updatedAt: now(),
    });
    this.projectFill(record, delta);
    return delta;
  }

  /**
   * Apply a booked delta to the level's quantity projection (Phase 4): the
   * held long moves with the side, the resting instance's cumulative is
   * persisted beside it for restart seeding (A4), and `filled` is
   * recomputed as the projection `held ≥ orderQuantity − ε`.
   *
   * Clamps (C5) — never silently overshoot:
   * - a SELL can never push `held` below 0 (floor + warn: the venue closed
   *   more than this level modeled — the N6 cross-check owns reporting
   *   venue truth);
   * - a BUY is capped at the slot's size (a level holds at most one slot's
   *   long; more means model drift, warn loudly rather than let the arming
   *   rules run on an impossible quantity).
   */
  private projectFill(record: OrderRecord, delta: number): void {
    const level = this.levels[record.levelIndex];
    if (!level) return;
    const isBuy = record.side === "BUY";
    const before = this.heldOf(level);
    let held = isBuy ? before + delta : before - delta;
    if (isBuy) {
      if (held > this.orderQuantity + QTY_EPSILON) {
        logger.warn("BUY fill exceeds the slot size - capping held quantity", {
          clientOrderId: record.clientOrderId,
          levelIndex: record.levelIndex,
          heldBefore: before,
          delta,
          orderQuantity: this.orderQuantity,
        });
        held = this.orderQuantity;
      }
    } else if (held < 0) {
      logger.warn("SELL fill exceeds held quantity - flooring to zero", {
        clientOrderId: record.clientOrderId,
        levelIndex: record.levelIndex,
        heldBefore: before,
        delta,
      });
      held = 0;
    }
    level.heldQty = held;
    if (isBuy) level.buyFilledQty = record.filledQty;
    else level.sellFilledQty = record.filledQty;
    level.filled = this.isFullyLong(held);
  }

  /**
   * Definitively absent: clear the handle so the slot is safe to recreate.
   *
   * Phase 4 (risk B1): an instance that **booked** partial fills owns
   * cumulative-qty segment rows under this client id. Bumping the side's
   * generation here gives the re-placement a fresh id whose segments can
   * never collide with the spent instance's rows — two instances sharing
   * one id could mint identical segment bounds and the ledger would
   * silently drop the second fill. An instance that never booked anything
   * keeps its id: the proven vanish → re-place path (Gate 1-C) stays
   * byte-identical. (`markFilled` always bumps, booked or not — G1.)
   */
  markNotFound(clientOrderId: string): void {
    const existing = this.records.get(clientOrderId);
    if (!existing) return;
    const booked = existing.filledQty;
    const record = this.write({
      ...existing,
      state: "NOT_FOUND",
      orderId: undefined,
      updatedAt: now(),
    });
    this.setHandle(record.levelIndex, record.side, undefined);
    if (booked > QTY_EPSILON) {
      const level = this.levels[record.levelIndex];
      if (level) {
        if (record.side === "BUY") {
          level.buyGen = (level.buyGen ?? 0) + 1;
        } else {
          level.sellGen = (level.sellGen ?? 0) + 1;
        }
      }
    }
  }

  /**
   * Could not reach the exchange: freeze. The handle is left untouched so a
   * later pass can resolve it — we must never treat "unknown" as "absent".
   */
  markUnavailable(clientOrderId: string, reason: string): void {
    this.mutate(clientOrderId, { state: "EXCHANGE_UNAVAILABLE", reason });
  }
}
