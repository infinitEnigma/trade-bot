/** @format */

/**
 * Grid stop-loss — a persisted risk state machine (not a tick `if`).
 *
 * Product decision (v1, Model A): one **aggregate** stop per grid run, keyed by
 * `(botId, runId, symbol)`. `stopLossPercent` is the maximum adverse move from a
 * REFERENCE price, in percent, before the machine trips into a risk-off
 * sequence that freezes new entries, cancels resting entry BUYs, and exits this
 * grid's *confirmed* inventory with reduce-only sells sized to real `heldQty`.
 *
 * Deliberately **pure**: it owns phase transitions, trip math, and the
 * reference/CLEARED policy, but performs **no exchange I/O**. The grid strategy
 * drives it each tick and acts on the phase it returns.
 *
 * Posture, inherited from the rest of the engine:
 *   - **confirmed inventory only** — never exit a phantom slot.
 *   - **fail closed** — ambiguous venue state ⇒ HALTED_RESIDUAL, never a clean
 *     "flat" claim.
 *   - **CLEARED is local-confirmed** — `getPositions()` is account × symbol, not
 *     bot-scoped (see `emergencyClosePosition`), so CLEARED gates on *this
 *     grid's* held qty + owned entry orders; the venue read is only a secondary
 *     safety net when the symbol is exclusively ours.
 *   - **sticky once tripped** — a config edit while stopping never re-arms.
 */

/**
 * Stop-loss phase vocabulary. Ordered idle→terminal; `PHASE_ORDER` powers
 * `isActive`/`blocksEntries`, so keep it monotonic.
 */
export const StopPhase = {
  /** `stopLossPercent` unset/disabled — the stop is not watching. */
  INACTIVE: "INACTIVE",
  /** Enabled and monitoring mark vs reference; has not tripped. */
  ARMED: "ARMED",
  /** Trip condition met: entries freeze; begin cancelling resting entry BUYs. */
  TRIPPED: "TRIPPED",
  /** Cancelling open entry-BUY handles; unconfirmed cancels keep us here. */
  CANCELING_ENTRIES: "CANCELING_ENTRIES",
  /** Reduce-only exits of confirmed inventory until verified flat. */
  EXITING: "EXITING",
  /** Could not verify flat / ambiguous residual — fail closed; ops required. */
  HALTED_RESIDUAL: "HALTED_RESIDUAL",
  /** This run's confirmed exposure and owned entry orders are gone. Terminal. */
  CLEARED: "CLEARED",
} as const;

export type StopPhase = (typeof StopPhase)[keyof typeof StopPhase];

/** Numeric ordering; higher ⇒ further along the stop path. CLEARED is last. */
const PHASE_ORDER: Record<StopPhase, number> = {
  [StopPhase.INACTIVE]: 0,
  [StopPhase.ARMED]: 1,
  [StopPhase.TRIPPED]: 2,
  [StopPhase.CANCELING_ENTRIES]: 3,
  [StopPhase.EXITING]: 4,
  [StopPhase.HALTED_RESIDUAL]: 5,
  [StopPhase.CLEARED]: 6,
};

/**
 * Documented `stopLossPercent` bounds, mirroring the Joi/frontend contract so
 * the engine is never stricter-or-looser by accident.
 */
export const MIN_STOP_LOSS_PERCENT = 0.1;
export const MAX_STOP_LOSS_PERCENT = 50;

/** Quantity epsilon for "flat" comparisons — same order as the grid's `heldQty`. */
export const STOP_QTY_EPSILON = 1e-8;

/** A single level's confirmed-inventory facts the stop machine reads. */
export interface StopHolding {
  /** Confirmed long quantity this level holds (booked BUY − booked SELL). */
  heldQty: number;
  /** Executed entry price; falls back to `price` when absent. */
  entryPrice?: number;
  /** The level's limit line (fallback reference when `entryPrice` is missing). */
  price: number;
}

