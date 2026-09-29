/** @format */

import {
  runWithBackgroundContext,
  runWithContext,
  getCorrelationId,
  getCurrentContext,
  getBackgroundContext,
  clearBackgroundContextsForTests,
  setRequestContext,
} from "../../src/shared/utils/context";

describe("L8/L9 background context scopes", () => {
  beforeEach(() => {
    clearBackgroundContextsForTests();
  });

  it("gives each subsystem a stable greppable scope", () => {
    const redis = getBackgroundContext("redis");
    const pool = getBackgroundContext("db-pool");
    expect(redis.correlationId).toMatch(/^bg_redis_[0-9a-f]{8}$/);
    expect(pool.correlationId).toMatch(/^bg_db-pool_[0-9a-f]{8}$/);
    // Stable: same object on repeat lookup, so operationDuration is
    // time-since-scope-start rather than time-since-boot/login.
    expect(getBackgroundContext("redis")).toBe(redis);
  });

  it("does not inherit the ambient boot/request context", async () => {
    setRequestContext({ correlationId: "req_ambient", requestId: "rid_a" });
    const seen = await runWithBackgroundContext("redis-consumer", () => {
      return {
        correlationId: getCorrelationId(),
        requestId: getCurrentContext()?.requestId,
      };
    });
    expect(seen.correlationId).toMatch(/^bg_redis-consumer_/);
    expect(seen.requestId).toBe("bg_redis-consumer");
    // Ambient untouched after the scoped run.
    expect(getCorrelationId()).toBe("req_ambient");
  });

  it("runWithContext no longer leaks into the ambient chain (L7 root cause)", async () => {
    setRequestContext({ correlationId: "req_outer", requestId: "rid_outer" });
    await runWithContext(
      { correlationId: "req_inner", requestId: "rid_inner" },
      async () => {
        await new Promise(resolve => setImmediate(resolve));
        expect(getCorrelationId()).toBe("req_inner");
      }
    );
    await new Promise(resolve => setImmediate(resolve));
    expect(getCorrelationId()).toBe("req_outer");
  });
});
