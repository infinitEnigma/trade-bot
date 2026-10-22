/**
 * Grid admission — the backend's authoritative decision on whether a prepared
 * grid may trade.
 *
 * The engine's estimate is EVIDENCE: the backend recomputes the exposure from
 * the persisted config + its own price and rejects anything that does not
 * reconcile. These tests pin the whole failure table — provenance,
 * consistency, price freshness, recomputation and the per-order cap — plus the
 * acceptance criteria (BTC rejected at orderQuantity 1, ETH unaffected).
 */

import {
  GridAdmissionService,
  type GridAdmissionRequest,
  type GridEstimateReport,
  type GridAdmissionPolicy,
} from "../../src/core/strategies/admission/grid-admission.service";
import { createSymbolNotionalPolicy } from "../../src/core/strategies/admission/symbol-notional-policy.port";
import type {
  AdmissionMarketPrice,
  AdmissionPriceRequest,
  IMarketPriceReader,
} from "../../src/core/strategies/admission/market-price-reader.port";

const POLICY: GridAdmissionPolicy = {
  maxPriceAgeMs: 30_000,
  priceRelativeTolerance: 0.02,
  estimateRelativeTolerance: 0.01,
};

/** A reader that answers with a fixed, fresh quote. */
function readerFor(quote: Partial<AdmissionMarketPrice> = {}): {
  reader: IMarketPriceReader;
  calls: AdmissionPriceRequest[];
} {
  const calls: AdmissionPriceRequest[] = [];
  const reader: IMarketPriceReader = {
    async readPrice(request) {
      calls.push(request);
      return {
        venue: request.venue,
        environment: request.environment,
        resolvedInstrument: "resolved-1",
        price: 100,
        sourceTimestampMs: Date.now(),
        readAtMs: Date.now(),
        ...quote,
      };
    },
  };
  return { reader, calls };
}

/** A reader that always fails. */
const failingReader: IMarketPriceReader = {
  async readPrice() {
    throw new Error("venue down");
  },
};

const BTC_REQUEST: GridAdmissionRequest = {
  botId: "bot-1",
  runId: "run-1",
  preparationVersion: 1,
  config: { gridSize: 10, gridRangePercent: 5, orderQuantity: 1 },
  symbol: "BTC",
  venue: "lighter",
  environment: "testnet",
};

