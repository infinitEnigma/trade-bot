/** @format */

/**
 * OrderReconciliationService — the exchange↔local state mapping (Phase 2).
 * Fake exchange + real OrderManager, so the assertions are about the machine.
 */
import { ExchangeClient, OrderLookup } from "../../domain/exchange";
import { ClientOrderIdGenerator } from "../../utils/client-order-id";
import { GridLevel } from "../../types/strategy";
import { CommandError } from "../command-error";
import { OrderManager } from "../order-manager";
import { OrderReconciliationService } from "../order-reconciliation.service";
import { TradeReporter } from "../trade-reporter";

const SYMBOL = "ETH";

type Script = {
  query?: (clientOrderId: string) => Promise<OrderLookup>;
  getOrder?: (orderId: string) => Promise<{
    orderId: string;
    status: string;
    executedPrice?: number;
    executedQuantity?: number;
  }>;
  createOrder?: (request: unknown) => Promise<{ orderId: string }>;
  listOpenOrders?: () => Promise<unknown[]>;
};

function notFound(): OrderLookup {
  return { kind: "NOT_FOUND" };
}

function fakeExchange(script: Script): ExchangeClient & {
  created: unknown[];
} {
  const created: unknown[] = [];
  return {
    created,
    getTicker: async () => ({ symbol: SYMBOL, price: 100 }),
    getOrder: async (orderId: string) =>
      script.getOrder ? script.getOrder(orderId) : { orderId, status: "OPEN" },
    createOrder: async (request: unknown) => {
      created.push(request);
      return script.createOrder
        ? script.createOrder(request)
        : { orderId: `new-${created.length}` };
    },
    cancelOrder: async () => ({ status: "CANCELLED" }),
    getPositions: async () => [],
    getAccountInfo: async () => ({ total_value: 0, max_leverage: 1 }),
    listOpenOrders: async () =>
      script.listOpenOrders ? script.listOpenOrders() : [],
    queryOrderByClientOrderId: async (_s: string, id: string) =>
      script.query ? script.query(id) : notFound(),
  } as unknown as ExchangeClient & { created: unknown[] };
}

function setup(script: Script) {
  const levels: GridLevel[] = [
    { price: 100, filled: false },
    { price: 110, filled: false },
  ];
  const ids = new ClientOrderIdGenerator("bot-x");
  const manager = new OrderManager(levels, ids, 1);
  const exchange = fakeExchange(script);
  const service = new OrderReconciliationService(
    "bot-x",
    exchange,
    SYMBOL,
    manager
  );
  return { levels, manager, exchange, service, ids };
}

/** A thrown axios-shaped 404 (axios.isAxiosError only checks the flag). */
function httpError(status: number): unknown {
  return {
    isAxiosError: true,
    message: `status ${status}`,
    response: { status },
  };
}

