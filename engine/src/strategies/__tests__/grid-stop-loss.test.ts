/** @format */

/**
 * Pure state-machine tests for the grid stop-loss. No exchange I/O — these pin
 * the phase transitions, the trip math, the reference algorithm, and the two
 * corrected policies: local-confirmed CLEARED under co-tenancy (correction #1)
 * and sticky-while-stopping config edits (correction #2).
 */

import {
  GridStopLossController,
  MAX_STOP_LOSS_PERCENT,
  MIN_STOP_LOSS_PERCENT,
  StopPhase,
  evaluateTrip,
  isValidStopLossPercent,
  weightedEntryPrice,
} from "../grid-stop-loss";

describe("evaluateTrip (trip math)", () => {
  it("trips at or below the threshold, inclusive", () => {
    expect(evaluateTrip(95, 100, 5)).toBe(true);
    expect(evaluateTrip(90, 100, 5)).toBe(true);
    expect(evaluateTrip(95.01, 100, 5)).toBe(false);
    expect(evaluateTrip(100, 100, 5)).toBe(false);
  });

  it("only trips downward (long grid)", () => {
    expect(evaluateTrip(110, 100, 5)).toBe(false);
    expect(evaluateTrip(120, 100, 5)).toBe(false);
  });

  it("never trips on non-finite / bad data (parks, does not sell)", () => {
    expect(evaluateTrip(NaN, 100, 5)).toBe(false);
    expect(evaluateTrip(90, NaN, 5)).toBe(false);
    expect(evaluateTrip(90, Infinity, 5)).toBe(false);
    expect(evaluateTrip(90, 100, NaN)).toBe(false);
  });
});

describe("isValidStopLossPercent", () => {
  it("accepts undefined (disabled) and in-range values", () => {
    expect(isValidStopLossPercent(undefined)).toBe(true);
    expect(isValidStopLossPercent(MIN_STOP_LOSS_PERCENT)).toBe(true);
    expect(isValidStopLossPercent(MAX_STOP_LOSS_PERCENT)).toBe(true);
    expect(isValidStopLossPercent(5)).toBe(true);
  });

  it("rejects out-of-range / non-finite values", () => {
    expect(isValidStopLossPercent(0)).toBe(false);
    expect(isValidStopLossPercent(0.05)).toBe(false);
    expect(isValidStopLossPercent(51)).toBe(false);
    expect(isValidStopLossPercent(-2)).toBe(false);
    expect(isValidStopLossPercent(NaN)).toBe(false);
    expect(isValidStopLossPercent(Infinity)).toBe(false);
  });
});

describe("weightedEntryPrice (reference algorithm)", () => {
  it("weights each level by its held quantity", () => {
    const ref = weightedEntryPrice([
      { heldQty: 2, entryPrice: 100, price: 100 },
      { heldQty: 1, entryPrice: 102, price: 102 },
    ]);
    expect(ref).toBeCloseTo(302 / 3, 8);
  });

  it("falls back to the level price when entryPrice is absent", () => {
    expect(weightedEntryPrice([{ heldQty: 1, price: 99 }])).toBe(99);
  });

  it("returns undefined when flat (caller uses baseline)", () => {
    expect(weightedEntryPrice([])).toBeUndefined();
    expect(
      weightedEntryPrice([{ heldQty: 0, entryPrice: 100, price: 100 }])
    ).toBeUndefined();
  });
});

describe("GridStopLossController — arming & monitoring", () => {
  it("is INACTIVE when percent is unset (normal grid)", () => {
    const c = new GridStopLossController(undefined);
    expect(c.getPhase()).toBe(StopPhase.INACTIVE);
    expect(c.blocksEntries()).toBe(false);
  });

  it("is ARMED when a valid percent is set", () => {
    const c = new GridStopLossController(5);
    expect(c.getPhase()).toBe(StopPhase.ARMED);
    expect(c.blocksEntries()).toBe(false);
  });

  it("ARMED → TRIPPED locks the reference and percent for audit", () => {
    const c = new GridStopLossController(5);
    const d = c.monitor(94, 100);
    expect(d.phase).toBe(StopPhase.TRIPPED);
    expect(d.changed).toBe(true);
    expect(c.getReferencePrice()).toBe(100);
    expect(c.getPercentAtTrip()).toBe(5);
    expect(c.getTrippedAt()).toBeDefined();
    expect(c.blocksEntries()).toBe(true);
    expect(c.isActive()).toBe(true);
  });

  it("stays ARMED while above the threshold", () => {
    const c = new GridStopLossController(5);
    const d = c.monitor(99, 100);
    expect(d.phase).toBe(StopPhase.ARMED);
    expect(d.changed).toBe(false);
  });

  it("does not trip on a non-positive / non-finite reference", () => {
    const c = new GridStopLossController(5);
    expect(c.monitor(94, 0).phase).toBe(StopPhase.ARMED);
    expect(c.monitor(94, NaN).phase).toBe(StopPhase.ARMED);
  });

  it("cannot un-trip by feeding a later price", () => {
    const c = new GridStopLossController(5);
    c.monitor(94, 100);
    expect(c.monitor(120, 100).phase).toBe(StopPhase.TRIPPED);
  });
});

