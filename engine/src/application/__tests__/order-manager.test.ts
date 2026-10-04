/**
 * OrderManager — Phase 4 delta accounting, id spending and the held-quantity
 * projection (plan phase4-partial-fills-plan.md Phase 2; the "manager
 * delta/gen-bump matrix" called for in Phase 5 item 11).
 *
 * The manager is the single writer of slot identity and quantity state, so
 * these tests pin the invariants the whole feature rests on:
 * - a booking is a delta against the record's instance cumulative (A2),
 * - a redelivered/unchanged cumulative books nothing (idempotent),
 * - a venue cumulative can never move a level backwards (A5),
 * - an id is only spent (generation bump) when it actually carries fills (B1),
 * - the level's quantity projection is clamped and drives `filled` (C5).
 *
 * @format
 */

import { OrderManager } from "../order-manager";
import { ClientOrderIdGenerator } from "../../utils/client-order-id";
import { GridLevel } from "../../types/strategy";

const BOT = "bot-om";
const QTY = 1;

function setup(levels: GridLevel[] = [{ price: 100, filled: false }]) {
  const ids = new ClientOrderIdGenerator(BOT);
  const manager = new OrderManager(levels, ids, QTY);
  return { ids, manager, levels };
}

/** Open a fresh BUY instance and return its client order id. */
function openBuy(
  manager: OrderManager,
  levelIndex = 0,
  quantity = QTY
): string {
  const id = manager.idFor(levelIndex, "BUY");
  manager.beginSubmit(id, levelIndex, "BUY", 100, quantity);
  manager.markSubmitting(id);
  manager.markOpen(id, "venue-1");
  return id;
}

/** Open a fresh SELL instance and return its client order id. */
function openSell(
  manager: OrderManager,
  levelIndex = 0,
  quantity = QTY
): string {
  const id = manager.idFor(levelIndex, "SELL");
  manager.beginSubmit(id, levelIndex, "SELL", 100, quantity);
  manager.markSubmitting(id);
  manager.markOpen(id, "venue-s");
  return id;
}

describe("OrderManager — construction", () => {
  it("requires a positive finite orderQuantity", () => {
    const ids = new ClientOrderIdGenerator(BOT);
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(
        () => new OrderManager([{ price: 1, filled: false }], ids, bad)
      ).toThrow(/positive orderQuantity/);
    }
  });
});

describe("OrderManager — seeding from restored levels", () => {
  it("derives heldQty from a legacy boolean `filled` snapshot", () => {
    const { levels } = setup([
      { price: 100, filled: true },
      { price: 99, filled: false },
    ]);
    expect(levels[0].heldQty).toBe(QTY);
    expect(levels[1].heldQty).toBeUndefined();
  });

  it("recomputes `filled` from a present heldQty (never trusts the stale flag)", () => {
    const { levels } = setup([{ price: 100, filled: true, heldQty: 0.4 }]);
    expect(levels[0].filled).toBe(false);
    expect(levels[0].heldQty).toBe(0.4);

    const { levels: full } = setup([
      { price: 100, filled: false, heldQty: QTY },
    ]);
    expect(full[0].filled).toBe(true);
  });

  it("seeds a resting side's instance cumulative from the snapshot (A4)", () => {
    const { manager } = setup([
      { price: 100, filled: false, buyOrderId: "H1", buyFilledQty: 0.4 },
    ]);
    const record = manager.getBySlot(0, "BUY");
    expect(record?.filledQty).toBe(0.4);
    expect(record?.orderId).toBe("H1");
    expect(record?.state).toBe("UNKNOWN");
  });
});

describe("OrderManager — beginSubmit resets the instance cumulative", () => {
  it("clears the persisted side field so a new instance starts at zero (B3)", () => {
    const { manager, levels } = setup([
      { price: 100, filled: false, buyFilledQty: 0.4 },
    ]);
    const id = manager.idFor(0, "BUY");
    const record = manager.beginSubmit(id, 0, "BUY", 100, QTY);
    expect(record.filledQty).toBe(0);
    expect(levels[0].buyFilledQty).toBe(0);
  });
});