describe("OrderReconciliationService — ensureSlotOrder", () => {
  it("adopts a FOUND_OPEN order instead of submitting a duplicate", async () => {
    const { exchange, service, levels } = setup({
      query: async () => ({
        kind: "FOUND_OPEN" as const,
        order: { orderId: "live-1", symbol: SYMBOL, status: "OPEN" },
      }),
    });
    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);
    expect(outcome).toEqual({ kind: "OPEN", orderId: "live-1" });
    expect(exchange.created).toHaveLength(0);
    expect(levels[0].buyOrderId).toBe("live-1");
  });

  it("places an order on NOT_FOUND", async () => {
    const { exchange, service, levels } = setup({
      query: async () => notFound(),
    });
    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);
    expect(outcome.kind).toBe("OPEN");
    expect(exchange.created).toHaveLength(1);
    expect(levels[0].buyOrderId).toBeTruthy();
  });

  it("freezes the slot on UNREACHABLE (never places)", async () => {
    const { exchange, service, levels } = setup({
      query: async () => ({ kind: "UNREACHABLE" as const, reason: "timeout" }),
    });
    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);
    expect(outcome).toEqual({ kind: "UNAVAILABLE", reason: "timeout" });
    expect(exchange.created).toHaveLength(0);
    expect(levels[0].buyOrderId).toBeUndefined();
  });

  it("reconciles a lost create response (adopt after the submit error)", async () => {
    let queryCount = 0;
    const { exchange, service, levels } = setup({
      query: async () => {
        queryCount += 1;
        // First lookup: absent. After the create "fails", the order is live.
        return queryCount === 1
          ? notFound()
          : {
              kind: "FOUND_OPEN" as const,
              order: { orderId: "recovered-1", symbol: SYMBOL, status: "OPEN" },
            };
      },
      createOrder: async () => {
        throw new Error("connection reset after accept");
      },
    });
    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);
    expect(outcome).toEqual({ kind: "OPEN", orderId: "recovered-1" });
    expect(exchange.created).toHaveLength(1);
    expect(levels[0].buyOrderId).toBe("recovered-1");
  });

  it("forwards reduceOnly on the create request (grid exit legs, N6)", async () => {
    const { exchange, service } = setup({ query: async () => notFound() });
    await service.ensureSlotOrder(0, "SELL", 110, 1, true);
    expect(exchange.created).toHaveLength(1);
    expect(exchange.created[0]).toMatchObject({
      side: "SELL",
      reduceOnly: true,
    });
  });

  it("defaults reduceOnly off for ordinary placements", async () => {
    const { exchange, service } = setup({ query: async () => notFound() });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const created = exchange.created[0] as { reduceOnly?: boolean };
    expect(created.reduceOnly).toBe(false);
  });
});

