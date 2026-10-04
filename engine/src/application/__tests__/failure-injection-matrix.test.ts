/** @format */

/**
 * Phase 6 — failure-injection matrix (scripted fake exchange, no network).
 *
 * The scenarios the 2026-10-04 reviewers asked to be made to *lie*: a lost
 * create response, a create timeout, an unreachable exchange, progressive
 * partial fills across polls, a redelivered observation, a cancel/fill race, a
 * lost cancel response, a stale historical client-order id, a restart that
 * re-hydrates a partially booked slot, and a startup pass against an
 * unreachable venue.
 *
 * The inherently live cases (real SIGKILL, Redis restart, orphan-at-venue) are
 * **not** here — a unit test cannot grant a live gate; those stay in the
 * Gate-2 / gate runbooks. See `docs/instructions/phase6-failure-injection-plan.md`.
 */
import { ClientOrderIdGenerator } from "../../utils/client-order-id";
import { GridLevel } from "../../types/strategy";
import { OrderManager } from "../order-manager";
import { OrderReconciliationService } from "../order-reconciliation.service";
import { FakeExchange, httpError, timeoutError } from "./helpers/fake-exchange";

const SYMBOL = "ETH";
const notFound = { kind: "NOT_FOUND" } as const;

function openOrder(orderId: string, clientOrderId?: string) {
  return { orderId, clientOrderId, symbol: SYMBOL, status: "OPEN" };
}

function setup(
  levels: GridLevel[] = [
    { price: 100, filled: false },
    { price: 110, filled: false },
  ],
  orderQuantity = 1
) {
  const ids = new ClientOrderIdGenerator("bot-x");
  const manager = new OrderManager(levels, ids, orderQuantity);
  const fx = new FakeExchange();
  const service = new OrderReconciliationService("bot-x", fx, SYMBOL, manager);
  return { levels, manager, fx, service, ids };
}

type Harness = ReturnType<typeof setup>;

/** Place a slot's BUY through the default (NOT_FOUND) happy path. */
async function placeBuy(x: Harness): Promise<string> {
  await x.service.ensureSlotOrder(0, "BUY", 100, 1);
  return x.manager.getBySlot(0, "BUY")?.orderId as string;
}

describe("Phase 6 — placement faults (ensureSlotOrder)", () => {
  it("create accepted + response lost → adopts the live order, never double-places", async () => {
    const x = setup();
    let lookups = 0;
    x.fx.on("queryOrderByClientOrderId", (_s, id) => {
      lookups += 1;
      return lookups === 1
        ? notFound
        : { kind: "FOUND_OPEN" as const, order: openOrder("live-1", id) };
    });
    x.fx.fail("createOrder", timeoutError());

    const outcome = await x.service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({ kind: "OPEN", orderId: "live-1" });
    expect(x.fx.created).toHaveLength(1); // attempted once
    expect(x.fx.count("queryOrderByClientOrderId")).toBe(2); // pre-submit + recovery
    expect(x.levels[0].buyOrderId).toBe("live-1");
  });

  it("create timeout, nothing at the venue → UNAVAILABLE (freeze), no handle", async () => {
    const x = setup();
    x.fx.fail("createOrder", timeoutError());

    const outcome = await x.service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({
      kind: "UNAVAILABLE",
      reason: "timeout of 8000ms exceeded",
    });
    expect(x.manager.getBySlot(0, "BUY")?.state).toBe("EXCHANGE_UNAVAILABLE");
    expect(x.levels[0].buyOrderId).toBeUndefined();
  });

  it("pre-submit lookup UNREACHABLE → freeze, no create at all", async () => {
    const x = setup();
    x.fx.scan = { kind: "UNREACHABLE", reason: "responded 500" };

    const outcome = await x.service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome.kind).toBe("UNAVAILABLE");
    expect(x.fx.created).toHaveLength(0);
  });

  it("pre-submit NOT_FOUND → places exactly once", async () => {
    const x = setup();
    x.fx.scan = notFound;

    const outcome = await x.service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({ kind: "OPEN", orderId: "ex-1" });
    expect(x.fx.created).toHaveLength(1);
  });
});