describe("OrderManager — markBooked delta accounting", () => {
  it("books only the delta and projects the held quantity", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);

    expect(manager.markBooked(id, 0.4)).toBe(0.4);
    expect(levels[0].heldQty).toBe(0.4);
    expect(levels[0].filled).toBe(false);
    expect(levels[0].buyFilledQty).toBe(0.4);

    expect(manager.markBooked(id, 0.7)).toBeCloseTo(0.3);
    expect(levels[0].heldQty).toBeCloseTo(0.7);

    expect(manager.markBooked(id, 1)).toBeCloseTo(0.3);
    expect(levels[0].heldQty).toBe(1);
    expect(levels[0].filled).toBe(true);
  });

  it("books nothing for an unchanged cumulative (idempotent re-poll)", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markBooked(id, 0.4);
    expect(manager.markBooked(id, 0.4)).toBeNull();
    expect(levels[0].heldQty).toBe(0.4);
  });

  it("warns and ignores a backwards cumulative, never booking negative (A5)", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markBooked(id, 0.5);
    expect(manager.markBooked(id, 0.3)).toBeNull();
    expect(levels[0].heldQty).toBe(0.5);
    expect(levels[0].buyFilledQty).toBe(0.5);
  });

  it("ignores a non-finite or negative cumulative", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    expect(manager.markBooked(id, NaN)).toBeNull();
    expect(manager.markBooked(id, -1)).toBeNull();
    expect(levels[0].heldQty).toBeUndefined();
  });

  it("returns null for an unknown client order id", () => {
    const { manager } = setup();
    expect(manager.markBooked("nope", 0.5)).toBeNull();
  });

  it("caps a BUY at the slot size and floors a SELL at zero (C5)", () => {
    const { manager, levels } = setup();
    const buy = openBuy(manager);
    manager.markBooked(buy, 1.5);
    expect(levels[0].heldQty).toBe(QTY);

    const sell = openSell(manager);
    manager.markBooked(sell, 2);
    expect(levels[0].heldQty).toBe(0);
  });
});

describe("OrderManager — markFilled terminal remainder", () => {
  it("books only the remainder after a partial already booked (A2)", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markBooked(id, 0.4);

    expect(manager.markFilled(id, "venue-1", 1)).toBeCloseTo(0.6);
    expect(levels[0].heldQty).toBe(1);
    expect(levels[0].filled).toBe(true);
    expect(levels[0].buyGen).toBe(1);
    expect(levels[0].buyOrderId).toBeUndefined();
  });

  it("books the whole order when no cumulative is reported", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    expect(manager.markFilled(id, "venue-1")).toBe(QTY);
    expect(levels[0].heldQty).toBe(QTY);
    expect(levels[0].filled).toBe(true);
  });

  it("still spends the id when the observation adds nothing (G1)", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markBooked(id, 1);
    expect(manager.markFilled(id, "venue-1", 1)).toBeNull();
    expect(levels[0].buyGen).toBe(1);
  });

  it("never books negative when the terminal cumulative lags the booked one", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markBooked(id, 0.8);
    expect(manager.markFilled(id, "venue-1", 0.5)).toBeNull();
    expect(levels[0].heldQty).toBe(0.8);
  });

  it("returns null for an unknown client order id", () => {
    const { manager } = setup();
    expect(manager.markFilled("nope", "venue-1", 1)).toBeNull();
  });
});

describe("OrderManager — markNotFound id spending (B1)", () => {
  it("keeps the id when the instance booked nothing (vanished, Gate 1-C)", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markNotFound(id);
    expect(levels[0].buyGen ?? 0).toBe(0);
    expect(levels[0].buyOrderId).toBeUndefined();
  });

  it("spends the id when the instance booked a partial fill", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    const before = manager.idFor(0, "BUY");
    manager.markBooked(id, 0.4);
    manager.markNotFound(id);
    expect(levels[0].buyGen).toBe(1);
    expect(manager.idFor(0, "BUY")).not.toBe(before);
  });

  it("is a no-op for an unknown client order id", () => {
    const { manager, levels } = setup();
    manager.markNotFound("nope");
    expect(levels[0].buyGen ?? 0).toBe(0);
  });
});

describe("OrderManager — snapFullyLong declares a level without booking (C2)", () => {
  it("sets the held quantity to the slot size and flags the level long", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markBooked(id, 0.96);
    expect(levels[0].heldQty).toBeCloseTo(0.96, 8);
    expect(levels[0].filled).toBe(false);

    manager.snapFullyLong(0);

    expect(levels[0].heldQty).toBe(1);
    expect(levels[0].filled).toBe(true);
  });

  it("books nothing: the instance cumulative still says what the venue filled", () => {
    const { manager, levels } = setup();
    const id = openBuy(manager);
    manager.markBooked(id, 0.96);

    manager.snapFullyLong(0);

    // A snap is a model decision, never a fill: the record is untouched, so
    // the next real execution still deltas against the venue's 0.96.
    expect(manager.markBooked(id, 0.96)).toBeNull();
    expect(manager.markBooked(id, 0.97)).toBeCloseTo(0.01, 8);
    expect(levels[0].buyFilledQty).toBeCloseTo(0.97, 8);
    // …and the declared long never slips past the slot size (C5 clamps it).
    expect(levels[0].heldQty).toBe(1);
  });

  it("is a no-op for an out-of-range level", () => {
    const { manager } = setup();
    expect(() => manager.snapFullyLong(9)).not.toThrow();
  });
});
