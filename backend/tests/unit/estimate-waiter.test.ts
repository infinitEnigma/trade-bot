/**
 * The `ESTIMATE_READY` waiter registry — the correlation mechanism between a
 * preparation request and the engine's response.
 *
 * The rules under test are the ones that keep a preparation from becoming an
 * admitted run by accident: register before publishing, correlate exactly,
 * bound every wait, always clean up, and never resolve a waiter from a late
 * or superseded estimate.
 */

import {
  EstimateWaitTimeoutError,
  EstimateWaiterRegistry,
  type EstimateReadyPayload,
} from "../../src/core/bots/lifecycle/estimate-waiter";

const KEY = {
  botId: "bot-1",
  runId: "run-1",
  preparationVersion: 1,
  correlationId: "corr-1",
};

function payload(
  overrides: Partial<EstimateReadyPayload> = {}
): EstimateReadyPayload {
  return {
    botId: "bot-1",
    runId: "run-1",
    preparationVersion: 1,
    symbol: "BTC",
    gridSize: 10,
    orderQuantity: 1,
    priceUsed: 100,
    estimatedRestingNotional: 607.5,
    perOrderNotional: 102.5,
    ...overrides,
  };
}

describe("EstimateWaiterRegistry", () => {
  // With maxWorkers: 1, all test suites share one process. An orphaned
  // waiter timer (or its promise rejection) from a finished suite can
  // crash a later suite. Track every registry we create so we can drain
  // any leftover waiters in case a test forgets to clean up.
  const registries: EstimateWaiterRegistry[] = [];

  afterEach(() => {
    while (registries.length > 0) {
      registries.pop()!.cancelAll("test cleanup");
    }
  });

  it("resolves the waiter when the matching estimate arrives", async () => {
    const registry = new EstimateWaiterRegistry();
    registries.push(registry);
    const wait = registry.waitForEstimate(KEY, 1000);

    expect(registry.deliverEstimate(payload(), "corr-1")).toBe(true);
    await expect(wait).resolves.toMatchObject({
      runId: "run-1",
      estimatedRestingNotional: 607.5,
    });
  });

  it("removes the registry entry once resolved", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 1000);
    expect(registry.pendingCount).toBe(1);
    registry.deliverEstimate(payload(), "corr-1");
    await wait;
    expect(registry.pendingCount).toBe(0);
  });

  it("ignores an estimate for another run", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 1000);

    expect(
      registry.deliverEstimate(payload({ runId: "run-2" }), "corr-1")
    ).toBe(false);
    // The waiter is still pending — it was not resolved by the wrong event.
    expect(registry.pendingCount).toBe(1);

    registry.deliverEstimate(payload(), "corr-1");
    await expect(wait).resolves.toMatchObject({ runId: "run-1" });
  });

  it("ignores an estimate for another bot", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 1000);
    expect(
      registry.deliverEstimate(payload({ botId: "bot-2" }), "corr-1")
    ).toBe(false);
    expect(registry.pendingCount).toBe(1);
    registry.deliverEstimate(payload(), "corr-1");
    await wait;
  });

  it("accepts the engine-assigned version when command correlation matches", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(
      { botId: "bot-1", runId: "run-1", correlationId: "corr-1" },
      1000
    );

    expect(
      registry.deliverEstimate(payload({ preparationVersion: 7 }), "corr-2")
    ).toBe(false);
    expect(
      registry.deliverEstimate(payload({ preparationVersion: 7 }), "corr-1")
    ).toBe(true);
    await expect(wait).resolves.toMatchObject({ preparationVersion: 7 });
  });

  it("ignores a superseded preparation version", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 1000);
    expect(
      registry.deliverEstimate(payload({ preparationVersion: 0 }), "corr-1")
    ).toBe(false);
    expect(registry.pendingCount).toBe(1);
    registry.deliverEstimate(payload(), "corr-1");
    await wait;
  });

  it("rejects on timeout and cleans up the entry", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 20);
    await expect(wait).rejects.toBeInstanceOf(EstimateWaitTimeoutError);
    expect(registry.pendingCount).toBe(0);
  });

  it("does not resolve a waiter that already timed out", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 20);
    await expect(wait).rejects.toBeInstanceOf(EstimateWaitTimeoutError);

    // A late estimate arrives after the timeout: it must resolve nothing.
    expect(registry.deliverEstimate(payload(), "corr-1")).toBe(false);
    expect(registry.pendingCount).toBe(0);
  });

  it("cancels a wait and refuses a later estimate", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 1000);
    registry.cancelWait(KEY, "publication failed");
    await expect(wait).rejects.toThrow(/publication failed/);
    expect(registry.pendingCount).toBe(0);
    expect(registry.deliverEstimate(payload(), "corr-1")).toBe(false);
  });

  it("refuses a duplicate waiter for the same preparation", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 1000);
    expect(() => registry.waitForEstimate(KEY, 1000)).toThrow(
      /already registered/
    );

    // The first waiter is never resolved by this test. Clean it up explicitly
    // so the 1000ms timer cannot fire as an unhandled promise rejection in a
    // later suite — with maxWorkers: 1, all suites share one process.
    registry.cancelWait(KEY, "test cleanup");
    await expect(wait).rejects.toThrow(/test cleanup/);
  });

  it("resolves several concurrent waits independently", async () => {
    const registry = new EstimateWaiterRegistry();
    const first = registry.waitForEstimate({ ...KEY, runId: "run-1" }, 1000);
    const second = registry.waitForEstimate({ ...KEY, runId: "run-2" }, 1000);
    expect(registry.pendingCount).toBe(2);

    registry.deliverEstimate(payload({ runId: "run-2" }), "corr-1");
    await expect(second).resolves.toMatchObject({ runId: "run-2" });
    expect(registry.pendingCount).toBe(1);

    registry.deliverEstimate(payload({ runId: "run-1" }), "corr-1");
    await expect(first).resolves.toMatchObject({ runId: "run-1" });
  });

  it("abandons every pending wait on cancelAll", async () => {
    const registry = new EstimateWaiterRegistry();
    const wait = registry.waitForEstimate(KEY, 1000);
    registry.cancelAll("shutting down");
    await expect(wait).rejects.toThrow(/shutting down/);
    expect(registry.pendingCount).toBe(0);
  });
});
