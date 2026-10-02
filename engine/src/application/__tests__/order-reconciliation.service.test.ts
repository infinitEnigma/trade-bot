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
  getOrder?: (orderId: string) => Promise<{ orderId: string; status: string }>;
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
  const manager = new OrderManager(levels, ids);
  const exchange = fakeExchange(script);
  const service = new OrderReconciliationService(
    "bot-x",
    exchange,
    SYMBOL,
    ids,
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
    const manager = new OrderManager(levels, ids);
    const exchange = fakeExchange({
      listOpenOrders: async () => [
        { orderId: "restored-1", symbol: SYMBOL, status: "OPEN" },
      ],
    });
    const service = new OrderReconciliationService(
      "bot-x",
      exchange,
      SYMBOL,
      ids,
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
      base.ids,
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
      base.ids,
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
