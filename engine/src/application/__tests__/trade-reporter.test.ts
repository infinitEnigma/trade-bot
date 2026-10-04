/**
 * Ledger reporter fill identity (Phase 4, risk A1/A6).
 *
 * The reporter turns a fill's cumulative-qty segment into the `fill_id` the
 * backend dedups on, so two segments of one order can never collapse onto a
 * single ledger row — while a whole-order fill keeps the byte-identical
 * pre-Phase-4 id, so rows booked before the upgrade still dedup against a
 * re-detection of the same fill. The segment is identity input only: the
 * event contract carries the resulting `fillId`, never the bounds.
 *
 * @format
 */

import { FillReport, LedgerTradeReporter } from "../trade-reporter";
import { RedisStreamOperations } from "../../infrastructure/redis/streams";
import { synthesizeFillId } from "../../utils/fill-id";
import { TradeExecutedEventPayload } from "@trade-bot/shared";

const BOT = "bot-1";
const CLIENT = "bot1-00-B";
const EXCHANGE = "idx-1";

function makeStream() {
  return {
    publish: jest.fn().mockResolvedValue({ success: true, id: "1-0" }),
  };
}

function makeReporter(stream = makeStream()) {
  return {
    reporter: new LedgerTradeReporter(
      stream as unknown as RedisStreamOperations,
      "engine-1",
      7
    ),
    stream,
  };
}

function fill(overrides: Partial<FillReport> = {}): FillReport {
  return {
    botId: BOT,
    symbol: "PERP_BTC_USDC",
    side: "BUY",
    price: 100,
    quantity: 1,
    status: "FILLED",
    clientOrderId: CLIENT,
    exchangeOrderId: EXCHANGE,
    executedAt: "2026-10-03T10:00:00.000Z",
    ...overrides,
  };
}

/** The TRADE_EXECUTED payload the reporter published. */
function publishedPayload(stream: {
  publish: jest.Mock;
}): TradeExecutedEventPayload {
  const message = stream.publish.mock.calls[0][1] as {
    type: string;
    payload: TradeExecutedEventPayload;
  };
  expect(message.type).toBe("TRADE_EXECUTED");
  return message.payload;
}

describe("LedgerTradeReporter fill identity (Phase 4)", () => {
  it("keeps the pre-Phase-4 id for a whole-order segment (A6)", async () => {
    const { reporter, stream } = makeReporter();

    await reporter.reportFill(fill({ segment: { from: 0, to: 1, full: 1 } }));

    expect(publishedPayload(stream).fillId).toBe(
      synthesizeFillId(BOT, CLIENT, EXCHANGE)
    );
  });

  it("mints a distinct id per segment of one order (A1: no collapse)", async () => {
    const first = makeReporter();
    const second = makeReporter();

    await first.reporter.reportFill(
      fill({
        quantity: 0.4,
        status: "PARTIALLY_FILLED",
        segment: { from: 0, to: 0.4, full: 1 },
      })
    );
    await second.reporter.reportFill(
      fill({
        quantity: 0.6,
        segment: { from: 0.4, to: 1, full: 1 },
      })
    );

    const firstId = publishedPayload(first.stream).fillId;
    const secondId = publishedPayload(second.stream).fillId;
    expect(firstId).not.toBe(secondId);
    // …and both differ from the whole-order id they would otherwise share.
    expect(firstId).not.toBe(synthesizeFillId(BOT, CLIENT, EXCHANGE));
    expect(secondId).not.toBe(synthesizeFillId(BOT, CLIENT, EXCHANGE));
    expect(firstId).toBe(
      synthesizeFillId(BOT, CLIENT, EXCHANGE, { from: 0, to: 0.4, full: 1 })
    );
  });

  it("carries the segment status into the payload, never the segment itself", async () => {
    const { reporter, stream } = makeReporter();

    await reporter.reportFill(
      fill({
        quantity: 0.25,
        status: "PARTIALLY_FILLED",
        segment: { from: 0.5, to: 0.75, full: 1 },
      })
    );

    const payload = publishedPayload(stream);
    expect(payload.status).toBe("PARTIALLY_FILLED");
    expect(payload.quantity).toBe(0.25);
    expect(payload).not.toHaveProperty("segment");
    // Authority stamping is untouched by the new field.
    expect(payload.engineId).toBe("engine-1");
    expect(payload.engineEpoch).toBe(7);
  });

  it("degrades to the legacy id when a caller passes no segment", async () => {
    const { reporter, stream } = makeReporter();

    await reporter.reportFill(fill());

    expect(publishedPayload(stream).fillId).toBe(
      synthesizeFillId(BOT, CLIENT, EXCHANGE)
    );
  });
});