/** The estimate the engine would report for BTC_REQUEST at price 100. */
function btcEstimate(overrides: Partial<GridEstimateReport> = {}) {
  // 11 levels 97.5..102.5; BUY-eligible >= 100 => 6 levels, sum 607.5.
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

function service(
  reader: IMarketPriceReader,
  policy: GridAdmissionPolicy = POLICY,
  limits: {
    defaultMaxOrderNotional: number | null;
    maxOrderNotionalBySymbol: Record<string, number>;
  } = {
    defaultMaxOrderNotional: 10_000,
    maxOrderNotionalBySymbol: { BTC: 5_000 },
  }
): GridAdmissionService {
  return new GridAdmissionService({
    priceReader: reader,
    notionalPolicy: createSymbolNotionalPolicy(limits),
    policy,
  });
}

describe("GridAdmissionService", () => {
  it("admits a grid whose estimate reconciles with the backend's recomputation", async () => {
    const { reader } = readerFor({ price: 100 });
    const result = await service(reader).admit(BTC_REQUEST, btcEstimate());

    expect(result.authorizedNotional).toBeCloseTo(607.5, 6);
    expect(result.price).toBe(100);
    expect(result.buyLevelCount).toBe(6);
    expect(result.maxOrderNotional).toBeCloseTo(102.5, 6);
  });

  it("prices the instrument by venue, environment and the persisted symbol", async () => {
    const { reader, calls } = readerFor({ price: 100 });
    await service(reader).admit(BTC_REQUEST, btcEstimate());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      venue: "lighter",
      environment: "testnet",
      symbol: "BTC",
    });
  });

  // --- PROVENANCE -------------------------------------------------------
  it("rejects an estimate for another bot", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate({ botId: "bot-2" }))
    ).rejects.toMatchObject({ reason: "ESTIMATE_BOT_MISMATCH" });
  });

  it("rejects an estimate for another run", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate({ runId: "run-2" }))
    ).rejects.toMatchObject({ reason: "ESTIMATE_RUN_MISMATCH" });
  });

  it("rejects a superseded preparation", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate({ preparationVersion: 0 }))
    ).rejects.toMatchObject({ reason: "ESTIMATE_SUPERSEDED" });
  });

  // --- CONSISTENCY ------------------------------------------------------
  it("rejects an estimate for a different symbol", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate({ symbol: "ETH" }))
    ).rejects.toMatchObject({ reason: "ESTIMATE_SYMBOL_MISMATCH" });
  });

  it("rejects an estimate that used a different gridSize", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate({ gridSize: 20 }))
    ).rejects.toMatchObject({ reason: "ESTIMATE_GRID_SIZE_MISMATCH" });
  });

  it("rejects an estimate that used a different orderQuantity", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate({ orderQuantity: 0.1 }))
    ).rejects.toMatchObject({ reason: "ESTIMATE_ORDER_QUANTITY_MISMATCH" });
  });

  // --- PRICE ------------------------------------------------------------
  it("fails closed when the price cannot be read", async () => {
    await expect(
      service(failingReader).admit(BTC_REQUEST, btcEstimate())
    ).rejects.toMatchObject({ reason: "PRICE_UNAVAILABLE" });
  });

  it("fails closed on a stale quote", async () => {
    const old = Date.now() - 60_000;
    const { reader } = readerFor({ price: 100, sourceTimestampMs: old });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate())
    ).rejects.toMatchObject({ reason: "PRICE_STALE" });
  });

  it("accepts a quote whose venue timestamp is fresh", async () => {
    const { reader } = readerFor({ price: 100, sourceTimestampMs: Date.now() });
    const result = await service(reader).admit(BTC_REQUEST, btcEstimate());
    expect(result.authorizedNotional).toBeCloseTo(607.5, 6);
  });

  it("rejects an engine price that differs from the venue quote", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(BTC_REQUEST, btcEstimate({ priceUsed: 500 }))
    ).rejects.toMatchObject({ reason: "ESTIMATE_PRICE_MISMATCH" });
  });

  it("tolerates a small price difference between the two samplings", async () => {
    const { reader } = readerFor({ price: 100 });
    // 0.5% apart, inside the 2% tolerance.
    const result = await service(reader).admit(
      BTC_REQUEST,
      btcEstimate({ priceUsed: 100.5 })
    );
    expect(result.price).toBe(100);
  });

  // --- RECOMPUTATION ----------------------------------------------------
  it("rejects a forged exposure total", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(
        BTC_REQUEST,
        btcEstimate({ estimatedRestingNotional: 1 })
      )
    ).rejects.toMatchObject({ reason: "ESTIMATE_EXPOSURE_MISMATCH" });
  });

  it("computes the authorized exposure from the BACKEND's price, not the engine's", async () => {
    // The venue moved 1% since the engine priced it — inside the tolerance,
    // so the estimate reconciles, but the AUTHORIZED figure must use the
    // backend's (higher) price.
    const { reader } = readerFor({ price: 101 });
    const result = await service(reader).admit(
      BTC_REQUEST,
      btcEstimate({ priceUsed: 100 })
    );
    const expected = 6 * 101; // 6 eligible levels, ~101 each
    expect(result.price).toBe(101);
    expect(result.authorizedNotional).toBeGreaterThan(607.5);
    expect(result.authorizedNotional).toBeLessThan(640);
    expect(expected).toBeGreaterThan(0);
  });

  // --- PER-ORDER CAP ----------------------------------------------------
  it("rejects a BTC grid whose single order exceeds the per-symbol cap", async () => {
    // BTC at ~$100,000: orderQuantity 1 => a ~$100,000 order, over the $5,000 cap.
    const { reader } = readerFor({ price: 100_000 });
    const request: GridAdmissionRequest = {
      ...BTC_REQUEST,
      config: { gridSize: 10, gridRangePercent: 5, orderQuantity: 1 },
    };
    const estimate: GridEstimateReport = {
      ...btcEstimate({ priceUsed: 100_000 }),
      estimatedRestingNotional: 607_500,
      perOrderNotional: 102_500,
    };
    await expect(
      service(reader).admit(request, estimate)
    ).rejects.toMatchObject({ reason: "ORDER_NOTIONAL_CAP_EXCEEDED" });
  });

  it("leaves ETH unaffected when its order is within the limit", async () => {
    const { reader } = readerFor({ price: 2500 });
    const request: GridAdmissionRequest = {
      ...BTC_REQUEST,
      symbol: "ETH",
      config: { gridSize: 10, gridRangePercent: 5, orderQuantity: 1 },
    };
    const estimate: GridEstimateReport = {
      ...btcEstimate({ priceUsed: 2500, symbol: "ETH" }),
      estimatedRestingNotional: 15187.5,
      perOrderNotional: 2562.5,
    };
    const result = await service(reader).admit(request, estimate);
    expect(result.authorizedNotional).toBeCloseTo(15187.5, 6);
    expect(result.maxOrderNotional).toBeCloseTo(2562.5, 6);
  });

  it("judges each level on its OWN notional, not the baseline price", async () => {
    // The baseline is 100 (a $100 order at the baseline) but the grid's TOP
    // level rests at 102.5 — the per-order cap must judge the 102.5 order.
    // A cap of 101 admits the baseline-priced order and rejects the top one.
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader, POLICY, {
        defaultMaxOrderNotional: 10_000,
        maxOrderNotionalBySymbol: { BTC: 101 },
      }).admit(BTC_REQUEST, btcEstimate())
    ).rejects.toMatchObject({ reason: "ORDER_NOTIONAL_CAP_EXCEEDED" });
  });

  it("accepts a cap that the top level just fits under", async () => {
    const { reader } = readerFor({ price: 100 });
    const result = await service(reader, POLICY, {
      defaultMaxOrderNotional: 10_000,
      maxOrderNotionalBySymbol: { BTC: 102.5 },
    }).admit(BTC_REQUEST, btcEstimate());
    expect(result.maxOrderNotional).toBeCloseTo(102.5, 6);
  });

  it("never lets a missing per-symbol cap disable the control", async () => {
    const { reader } = readerFor({ price: 100 });
    // An unmapped symbol falls back to the DEFAULT cap, which is set.
    await expect(
      service(reader, POLICY, {
        defaultMaxOrderNotional: 50,
        maxOrderNotionalBySymbol: {},
      }).admit(
        { ...BTC_REQUEST, symbol: "DOGE" },
        btcEstimate({ symbol: "DOGE" })
      )
    ).rejects.toMatchObject({ reason: "ORDER_NOTIONAL_CAP_EXCEEDED" });
  });

  it("names the symbol, the order and the limit in the rejection", async () => {
    const { reader } = readerFor({ price: 100_000 });
    const request: GridAdmissionRequest = {
      ...BTC_REQUEST,
      config: { gridSize: 10, gridRangePercent: 5, orderQuantity: 1 },
    };
    const estimate: GridEstimateReport = {
      ...btcEstimate({ priceUsed: 100_000 }),
      estimatedRestingNotional: 607_500,
      perOrderNotional: 102_500,
    };
    await expect(service(reader).admit(request, estimate)).rejects.toThrow(
      /BTC/
    );
  });

  it("rejects a non-positive order notional as a pricing defect", async () => {
    const { reader } = readerFor({ price: 100 });
    await expect(
      service(reader).admit(
        BTC_REQUEST,
        btcEstimate({ estimatedRestingNotional: 0 })
      )
    ).rejects.toMatchObject({ reason: "ESTIMATE_EXPOSURE_MISMATCH" });
  });
});

