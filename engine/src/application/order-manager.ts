/**
 * Order Manager (Phase 2).
 *
 * Owns the local order records for one bot's grid (`clientOrderId → OrderRecord`)
 * and is the **only** writer of slot identity. The reconciliation service decides
 * *what* the state is; this class records it and projects the handle / filled
 * flag back onto the `GridLevel` the snapshot persists.
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

function now(): string {
  return new Date().toISOString();
}

export class OrderManager {
  private records = new Map<string, OrderRecord>();
  /** `${levelIndex}:${side}` → clientOrderId, so a slot resolves to its record. */
  private bySlot = new Map<string, string>();

  constructor(
    private levels: GridLevel[],
    private ids: ClientOrderIdGenerator
  ) {
    this.seedFromLevels();
  }

  private slotKey(levelIndex: number, side: "BUY" | "SELL"): string {
    return `${levelIndex}:${side}`;
  }

  /**
   * Bring a restored grid under management: a level that carries a handle in
   * the snapshot becomes an `UNKNOWN` record, resolved by the startup
   * reconciliation pass (we do not yet know whether it is still live).
   */
  private seedFromLevels(): void {
    this.levels.forEach((level, levelIndex) => {
      if (level.buyOrderId) {
        this.adopt(levelIndex, "BUY", level.price, level.buyOrderId);
      }
      if (level.sellOrderId) {
        this.adopt(levelIndex, "SELL", level.price, level.sellOrderId);
      }
    });
  }

  private adopt(
    levelIndex: number,
    side: "BUY" | "SELL",
    price: number,
    orderId: string
  ): void {
    const clientOrderId = this.ids.generate(levelIndex, side);
    this.write({
      clientOrderId,
      levelIndex,
      side,
      price,
      quantity: 0,
      filledQty: 0,
      orderId,
      state: "UNKNOWN",
      updatedAt: now(),
    });
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

  /** Record the intent to submit a slot order. */
  beginSubmit(
    clientOrderId: string,
    levelIndex: number,
    side: "BUY" | "SELL",
    price: number,
    quantity: number
  ): OrderRecord {
    return this.write({
      clientOrderId,
      levelIndex,
      side,
      price,
      quantity,
      filledQty: 0,
      state: "INTENDED",
      updatedAt: now(),
    });
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
   * Executed: clear the handle, and flip the level's `filled` flag to the side
   * that closes the trade (a filled BUY arms the sell, a filled SELL re-arms
   * the buy).
   */
  markFilled(
    clientOrderId: string,
    orderId?: string,
    filledQty?: number
  ): void {
    const existing = this.records.get(clientOrderId);
    if (!existing) return;
    const record = this.write({
      ...existing,
      state: "FILLED",
      orderId: orderId ?? existing.orderId,
      filledQty: filledQty ?? existing.quantity,
      reason: undefined,
      updatedAt: now(),
    });
    this.setHandle(record.levelIndex, record.side, undefined);
    const level = this.levels[record.levelIndex];
    if (level) level.filled = record.side === "BUY";
  }

  /** Definitively absent: clear the handle so the slot is safe to recreate. */
  markNotFound(clientOrderId: string): void {
    const record = this.mutate(clientOrderId, {
      state: "NOT_FOUND",
      orderId: undefined,
    });
    if (record) this.setHandle(record.levelIndex, record.side, undefined);
  }

  /**
   * Could not reach the exchange: freeze. The handle is left untouched so a
   * later pass can resolve it — we must never treat "unknown" as "absent".
   */
  markUnavailable(clientOrderId: string, reason: string): void {
    this.mutate(clientOrderId, { state: "EXCHANGE_UNAVAILABLE", reason });
  }
}