describe("OrderReconciliationService — checkSlot", () => {
  it("clears the slot when the order is gone (404) — N3", async () => {
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async () => {
        throw httpError(404);
      },
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    expect(levels[0].buyOrderId).toBeTruthy();

    const outcome = await service.checkSlot(0, "BUY");
    expect(outcome.kind).toBe("SAFE_TO_RECREATE");
    expect(levels[0].buyOrderId).toBeUndefined();
  });

  it("freezes the slot on a transport error (handle kept)", async () => {
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async () => {
        throw new Error("socket hang up");
      },
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const handle = levels[0].buyOrderId;

    const outcome = await service.checkSlot(0, "BUY");
    expect(outcome.kind).toBe("UNAVAILABLE");
    expect(levels[0].buyOrderId).toBe(handle);
  });

  it("records a fill and flips the level flag", async () => {
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async (orderId: string) => ({ orderId, status: "FILLED" }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);

    const outcome = await service.checkSlot(0, "BUY");
    expect(outcome.kind).toBe("FILLED");
    expect(levels[0].filled).toBe(true);
    expect(levels[0].buyOrderId).toBeUndefined();
  });

  it("classifies a non-retryable CommandError as gone", async () => {
    const { service } = setup({
      query: async () => notFound(),
      getOrder: async () => {
        throw new CommandError(false, "order not found");
      },
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    expect((await service.checkSlot(0, "BUY")).kind).toBe("SAFE_TO_RECREATE");
  });

  it("classifies a retryable CommandError as unreachable", async () => {
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async () => {
        throw new CommandError(true, "status unresolved");
      },
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const handle = levels[0].buyOrderId;
    expect((await service.checkSlot(0, "BUY")).kind).toBe("UNAVAILABLE");
    expect(levels[0].buyOrderId).toBe(handle);
  });
});

describe("OrderReconciliationService — reconcileSymbol", () => {
  function restored() {
    const levels: GridLevel[] = [
      { price: 100, filled: false, buyOrderId: "restored-1" },
    ];
    const ids = new ClientOrderIdGenerator("bot-x");
    const manager = new OrderManager(levels, ids, 1);
    const exchange = fakeExchange({
      listOpenOrders: async () => [
        { orderId: "restored-1", symbol: SYMBOL, status: "OPEN" },
      ],
    });
    const service = new OrderReconciliationService(
      "bot-x",
      exchange,
      SYMBOL,
      manager
    );
    return { levels, service };
  }

  it("adopts a restored handle and reports no orphan", async () => {
    const { service } = restored();
    const report = await service.reconcileSymbol();
    expect(report.reachable).toBe(true);
    expect(report.adopted).toBe(1);
    expect(report.orphans).toHaveLength(0);
  });

  it("reports a live order the grid does not own (never cancels)", async () => {
    const { service } = setup({
      listOpenOrders: async () => [
        { orderId: "foreign-1", clientOrderId: "someone-else", status: "OPEN" },
      ],
    });
    const report = await service.reconcileSymbol();
    expect(report.reachable).toBe(true);
    expect(report.adopted).toBe(0);
    expect(report.orphans.map(o => o.orderId)).toEqual(["foreign-1"]);
  });

  it("reports unreachable when the listing fails (fail closed)", async () => {
    const { service } = setup({
      listOpenOrders: async () => {
        throw new Error("listing down");
      },
    });
    const report = await service.reconcileSymbol();
    expect(report.reachable).toBe(false);
    expect(report.reason).toContain("listing down");
  });
});

describe("OrderReconciliationService — G1 (stale history never books a phantom fill)", () => {
  const ids = new ClientOrderIdGenerator("bot-x");

  it("queries and places only the slot's current generation", async () => {
    // A spent cycle left its id at generation 0; the slot is armed for a new
    // cycle at generation 1 (legacy seed-bump or a booked fill).
    const levels: GridLevel[] = [{ price: 100, filled: false, buyGen: 1 }];
    const manager = new OrderManager(levels, ids, 1);
    const queried: string[] = [];
    const exchange = fakeExchange({
      query: async id => {
        queried.push(id);
        return notFound();
      },
    });
    const service = new OrderReconciliationService(
      "bot-x",
      exchange,
      SYMBOL,
      manager
    );

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    const staleId = ids.generate(0, "BUY", 0);
    const freshId = ids.generate(0, "BUY", 1);
    expect(outcome.kind).toBe("OPEN");
    // The spent id is never asked about — its terminal history row (the G1
    // phantom source) is unreachable by construction.
    expect(queried).toEqual([freshId]);
    expect(queried).not.toContain(staleId);
    expect(exchange.created).toHaveLength(1);
    expect(
      (exchange.created[0] as { clientOrderId: string }).clientOrderId
    ).toBe(freshId);
  });

  it("spends the slot id on a fill booked through checkSlot", async () => {
    const { service, levels, manager } = setup({
      query: async () => notFound(),
      getOrder: async (orderId: string) => ({ orderId, status: "FILLED" }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);

    const outcome = await service.checkSlot(0, "BUY");

    expect(outcome.kind).toBe("FILLED");
    // The outcome carries the id the fill happened under (gen 0) — not the
    // fresh one the generation bump just opened for the next cycle.
    expect((outcome as { clientOrderId: string }).clientOrderId).toBe(
      ids.generate(0, "BUY", 0)
    );
    expect(levels[0].buyGen).toBe(1);
    expect((await service.ensureSlotOrder(0, "BUY", 100, 1)).kind).toBe("OPEN");
    expect(manager.idFor(0, "BUY")).toBe(ids.generate(0, "BUY", 1));
  });

  it("spends the slot id on a fill booked through the pre-submit lookup", async () => {
    // Lost-response adoption: the order went live AND filled before the
    // retry — booking it is correct, and the generation must still spend so
    // the NEXT cycle cannot re-query this row (the G1 path).
    let queries = 0;
    const { service, levels } = setup({
      query: async () => {
        queries += 1;
        return queries === 1
          ? notFound()
          : {
              kind: "FOUND_FILLED" as const,
              order: { orderId: "filled-1", symbol: SYMBOL, status: "FILLED" },
            };
      },
      createOrder: async () => {
        throw new Error("connection reset after accept");
      },
    });

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome.kind).toBe("FILLED");
    expect((outcome as { clientOrderId: string }).clientOrderId).toBe(
      ids.generate(0, "BUY", 0)
    );
    expect(levels[0].buyGen).toBe(1);
    expect(levels[0].filled).toBe(true);
  });
});

describe("OrderReconciliationService — ORDER_INTENT gate (Phase 4)", () => {
  function withReporter(script: Script, intentPersisted: boolean) {
    const trace: string[] = [];
    const base = setup(script);
    const reportOrderIntent = jest.fn(async () => {
      trace.push("intent");
      return intentPersisted;
    });
    const reporter = {
      reportOrderIntent,
      reportFill: jest.fn(),
      reportPosition: jest.fn(),
      reportPerformance: jest.fn(),
    } as unknown as TradeReporter;
    const service = new OrderReconciliationService(
      "bot-x",
      base.exchange,
      SYMBOL,
      base.manager,
      reporter
    );
    const exchange = base.exchange as typeof base.exchange & {
      created: unknown[];
    };
    return { service, exchange, reportOrderIntent, trace };
  }

  it("publishes the intent strictly before createOrder", async () => {
    const trace: string[] = [];
    const base = setup({
      createOrder: async () => {
        trace.push("create");
        throw new Error("traced");
      },
    });
    const reportOrderIntent = jest.fn(async () => {
      trace.push("intent");
      return true;
    });
    const service = new OrderReconciliationService(
      "bot-x",
      base.exchange,
      SYMBOL,
      base.manager,
      { reportOrderIntent } as unknown as TradeReporter
    );

    await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(reportOrderIntent).toHaveBeenCalledTimes(1);
    expect(reportOrderIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-x",
        symbol: SYMBOL,
        side: "BUY",
        price: 100,
        quantity: 1,
        clientOrderId: expect.any(String),
      })
    );
    expect(trace).toEqual(["intent", "create"]);
  });

  it("does NOT place the order when the intent cannot be persisted", async () => {
    const { exchange, service } = withReporter({}, false);

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({
      kind: "UNAVAILABLE",
      reason: "order intent not persisted",
    });
    expect(exchange.created).toHaveLength(0);
    // The slot freezes as EXCHANGE_UNAVAILABLE (no orderId) so the next tick
    // retries rather than leaving a possibly-live order behind.
    expect((outcome as { kind: string }).kind).toBe("UNAVAILABLE");
  });

  it("places after a persisted intent", async () => {
    const { exchange, service, reportOrderIntent } = withReporter({}, true);

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome.kind).toBe("OPEN");
    expect(reportOrderIntent).toHaveBeenCalledTimes(1);
    expect(exchange.created).toHaveLength(1);
  });

  it("publishes no intent when the pre-submit lookup adopts a live order", async () => {
    const { exchange, service, reportOrderIntent } = withReporter(
      {
        query: async () => ({
          kind: "FOUND_OPEN" as const,
          order: { orderId: "live-1", symbol: SYMBOL, status: "OPEN" },
        }),
      },
      true
    );

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({ kind: "OPEN", orderId: "live-1" });
    expect(reportOrderIntent).not.toHaveBeenCalled();
    expect(exchange.created).toHaveLength(0);
  });
});

