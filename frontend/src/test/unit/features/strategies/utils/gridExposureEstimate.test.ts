/** @format */

import { describe, expect, it } from "vitest";
import {
  extractFreshGridReferencePrice,
  GRID_REFERENCE_PRICE_MAX_AGE_MS,
} from "../../../../../features/strategies/utils/gridExposureEstimate";

const nowMs = 1_800_000_000_000;
const freshResponse = (timestampMs: number, close: number = 100) => ({
  success: true,
  stale: false,
  freshness: { isStale: false, dataSource: "api" },
  data: {
    t: [Math.floor(timestampMs / 1000)],
    c: [close],
  },
});

describe("extractFreshGridReferencePrice", () => {
  it("returns the latest fresh positive venue candle close", () => {
    expect(
      extractFreshGridReferencePrice(
        freshResponse(nowMs - 30_000, 123.45),
        nowMs
      )
    ).toEqual({
      price: 123.45,
      timestampMs: nowMs - 30_000,
      dataSource: "api",
    });
  });

  it("rejects responses without explicit freshness metadata", () => {
    const response = freshResponse(nowMs - 30_000);
    delete (response as { freshness?: unknown }).freshness;
    expect(extractFreshGridReferencePrice(response, nowMs)).toBeNull();
  });

  it("rejects a response marked stale", () => {
    const response = freshResponse(nowMs - 30_000);
    response.freshness.isStale = true;
    expect(extractFreshGridReferencePrice(response, nowMs)).toBeNull();
  });

  it("rejects a candle older than the freshness budget", () => {
    expect(
      extractFreshGridReferencePrice(
        freshResponse(nowMs - GRID_REFERENCE_PRICE_MAX_AGE_MS - 1),
        nowMs
      )
    ).toBeNull();
  });

  it("rejects invalid prices and timestamps", () => {
    expect(
      extractFreshGridReferencePrice(freshResponse(nowMs - 10_000, 0), nowMs)
    ).toBeNull();
    expect(
      extractFreshGridReferencePrice(
        {
          ...freshResponse(nowMs - 10_000),
          data: { t: [NaN], c: [100] },
        },
        nowMs
      )
    ).toBeNull();
  });

  it("rejects implausibly future-dated candles", () => {
    expect(
      extractFreshGridReferencePrice(freshResponse(nowMs + 61_000), nowMs)
    ).toBeNull();
  });

  it("does not fall back when the newest candle has an invalid close", () => {
    expect(
      extractFreshGridReferencePrice(
        {
          success: true,
          freshness: { isStale: false },
          data: {
            t: [
              Math.floor((nowMs - 20_000) / 1000),
              Math.floor((nowMs - 10_000) / 1000),
            ],
            c: [101, 0],
          },
        },
        nowMs
      )
    ).toBeNull();
  });
});