describe("Phase 6 — fill faults (checkSlot)", () => {
  it("progressive partials book the delta only; a redelivered observation books nothing", async () => {
    const x = setup();
    const handle = await placeBuy(x);
    let cum = 0.4;
    x.fx.on("getOrder", () => ({
      orderId: handle,
      status: "OPEN",
      executedQuantity: cum,
      executedPrice: 100,
    }));

    const first = await x.service.checkSlot(0, "BUY");
    expect(first).toMatchObject({ kind: "PARTIALLY_FILLED", cumQty: 0.4 });
    expect(x.levels[0].heldQty).toBeCloseTo(0.4, 8);

    // Same cumulative observed again (no new fill / redelivery) → nothing booked.
    const again = await x.service.checkSlot(0, "BUY");
    expect(again.kind).toBe("OPEN");
    expect(x.levels[0].heldQty).toBeCloseTo(0.4, 8);

    // The venue advances → only the new segment is booked.
    cum = 0.55;
    const third = await x.service.checkSlot(0, "BUY");
    expect(third).toMatchObject({ kind: "PARTIALLY_FILLED", cumQty: 0.55 });
    if (third.kind === "PARTIALLY_FILLED") {
      expect(third.delta).toBeCloseTo(0.15, 8);
    }
    expect(x.levels[0].heldQty).toBeCloseTo(0.55, 8);
  });

  it("terminal FILLED books only the unbooked remainder (partial then completion)", async () => {
    const x = setup();
    const handle = await placeBuy(x);
    x.fx.on("getOrder", () => ({
      orderId: handle,
      status: "OPEN",
      executedQuantity: 0.3,
      executedPrice: 100,
    }));
    await x.service.checkSlot(0, "BUY");

    x.fx.on("getOrder", () => ({
      orderId: handle,
      status: "FILLED",
      executedQuantity: 1,
      executedPrice: 100,
    }));
    const done = await x.service.checkSlot(0, "BUY");

    expect(done).toMatchObject({ kind: "FILLED", filledQty: 1 });
    if (done.kind === "FILLED") expect(done.delta).toBeCloseTo(0.7, 8);
    expect(x.levels[0].filled).toBe(true);
  });

  it("cancel/fill race: a DEAD row with executions books the pending fill before re-arming", async () => {
    const x = setup();
    const handle = await placeBuy(x);
    x.fx.on("getOrder", () => ({
      orderId: handle,
      status: "CANCELLED",
      executedQuantity: 0.25,
      executedPrice: 100,
    }));

    const outcome = await x.service.checkSlot(0, "BUY");

    expect(outcome.kind).toBe("SAFE_TO_RECREATE");
    if (outcome.kind === "SAFE_TO_RECREATE") {
      expect(outcome.pendingFill).toMatchObject({
        cumQty: 0.25,
        delta: 0.25,
        clientOrderId: x.ids.generate(0, "BUY", 0),
      });
    }
    expect(x.levels[0].heldQty).toBeCloseTo(0.25, 8);
    expect(x.levels[0].buyOrderId).toBeUndefined();
  });

  it("lost cancel response: gone (404) re-arms, unreachable (500) freezes", async () => {
    const gone = setup();
    await placeBuy(gone);
    gone.fx.fail("getOrder", httpError(404));
    expect((await gone.service.checkSlot(0, "BUY")).kind).toBe(
      "SAFE_TO_RECREATE"
    );

    const unreachable = setup();
    await placeBuy(unreachable);
    unreachable.fx.fail("getOrder", httpError(500));
    expect((await unreachable.service.checkSlot(0, "BUY")).kind).toBe(
      "UNAVAILABLE"
    );
  });
});

describe("Phase 6 — restart re-hydration (snapshot cumulative)", () => {
  it("a restored, partially booked slot re-observes the same cumulative without re-booking", async () => {
    const levels: GridLevel[] = [
      { price: 100, filled: false, buyOrderId: "live-1", buyFilledQty: 0.4 },
    ];
    const x = setup(levels);
    x.fx.on("getOrder", () => ({
      orderId: "live-1",
      status: "OPEN",
      executedQuantity: 0.4,
      executedPrice: 100,
    }));

    const same = await x.service.checkSlot(0, "BUY");
    expect(same.kind).toBe("OPEN"); // already booked before the restart
    expect(x.manager.getBySlot(0, "BUY")?.filledQty).toBeCloseTo(0.4, 8);

    x.fx.on("getOrder", () => ({
      orderId: "live-1",
      status: "OPEN",
      executedQuantity: 0.6,
      executedPrice: 100,
    }));
    const grown = await x.service.checkSlot(0, "BUY");
    expect(grown.kind).toBe("PARTIALLY_FILLED");
    if (grown.kind === "PARTIALLY_FILLED") {
      expect(grown.delta).toBeCloseTo(0.2, 8); // only the post-restart segment
    }
    expect(x.manager.getBySlot(0, "BUY")?.filledQty).toBeCloseTo(0.6, 8);
  });
});

describe("Phase 6 — stale historical client-order id (G1)", () => {
  it("a spent id's terminal venue history is never adopted by the next cycle", async () => {
    const x = setup();
    await x.service.ensureSlotOrder(0, "BUY", 100, 1);
    const gen0 = x.ids.generate(0, "BUY", 0);
    x.manager.markFilled(gen0, "ex-1", 1);

    // The venue keeps the terminal history row for the spent gen-0 id forever.
    x.fx.on("queryOrderByClientOrderId", (_s, id) =>
      id === gen0
        ? {
            kind: "FOUND_FILLED" as const,
            order: {
              orderId: "ex-1",
              clientOrderId: gen0,
              symbol: SYMBOL,
              status: "FILLED",
            },
          }
        : notFound
    );

    const before = x.fx.count("queryOrderByClientOrderId");
    const outcome = await x.service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({ kind: "OPEN", orderId: "ex-2" }); // placed, not a phantom fill
    expect(x.fx.created).toHaveLength(2);
    const queried = x.fx.calls
      .filter(c => c.method === "queryOrderByClientOrderId")
      .slice(before)
      .map(c => c.args[1]);
    expect(queried).toContain(x.ids.generate(0, "BUY", 1)); // current generation
    expect(queried).not.toContain(gen0); // never the spent one
  });
});

describe("Phase 6 — startup reconciliation faults (reconcileSymbol)", () => {
  it("an unreachable listing fails closed", async () => {
    const x = setup();
    x.fx.fail("listOpenOrders", timeoutError());

    const report = await x.service.reconcileSymbol();

    expect(report).toMatchObject({
      reachable: false,
      adopted: 0,
      filled: 0,
      orphans: [],
      fills: [],
    });
  });

  it("a restored handle that filled while down is adopted as a fill segment", async () => {
    const levels: GridLevel[] = [
      { price: 100, filled: false, buyOrderId: "live-1" },
    ];
    const x = setup(levels);
    x.fx.openOrders = [];
    x.fx.on("getOrder", () => ({
      orderId: "live-1",
      status: "FILLED",
      executedQuantity: 1,
      executedPrice: 100,
    }));

    const report = await x.service.reconcileSymbol();

    expect(report.filled).toBe(1);
    expect(report.fills).toHaveLength(1);
    expect(levels[0].filled).toBe(true);
  });
});
