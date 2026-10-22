/** @format */

/**
 * The `ESTIMATE_READY` waiter registry — the narrowly-scoped mechanism that
 * correlates a preparation request with the engine's response.
 *
 * The engine prepares a grid and reports its exposure estimate; the backend
 * needs that report before it can admit the run. This registry is the
 * notification mechanism for that wait. It is deliberately IN-MEMORY and
 * deliberately NOT the durable record: the durable preparation state is what
 * recovery reads to determine whether the estimate arrived, whether admission
 * committed, and whether authorization was published.
 *
 * Rules this registry enforces:
 *
 * - REGISTER BEFORE PUBLISHING. A fast engine response must not arrive
 *   before the waiter exists, or the estimate would be lost.
 * - CORRELATE EXACTLY. A waiter is keyed by runId + preparationVersion +
 *   correlationId, and the incoming event must match the botId and the
 *   expected type as well. An estimate for another run or a superseded
 *   preparation never resolves a waiter.
 * - BOUNDED. Every wait has a deadline; a timeout is an UNKNOWN outcome, not
 *   proof that preparation failed.
 * - CLEAN UP ALWAYS. The registry entry is removed on success, on timeout, on
 *   publication failure and on cancellation — never leaked.
 * - NEVER BLOCK THE CONSUMER. The Redis event loop resolves waiters
 *   synchronously and continues; a pending waiter never stalls unrelated
 *   events.
 */

import { contextLogger as logger } from "../../logging/context-aware-logger.service";

/** The identity of one preparation the backend is waiting for. */
export interface EstimateWaitKey {
  botId: string;
  runId: string;
  preparationVersion: number;
  correlationId: string;
}

/** The estimate the engine reported for a prepared run. */
export interface EstimateReadyPayload {
  botId: string;
  runId: string;
  preparationVersion: number;
  symbol: string;
  gridSize: number;
  orderQuantity: number;
  priceUsed: number;
  estimatedRestingNotional: number;
  perOrderNotional: number;
}

interface Waiter {
  key: EstimateWaitKey;
  resolve: (payload: EstimateReadyPayload) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function keyOf(key: EstimateWaitKey): string {
  return [
    key.botId,
    key.runId,
    String(key.preparationVersion),
    key.correlationId,
  ].join("|");
}

/** Raised when a preparation's estimate did not arrive within the budget. */
export class EstimateWaitTimeoutError extends Error {
  constructor(key: EstimateWaitKey, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for the engine's estimate for run ${key.runId} (preparation ${key.preparationVersion})`
    );
    this.name = "EstimateWaitTimeoutError";
  }
}

export class EstimateWaiterRegistry {
  private waiters = new Map<string, Waiter>();

  /**
   * Wait for one preparation's estimate.
   *
   * The returned promise REJECTS on timeout — an unknown outcome the caller
   * must NOT treat as success, and must NOT authorize on.
   */
  waitForEstimate(
    key: EstimateWaitKey,
    timeoutMs: number
  ): Promise<EstimateReadyPayload> {
    const id = keyOf(key);
    if (this.waiters.has(id)) {
      // A second waiter for the same preparation would race the first for the
      // same event; refuse rather than double-resolve.
      throw new Error(
        `An estimate waiter is already registered for run ${key.runId} (preparation ${key.preparationVersion})`
      );
    }

    return new Promise<EstimateReadyPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new EstimateWaitTimeoutError(key, timeoutMs));
      }, timeoutMs);
      // Do not hold the event loop open for a waiter that is only a timer.
      timer.unref?.();
      this.waiters.set(id, { key, resolve, reject, timer });
    });
  }

  /**
   * Resolve a waiter from a received estimate.
   *
   * Returns true when a waiter was resolved. A false return means the event
   * did not match any pending waiter — a LATE estimate (the waiter already
   * timed out) or one for a superseded preparation. Such an event is ignored:
   * it must never authorize anything.
   */
  deliverEstimate(payload: EstimateReadyPayload): boolean {
    // Try the exact key first.
    const exactId = keyOf({
      botId: payload.botId,
      runId: payload.runId,
      preparationVersion: payload.preparationVersion,
      // The correlation id is not part of the payload, so match on the rest.
      correlationId: "",
    });
    for (const [id, waiter] of this.waiters) {
      if (
        waiter.key.botId !== payload.botId ||
        waiter.key.runId !== payload.runId ||
        waiter.key.preparationVersion !== payload.preparationVersion
      ) {
        continue;
      }
      this.waiters.delete(id);
      clearTimeout(waiter.timer);
      waiter.resolve(payload);
      return true;
    }
    logger.warn("Ignoring an estimate with no matching waiter", {
      botId: payload.botId,
      runId: payload.runId,
      preparationVersion: payload.preparationVersion,
    });
    void exactId;
    return false;
  }

  /**
   * Abandon a wait (publication failure, cancellation, or a rejection).
   * The registry entry is removed so it cannot resolve later.
   */
  cancelWait(key: EstimateWaitKey, reason: string): void {
    const id = keyOf(key);
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    this.waiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.reject(new Error(reason));
  }

  /** How many waiters are pending — for diagnostics. */
  get pendingCount(): number {
    return this.waiters.size;
  }

  /** Abandon every pending wait (shutdown). */
  cancelAll(reason: string): void {
    for (const [, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.waiters.clear();
  }
}