/** The outcome of a controller transition — phase plus why (for logging). */
export interface StopDecision {
  phase: StopPhase;
  /** True only when this call actually moved the machine to a new phase. */
  changed: boolean;
  /** Operator-facing reason, present on the transitions that matter. */
  reason?: string;
}

/**
 * Is `percent` a valid, armable stop-loss percentage? `undefined` (default =
 * disabled) is valid-but-absent (stays INACTIVE); a present-but-out-of-range /
 * non-finite value is invalid and cannot arm.
 */
export function isValidStopLossPercent(percent: number | undefined): boolean {
  if (percent === undefined) return true;
  return (
    Number.isFinite(percent) &&
    percent >= MIN_STOP_LOSS_PERCENT &&
    percent <= MAX_STOP_LOSS_PERCENT
  );
}

/**
 * Trip math: has `mark` moved at least `percent`% *below* `reference`? Long
 * grid ⇒ adverse = downward. Returns **false** on non-finite inputs (bad data
 * must never trip — a missing mark parks, it does not sell). Inclusive (`<=`).
 */
export function evaluateTrip(
  mark: number,
  reference: number,
  percent: number
): boolean {
  if (!Number.isFinite(mark) || !Number.isFinite(reference)) return false;
  if (!Number.isFinite(percent) || percent < 0) return false;
  const trigger = reference * (1 - percent / 100);
  return mark <= trigger;
}

/**
 * Weighted-average entry of open held inventory (the §2 reference algorithm):
 * `Σ(entryPrice_i · heldQty_i) / Σ heldQty_i`. `undefined` when flat — the
 * caller then falls back to `baselinePrice` (monitoring-only, nothing to exit).
 */
export function weightedEntryPrice(
  holdings: readonly StopHolding[]
): number | undefined {
  let qty = 0;
  let weighted = 0;
  for (const h of holdings) {
    const held = Number(h.heldQty);
    if (!Number.isFinite(held) || held <= 0) continue;
    const entry = Number.isFinite(Number(h.entryPrice))
      ? Number(h.entryPrice)
      : Number(h.price);
    qty += held;
    weighted += entry * held;
  }
  if (qty <= STOP_QTY_EPSILON) return undefined;
  return weighted / qty;
}

/** Facts the exit-completion check reads; gathered by the grid (local = truth). */
export interface ExitCompletionFacts {
  /** This grid's confirmed held quantity across all levels. */
  localHeldQty: number;
  /** Whether every owned resting entry-BUY handle is cleared. */
  entriesCleared: boolean;
  /** The venue's `position_qty` for the symbol, or `undefined` if unread. */
  venueQty?: number;
  /** Whether the venue position read succeeded at all. */
  venueReadable: boolean;
  /** Another live bot trades this symbol on the same account. */
  symbolShared: boolean;
  /** Drift tolerance for the exclusive-symbol venue cross-check. */
  venueTolerance: number;
}

/** Persistable stop-loss block for the grid snapshot. */
export interface StopLossSnapshot {
  percent: number;
  phase: StopPhase;
  referencePrice?: number;
  percentAtTrip?: number;
  trippedAt?: string;
}

/**
 * The grid stop-loss controller. Pure: every method takes plain facts and
 * returns a {@link StopDecision}; the grid performs the I/O the decision implies.
 */
export class GridStopLossController {
  private phase: StopPhase;
  private percent: number | undefined;
  private referencePrice: number | undefined;
  private percentAtTrip: number | undefined;
  private trippedAt: string | undefined;