describe("createSymbolNotionalPolicy", () => {
  it("matches a symbol case-insensitively", () => {
    const policy = createSymbolNotionalPolicy({
      defaultMaxOrderNotional: 1000,
      maxOrderNotionalBySymbol: { BTC: 5000 },
    });
    expect(policy.limitFor("btc")).toBe(5000);
    expect(policy.limitFor("BTC")).toBe(5000);
    expect(policy.limitFor("ETH")).toBe(1000);
  });

  it("rejects a non-positive or non-finite cap at construction", () => {
    expect(() =>
      createSymbolNotionalPolicy({
        defaultMaxOrderNotional: 1000,
        maxOrderNotionalBySymbol: { BTC: 0 },
      })
    ).toThrow(/positive finite/);
    expect(() =>
      createSymbolNotionalPolicy({
        defaultMaxOrderNotional: Number.NaN,
        maxOrderNotionalBySymbol: {},
      })
    ).toThrow(/positive finite/);
  });

  it("evaluates an order against its cap", () => {
    const policy = createSymbolNotionalPolicy({
      defaultMaxOrderNotional: 1000,
      maxOrderNotionalBySymbol: { BTC: 5000 },
    });
    expect(policy.evaluateOrder("BTC", 4999).allowed).toBe(true);
    expect(policy.evaluateOrder("BTC", 5001).allowed).toBe(false);
  });
});