describe("OrderReconciliationService — partial-fill observation (Phase 4)", () => {
  const ids = new ClientOrderIdGenerator("bot-x");

  it("books a live partial segment and keeps the slot on the order", async () => {
    const { service, levels, manager } = setup({
      query: async () => notFound(),
      getOrder: async orderId => ({
        orderId,
        status: "OPEN",
        executedQuantity: 0.4,
        executedPrice: 100,
      }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const handle = levels[0].buyOrderId;

    const outcome = await service.checkSlot(0, "BUY");

    expect(outcome).toEqual({
      kind: "PARTIALLY_FILLED",
      orderId: handle,
      cumQty: 0.4,
      delta: 0.4,
      executedPrice: 100,
      clientOrderId: ids.generate(0, "BUY", 0),
    });
    // The position moved by the booked segment while the slot keeps holding
    // the order: a live partial spends nothing (B1) and cannot read as long.
    expect(levels[0].heldQty).toBeCloseTo(0.4, 8);
    expect(levels[0].filled).toBe(false);
    expect(levels[0].buyOrderId).toBe(handle);
    expect(levels[0].buyGen).toBeUndefined();
    expect(manager.getBySlot(0, "BUY")?.filledQty).toBeCloseTo(0.4, 8);
  });

  it("re-observing the same cumulative books nothing (idempotent re-poll)", async () => {
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async orderId => ({
        orderId,
        status: "OPEN",
        executedQuantity: 0.4,
      }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const handle = levels[0].buyOrderId;
    await service.checkSlot(0, "BUY");

    const again = await service.checkSlot(0, "BUY");

    expect(again).toEqual({ kind: "OPEN", orderId: handle });
    expect(levels[0].heldQty).toBeCloseTo(0.4, 8);
  });

  it("books only the remainder when the order completes after a partial (A2)", async () => {
    let status = "OPEN";
    let executedQuantity: number | undefined = 0.4;
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async orderId => ({ orderId, status, executedQuantity }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const first = await service.checkSlot(0, "BUY");
    expect(first.kind).toBe("PARTIALLY_FILLED");

    status = "FILLED";
    executedQuantity = 1;
    const terminal = await service.checkSlot(0, "BUY");

    // `filledQty` is the whole order, `delta` is what this row still owed —
    // the grid books the delta, so no segment is ever counted twice.
    expect(terminal).toMatchObject({
      kind: "FILLED",
      filledQty: 1,
      delta: 0.6,
    });
    expect(levels[0].heldQty).toBeCloseTo(1, 8);
    expect(levels[0].filled).toBe(true);
    expect(levels[0].buyOrderId).toBeUndefined();
  });

  it("books the fill that landed before a cancel, then spends the id (A3/B1)", async () => {
    let status = "OPEN";
    let executedQuantity: number | undefined = 0.5;
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async orderId => ({
        orderId,
        status,
        executedQuantity,
        executedPrice: 101.5,
      }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const handle = levels[0].buyOrderId;
    await service.checkSlot(0, "BUY");

    status = "CANCELLED";
    executedQuantity = 0.75; // 0.25 filled between the last poll and the cancel
    const outcome = await service.checkSlot(0, "BUY");

    expect(outcome).toEqual({
      kind: "SAFE_TO_RECREATE",
      pendingFill: {
        cumQty: 0.75,
        delta: 0.25,
        executedPrice: 101.5,
        clientOrderId: ids.generate(0, "BUY", 0),
        orderId: handle,
      },
    });
    expect(levels[0].heldQty).toBeCloseTo(0.75, 8);
    expect(levels[0].buyOrderId).toBeUndefined();
    // The instance booked fills, so its id is spent: a re-placed instance can
    // never mint the same segment bounds under the same client id (B1).
    expect(levels[0].buyGen).toBe(1);
  });

  it("books nothing and keeps the id when a canceled row reports no cumulative (D1)", async () => {
    const { service, levels } = setup({
      query: async () => notFound(),
      getOrder: async orderId => ({ orderId, status: "CANCELLED" }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);

    const outcome = await service.checkSlot(0, "BUY");

    // Exactly the pre-Phase-4 shape: absent `pendingFill`, gen-0 reuse intact
    // (Gate 1-C is byte-identical), no projection written.
    expect(outcome).toEqual({ kind: "SAFE_TO_RECREATE" });
    expect(levels[0].buyGen).toBeUndefined();
    expect(levels[0].heldQty).toBeUndefined();
  });

  it("carries the queried handle, not the venue's mutated order id (B2)", async () => {
    const { service, levels } = setup({
      query: async () => notFound(),
      // Lighter's own `order_id` moves as the order fills (…900 → …973).
      getOrder: async () => ({
        orderId: "562949945880973",
        status: "OPEN",
        executedQuantity: 0.4,
      }),
    });
    await service.ensureSlotOrder(0, "BUY", 100, 1);
    const handle = levels[0].buyOrderId as string;

    const outcome = await service.checkSlot(0, "BUY");

    expect(outcome).toMatchObject({
      kind: "PARTIALLY_FILLED",
      orderId: handle,
    });
    expect(levels[0].buyOrderId).toBe(handle);
  });

  it("adopts a partially filled live order found by the pre-submit lookup", async () => {
    const { service, levels, exchange } = setup({
      query: async () => ({
        kind: "FOUND_OPEN" as const,
        order: {
          orderId: "live-1",
          symbol: SYMBOL,
          status: "OPEN",
          price: 99.5,
          quantity: 1,
          executedQuantity: 0.25,
        },
      }),
    });

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({
      kind: "PARTIALLY_FILLED",
      orderId: "live-1",
      cumQty: 0.25,
      delta: 0.25,
      executedPrice: 99.5,
      clientOrderId: ids.generate(0, "BUY", 0),
    });
    expect(exchange.created).toHaveLength(0);
    expect(levels[0].buyOrderId).toBe("live-1");
    expect(levels[0].heldQty).toBeCloseTo(0.25, 8);
  });

  it("prefers the venue cumulative over the row size on FOUND_FILLED (A2)", async () => {
    const { service, levels } = setup({
      query: async () => ({
        kind: "FOUND_FILLED" as const,
        order: {
          orderId: "hist-1",
          symbol: SYMBOL,
          status: "FILLED",
          price: 100,
          quantity: 1,
          executedQuantity: 0.4,
        },
      }),
    });

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toMatchObject({
      kind: "FILLED",
      orderId: "hist-1",
      filledQty: 0.4,
      delta: 0.4,
    });
    expect(levels[0].heldQty).toBeCloseTo(0.4, 8);
  });

  it("books a canceled lookup's remainder and defers placement (A3/B1)", async () => {
    const { service, levels, exchange } = setup({
      query: async () => ({
        kind: "FOUND_CANCELED" as const,
        order: {
          orderId: "dead-1",
          symbol: SYMBOL,
          status: "CANCELLED",
          price: 100,
          quantity: 1,
          executedQuantity: 0.3,
        },
      }),
    });

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    expect(outcome).toEqual({
      kind: "SAFE_TO_RECREATE",
      pendingFill: {
        cumQty: 0.3,
        delta: 0.3,
        executedPrice: 100,
        clientOrderId: ids.generate(0, "BUY", 0),
        orderId: "dead-1",
      },
    });
    expect(levels[0].heldQty).toBeCloseTo(0.3, 8);
    // The booking proves the dead instance carried fills, so its id is spent.
    expect(levels[0].buyGen).toBe(1);
    // Nothing is placed over a dying row's remainder in the same tick: the row
    // is handed back and the (now fresh-id) slot re-arms on the next one.
    expect(levels[0].buyOrderId).toBeUndefined();
    expect(exchange.created).toHaveLength(0);
  });

  it("does not freeze the slot when a lost create response adopts a partial", async () => {
    let lookups = 0;
    const { service, levels, manager } = setup({
      query: async () => {
        lookups += 1;
        return lookups === 1
          ? notFound()
          : {
              kind: "FOUND_OPEN" as const,
              order: {
                orderId: "recovered-1",
                symbol: SYMBOL,
                status: "OPEN",
                price: 100,
                executedQuantity: 0.5,
              },
            };
      },
      createOrder: async () => {
        throw new Error("connection reset after accept");
      },
    });

    const outcome = await service.ensureSlotOrder(0, "BUY", 100, 1);

    // A live, partially filled order is a successful placement — freezing it
    // would strand a handle the next tick would try to place over.
    expect(outcome.kind).toBe("PARTIALLY_FILLED");
    expect(levels[0].buyOrderId).toBe("recovered-1");
    expect(levels[0].heldQty).toBeCloseTo(0.5, 8);
    expect(manager.getBySlot(0, "BUY")?.state).toBe("OPEN");
  });

  it("counts a partially filled slot as adopted, not filled", async () => {
    const levels: GridLevel[] = [
      { price: 100, filled: false, buyOrderId: "restored-1" },
    ];
    const manager = new OrderManager(levels, ids, 1);
    const exchange = fakeExchange({
      getOrder: async orderId => ({
        orderId,
        status: "OPEN",
        executedQuantity: 0.5,
      }),
      listOpenOrders: async () => [
        { orderId: "restored-1", symbol: SYMBOL, status: "OPEN" },
      ],
    });
    const service = new OrderReconciliationService(
      "bot-x",
      exchange,
      SYMBOL,
      manager
    );

    const report = await service.reconcileSymbol();

    expect(report.adopted).toBe(1);
    expect(report.filled).toBe(0);
    expect(report.orphans).toHaveLength(0);
    expect(levels[0].heldQty).toBeCloseTo(0.5, 8);
  });
});