  /**
   * @param percent   configured `stopLossPercent` (undefined = disabled).
   * @param restored  persisted state replayed on restart, so the machine
   *                  re-enters at the saved phase rather than re-arming.
   */
  constructor(percent?: number, restored?: StopLossSnapshot) {
    this.percent = percent;
    if (restored) {
      this.phase = restored.phase;
      this.referencePrice = restored.referencePrice;
      this.percentAtTrip = restored.percentAtTrip;
      this.trippedAt = restored.trippedAt;
      // Restored active state wins over config (sticky-while-stopping). A
      // restored INACTIVE/ARMED is re-derived from the live config.
      if (this.phase === StopPhase.INACTIVE || this.phase === StopPhase.ARMED) {
        this.phase = this.canArm(percent)
          ? StopPhase.ARMED
          : StopPhase.INACTIVE;
      }
      return;
    }
    this.phase = this.canArm(percent) ? StopPhase.ARMED : StopPhase.INACTIVE;
  }

  private canArm(percent: number | undefined): boolean {
    return isValidStopLossPercent(percent) && percent !== undefined;
  }

  /** Current phase. */
  getPhase(): StopPhase {
    return this.phase;
  }

  /** The configured percent (undefined = disabled). */
  getPercent(): number | undefined {
    return this.percent;
  }

  /** Reference price locked at trip (undefined while merely monitoring). */
  getReferencePrice(): number | undefined {
    return this.referencePrice;
  }

  /** The percent in effect when the machine tripped (audit). */
  getPercentAtTrip(): number | undefined {
    return this.percentAtTrip;
  }

  /** ISO timestamp of the trip (undefined until tripped). */
  getTrippedAt(): string | undefined {
    return this.trippedAt;
  }

  /** Persistable projection of the controller (the snapshot's `stopLoss`). */
  toSnapshot(): StopLossSnapshot {
    return {
      percent: this.percent ?? 0,
      phase: this.phase,
      referencePrice: this.referencePrice,
      percentAtTrip: this.percentAtTrip,
      trippedAt: this.trippedAt,
    };
  }

  /** True when the machine is on the active stop path (tripped..halted). */
  isActive(): boolean {
    return (
      PHASE_ORDER[this.phase] >= PHASE_ORDER[StopPhase.TRIPPED] &&
      this.phase !== StopPhase.CLEARED
    );
  }

  /**
   * True when new entries must be frozen: anything at/after TRIPPED, including
   * terminal CLEARED (we stay stopped until an operator Resume).
   */
  blocksEntries(): boolean {
    return PHASE_ORDER[this.phase] >= PHASE_ORDER[StopPhase.TRIPPED];
  }

  /**
   * Apply a config change to `stopLossPercent`. **Monitoring-only** (correction
   * #2): in INACTIVE/ARMED the new value re-arms (or disables). Once tripped the
   * machine is repairing inventory and orders — a risk-parameter edit is ignored
   * for control flow; we keep stopping.
   */
  configure(percent: number | undefined): StopDecision {
    if (this.isActive() || this.phase === StopPhase.CLEARED) {
      return { phase: this.phase, changed: false };
    }
    const before = this.phase;
    this.percent = percent;
    this.phase = this.canArm(percent) ? StopPhase.ARMED : StopPhase.INACTIVE;
    return {
      phase: this.phase,
      changed: this.phase !== before,
      reason:
        percent === undefined ? "stop-loss disabled" : `stop-loss ${percent}%`,
    };
  }

  /**
   * Monitor the mark against the reference (ARMED only). On a trip, locks the
   * reference and percent for audit and moves to TRIPPED; otherwise stays ARMED.
   * Any other phase is a no-op — you cannot un-trip by feeding a price.
   */
  monitor(mark: number, reference: number): StopDecision {
    if (this.phase !== StopPhase.ARMED || this.percent === undefined) {
      return { phase: this.phase, changed: false };
    }
    if (!Number.isFinite(reference) || reference <= 0) {
      // No trustworthy reference: do not trip on bad data.
      return { phase: this.phase, changed: false };
    }
    if (!evaluateTrip(mark, reference, this.percent)) {
      return { phase: this.phase, changed: false };
    }
    this.referencePrice = reference;
    this.percentAtTrip = this.percent;
    this.trippedAt = new Date().toISOString();
    this.phase = StopPhase.TRIPPED;
    return {
      phase: this.phase,
      changed: true,
      reason: `mark ${mark} tripped ${this.percent}% below reference ${reference}`,
    };
  }

