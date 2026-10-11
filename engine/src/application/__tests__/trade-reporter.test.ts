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

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FillReport, LedgerTradeReporter } from "../trade-reporter";
import { RedisStreamOperations } from "../../infrastructure/redis/streams";
import { listPendingFills } from "../../infrastructure/state/pending-fill-journal";
import { synthesizeFillId } from "../../utils/fill-id";
import { TradeExecutedEventPayload } from "@trade-bot/shared";

const BOT = "bot-1";
const CLIENT = "bot1-00-B";
const EXCHANGE = "idx-1";

let snapTmpDir: string | undefined;

beforeEach(() => {
  // reportFill journals to GRID_SNAPSHOT_DIR (F1) — keep it out of the repo.
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trade-reporter-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
});

afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) {
    fs.rmSync(snapTmpDir, { recursive: true, force: true });
    snapTmpDir = undefined;
  }
});

function makeStream() {
  return {
    publish: jest.fn().mockResolvedValue({ success: true, id: "1-0" }),
  };
}

function makeReporter(stream: ReturnType<typeof makeStream> = makeStream()) {
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

  describe("LedgerTradeReporter durable fill journal (F1)", () => {
    /** A stream whose publish always fails (Redis outage). */
    function makeFailingStream() {
      return {
        publish: jest.fn().mockResolvedValue({ success: false, error: "down" }),
      };
    }

    it("clears the journal entry after an accepted publish", async () => {
      const { reporter } = makeReporter();

      await reporter.reportFill(fill());

      expect(listPendingFills()).toEqual([]);
    });

    it("keeps the journal entry when the publish fails (durable outbox)", async () => {
      const { reporter } = makeReporter(makeFailingStream());

      await reporter.reportFill(fill({ segment: { from: 0, to: 1, full: 1 } }));

      const pending = listPendingFills();
      expect(pending).toHaveLength(1);
      expect(pending[0].fillId).toBe(
        synthesizeFillId(BOT, CLIENT, EXCHANGE, { from: 0, to: 1, full: 1 })
      );
      // The journaled payload is the published one, minus engine identity
      // (replay restamps it from the live process).
      expect(pending[0].payload).toMatchObject({
        botId: BOT,
        clientOrderId: CLIENT,
        side: "BUY",
        price: 100,
        quantity: 1,
      });
      expect(pending[0].payload).not.toHaveProperty("engineId");
      expect(pending[0].payload).not.toHaveProperty("engineEpoch");
    });

    it("survives a restart: a fresh reporter replays the journaled fill under the live identity", async () => {
      // "Restart": a new process (new reporter, bumped epoch) with Redis back.
      const outageStream = makeFailingStream();
      const first = makeReporter(outageStream);
      await first.reporter.reportFill(fill());

      const stream = makeStream();
      const restarted = new LedgerTradeReporter(
        stream as unknown as RedisStreamOperations,
        "engine-1",
        8
      );

      const replayed = await restarted.replayPendingFills();
      expect(replayed).toEqual({ replayed: 1, remaining: 0 });
      const message = stream.publish.mock.calls[0][1] as {
        type: string;
        payload: TradeExecutedEventPayload;
      };
      expect(message.type).toBe("TRADE_EXECUTED");
      // Live identity, original fill identity: authority passes, dedup holds.
      expect(message.payload.engineEpoch).toBe(8);
      expect(message.payload.fillId).toBe(
        synthesizeFillId(BOT, CLIENT, EXCHANGE)
      );
      expect(message.payload.quantity).toBe(1);
      expect(listPendingFills()).toEqual([]);
    });

    it("rejects the fill when the journal write fails (fail-closed)", async () => {
      // Simulate an unwritable snapshot dir: journalPendingFill returns false
      // and reportFill must reject so the gap is explicit, not log-only.
      const { reporter } = makeReporter();
      const journal =
        await import("../../infrastructure/state/pending-fill-journal");
      const spy = jest
        .spyOn(journal, "journalPendingFill")
        .mockReturnValue(false);
      try {
        await expect(
          reporter.reportFill(fill({ segment: { from: 0, to: 1, full: 1 } }))
        ).rejects.toThrow(/could not be journaled/);
      } finally {
        spy.mockRestore();
      }
    });

    it("returns replayed/remaining so the session gate can refuse to trade", async () => {
      // Two journaled fills via a failing stream.
      const outage = makeFailingStream();
      const first = makeReporter(outage);
      await first.reporter.reportFill(
        fill({ segment: { from: 0, to: 0.4, full: 1 }, quantity: 0.4 })
      );
      await first.reporter.reportFill(
        fill({ segment: { from: 0.4, to: 1, full: 1 }, quantity: 0.6 })
      );
      expect(listPendingFills()).toHaveLength(2);

      // Replay into a still-down Redis: nothing is cleared, order preserved.
      const stillDown = makeReporter(makeFailingStream());
      const result = await stillDown.reporter.replayPendingFills();

      expect(result).toEqual({ replayed: 0, remaining: 2 });
      expect(listPendingFills()).toHaveLength(2);
    });

    it("replaying against an empty journal is a no-op", async () => {
      const { reporter, stream } = makeReporter();

      await expect(reporter.replayPendingFills()).resolves.toEqual({
        replayed: 0,
        remaining: 0,
      });
      expect(stream.publish).not.toHaveBeenCalled();
    });
  });
});