describe("GridStopLossController — transition ladder", () => {
  function tripped(): GridStopLossController {
    const c = new GridStopLossController(5);
    c.monitor(94, 100);
    return c;
  }

  it("TRIPPED → CANCELING_ENTRIES → EXITING as entries clear", () => {
    const c = tripped();
    expect(c.beginCancelingEntries().phase).toBe(StopPhase.CANCELING_ENTRIES);
    expect(c.entriesCanceled(2).phase).toBe(StopPhase.CANCELING_ENTRIES);
    expect(c.entriesCanceled(0).phase).toBe(StopPhase.EXITING);
  });

  it("only advances from the correct phase (no out-of-order jumps)", () => {
    const c = tripped();
    expect(c.entriesCanceled(0).phase).toBe(StopPhase.TRIPPED);
    expect(c.monitor(120, 100).phase).toBe(StopPhase.TRIPPED);
  });
});

describe("GridStopLossController — CLEARED gate (correction #1)", () => {
  function exiting(): GridStopLossController {
    const c = new GridStopLossController(5);
    c.monitor(94, 100);
    c.beginCancelingEntries();
    c.entriesCanceled(0);
    return c;
  }

  const base = {
    entriesCleared: true,
    venueReadable: true,
    venueQty: 0,
    symbolShared: false,
    venueTolerance: 0.5,
  };

  it("stays EXITING while local inventory or entries remain", () => {
    const c = exiting();
    expect(c.evaluateExitComplete({ ...base, localHeldQty: 1 }).phase).toBe(
      StopPhase.EXITING
    );
    expect(
      c.evaluateExitComplete({
        ...base,
        localHeldQty: 0,
        entriesCleared: false,
      }).phase
    ).toBe(StopPhase.EXITING);
  });

  it("exclusive symbol: CLEARED when both local and venue are flat", () => {
    const c = exiting();
    const d = c.evaluateExitComplete({ ...base, localHeldQty: 0 });
    expect(d.phase).toBe(StopPhase.CLEARED);
    expect(d.changed).toBe(true);
  });

  it("exclusive symbol: HALTED_RESIDUAL when venue shows residual we own", () => {
    const c = exiting();
    const d = c.evaluateExitComplete({ ...base, localHeldQty: 0, venueQty: 2 });
    expect(d.phase).toBe(StopPhase.HALTED_RESIDUAL);
  });

  it("exclusive symbol: HALTED_RESIDUAL when the venue read fails (fail closed)", () => {
    const c = exiting();
    const d = c.evaluateExitComplete({
      ...base,
      localHeldQty: 0,
      venueReadable: false,
    });
    expect(d.phase).toBe(StopPhase.HALTED_RESIDUAL);
  });

  it("shared symbol: CLEARED on local flat even though the venue is non-flat", () => {
    const c = exiting();
    const d = c.evaluateExitComplete({
      ...base,
      localHeldQty: 0,
      venueQty: 5,
      symbolShared: true,
    });
    expect(d.phase).toBe(StopPhase.CLEARED);
  });
});

describe("GridStopLossController — config edit stickiness (correction #2)", () => {
  it("re-arms from config while monitoring", () => {
    const c = new GridStopLossController(5);
    const d = c.configure(10);
    expect(d.phase).toBe(StopPhase.ARMED);
    expect(c.getPercent()).toBe(10);
    // New 10% threshold (trigger 90 off reference 100) applies next monitor.
    expect(c.monitor(90, 100).phase).toBe(StopPhase.TRIPPED);
  });

  it("disables (INACTIVE) when the config is cleared while monitoring", () => {
    const c = new GridStopLossController(5);
    expect(c.configure(undefined).phase).toBe(StopPhase.INACTIVE);
  });

  it("ignores config changes once tripped/exiting (sticky stop)", () => {
    const c = new GridStopLossController(5);
    c.monitor(94, 100);
    c.beginCancelingEntries();
    c.entriesCanceled(0);
    const d = c.configure(50);
    expect(d.changed).toBe(false);
    expect(c.getPhase()).toBe(StopPhase.EXITING);
    expect(c.blocksEntries()).toBe(true);
  });

  it("stays CLEARED (entries frozen) after a config edit", () => {
    const c = new GridStopLossController(5);
    c.monitor(94, 100);
    c.beginCancelingEntries();
    c.entriesCanceled(0);
    c.evaluateExitComplete({
      localHeldQty: 0,
      entriesCleared: true,
      venueReadable: true,
      venueQty: 0,
      symbolShared: false,
      venueTolerance: 0.5,
    });
    expect(c.configure(10).phase).toBe(StopPhase.CLEARED);
    expect(c.blocksEntries()).toBe(true);
  });
});

describe("GridStopLossController — restart restore", () => {
  it("re-enters EXITING at the saved phase, not re-armed", () => {
    const c = new GridStopLossController(5, {
      percent: 5,
      phase: StopPhase.EXITING,
      referencePrice: 100,
      trippedAt: "2026-10-12T00:00:00.000Z",
    });
    expect(c.getPhase()).toBe(StopPhase.EXITING);
    expect(c.getReferencePrice()).toBe(100);
    expect(c.blocksEntries()).toBe(true);
  });

  it("re-derives ARMED/INACTIVE from live config on restore", () => {
    const armed = new GridStopLossController(7, {
      percent: 7,
      phase: StopPhase.ARMED,
    });
    expect(armed.getPhase()).toBe(StopPhase.ARMED);
    const off = new GridStopLossController(undefined, {
      percent: 7,
      phase: StopPhase.ARMED,
    });
    expect(off.getPhase()).toBe(StopPhase.INACTIVE);
  });

  it("round-trips through toSnapshot", () => {
    const c = new GridStopLossController(5);
    c.monitor(94, 100);
    const snap = c.toSnapshot();
    const restored = new GridStopLossController(5, snap);
    expect(restored.getPhase()).toBe(StopPhase.TRIPPED);
    expect(restored.getReferencePrice()).toBe(100);
    expect(restored.getPercentAtTrip()).toBe(5);
  });
});