  /** TRIPPED → CANCELING_ENTRIES (immediate). */
  beginCancelingEntries(): StopDecision {
    if (this.phase !== StopPhase.TRIPPED) {
      return { phase: this.phase, changed: false };
    }
    this.phase = StopPhase.CANCELING_ENTRIES;
    return { phase: this.phase, changed: true };
  }

  /**
   * CANCELING_ENTRIES → EXITING once all owned entry BUYs are cleared. If any
   * entry BUY is still outstanding the machine stays in CANCELING_ENTRIES (the
   * grid retries; an unconfirmed cancel never advances).
   */
  entriesCanceled(remainingEntryBuys: number): StopDecision {
    if (this.phase !== StopPhase.CANCELING_ENTRIES) {
      return { phase: this.phase, changed: false };
    }
    if (remainingEntryBuys > 0) {
      return { phase: this.phase, changed: false };
    }
    this.phase = StopPhase.EXITING;
    return { phase: this.phase, changed: true };
  }

  /** Force the exit phase (e.g. a restart restoring mid-cancel). */
  beginExiting(): StopDecision {
    if (this.phase === StopPhase.CLEARED) {
      return { phase: this.phase, changed: false };
    }
    const before = this.phase;
    this.phase = StopPhase.EXITING;
    return { phase: this.phase, changed: this.phase !== before };
  }

  /** Move to HALTED_RESIDUAL (fail closed) with an operator-facing reason. */
  haltResidual(reason: string): StopDecision {
    const before = this.phase;
    this.phase = StopPhase.HALTED_RESIDUAL;
    return { phase: this.phase, changed: this.phase !== before, reason };
  }

  /**
   * Evaluate EXITING → CLEARED / HALTED_RESIDUAL / stay EXITING (correction #1).
   * Authoritative gate is **this grid's** confirmed state; the venue read is a
   * secondary safety net only when the symbol is exclusively ours.
   */
  evaluateExitComplete(facts: ExitCompletionFacts): StopDecision {
    if (this.phase !== StopPhase.EXITING) {
      return { phase: this.phase, changed: false };
    }
    const localFlat = facts.localHeldQty <= STOP_QTY_EPSILON;
    if (!localFlat || !facts.entriesCleared) {
      // Still unwinding confirmed inventory or entry cancels in flight.
      return { phase: this.phase, changed: false };
    }

    if (facts.symbolShared) {
      // The venue's non-zero position is a co-tenant's, not ours to clear.
      this.phase = StopPhase.CLEARED;
      return {
        phase: this.phase,
        changed: true,
        reason:
          "grid confirmed inventory cleared (shared symbol; venue position is co-tenant)",
      };
    }

    if (!facts.venueReadable) {
      // Exclusive-symbol safety net could not run: fail closed rather than
      // claim a flat we never verified.
      this.phase = StopPhase.HALTED_RESIDUAL;
      return {
        phase: this.phase,
        changed: true,
        reason: "position read failed while verifying exclusive-symbol flat",
      };
    }

    const venueQty = Number(facts.venueQty ?? 0);
    const tol = Math.max(Number(facts.venueTolerance) || 0, STOP_QTY_EPSILON);
    if (Math.abs(venueQty) <= tol) {
      this.phase = StopPhase.CLEARED;
      return {
        phase: this.phase,
        changed: true,
        reason: "grid and venue both confirmed flat",
      };
    }
    this.phase = StopPhase.HALTED_RESIDUAL;
    return {
      phase: this.phase,
      changed: true,
      reason: `local flat but venue residual ${venueQty} exceeds tolerance ${tol}`,
    };
  }
}
