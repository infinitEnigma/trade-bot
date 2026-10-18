/**
 * L22 / L25 - the backend's engine-event consumer must not spin on a poison
 * event.
 *
 * L25 produced one live: a `COMMAND_FAILED` for an already-terminal bot threw
 * `Invalid bot state transition: STOPPED -> ERROR`, the message was left
 * unacked, and the same messageId redelivered every ~60 s (12 times in 11
 * minutes, then 29 more on demand) until the consumer was killed.
 *
 * The handler-level fix is in `bot-event-processor` (a failure for a bot that
 * cannot fail further is bookkeeping); this suite pins the consumer-level cap
 * that bounds *any* handler that keeps throwing: below the threshold the entry
 * stays pending for the normal recovery path, at the threshold it is
 * alert-and-dropped.
 *
 * @format
 */

import { BotEvent, createBotEvent } from "@trade-bot/shared";
import {
  EngineProtocolService,
  PENDING_POISON_MAX_DELIVERIES,
} from "../../src/core/bots/engine-protocol.service";
import {
  RedisConnectionManager,
  RedisStreamOperations,
} from "../../src/infrastructure/cache/redis";

jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
  redisLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

/** Private members the consumer loop keeps, reached from the test. */
type ServiceInternals = {
  eventHandler: ((event: BotEvent) => Promise<void> | void) | null;
  processEventMessage: (streamId: string, data: unknown) => Promise<void>;
};

function makeStreamOps(deliveries: number): {
  acks: string[];
  ops: RedisStreamOperations;
  raw: {
    ack: jest.Mock;
    isMessageProcessed: jest.Mock;
    markMessageProcessed: jest.Mock;
    getPendingDeliveries: jest.Mock;
  };
} {
  const acks: string[] = [];
  const raw = {
    ack: jest.fn(async (_stream: string, _group: string, id: string) => {
      acks.push(id);
      return { success: true as const };
    }),
    isMessageProcessed: jest.fn(async () => false),
    markMessageProcessed: jest.fn(async () => true),
    getPendingDeliveries: jest.fn(async () => deliveries),
  };
  return { acks, ops: raw as unknown as RedisStreamOperations, raw };
}

/** The live L25 shape: a stop failure reported for a bot already STOPPED. */
function failingEvent(): BotEvent {
  return createBotEvent(
    "COMMAND_FAILED",
    {
      botId: "bot-1",
      engineId: "engine-1",
      engineEpoch: 19,
      commandType: "BOT_STOP",
      errorCode: "BOT_NOT_FOUND",
      message: "Bot not found",
    } as never,
    "corr-1"
  );
}

/** Build a valid ledger event of the given type for poison-cap tests. */
function makeLedgerEvent(
  type:
    | "ORDER_INTENT"
    | "TRADE_EXECUTED"
    | "POSITION_UPDATED"
    | "PERFORMANCE_SNAPSHOT",
  correlationId = "corr-ledger"
): BotEvent {
  const base = {
    botId: "bot-1",
    engineId: "engine-1",
    engineEpoch: 1,
  };
  const payload =
    type === "TRADE_EXECUTED"
      ? {
          ...base,
          symbol: "ETH",
          side: "BUY",
          price: 100,
          quantity: 1,
          clientOrderId: "c-1",
          exchangeOrderId: "e-1",
          fillId: "f-1",
          executedAt: "2026-10-02T10:00:00.000Z",
        }
      : type === "ORDER_INTENT"
        ? {
            ...base,
            symbol: "ETH",
            side: "BUY",
            price: 100,
            quantity: 1,
            clientOrderId: "c-1",
          }
        : type === "POSITION_UPDATED"
          ? {
              ...base,
              symbol: "ETH",
              side: "LONG",
              quantity: 1,
              entryPrice: 100,
              markPrice: 100,
              pnl: 0,
            }
          : { ...base, metrics: { totalTrades: 1, totalPnl: 0 } };
  return createBotEvent(type, payload as never, correlationId);
}

function makeService(ops: RedisStreamOperations): EngineProtocolService {
  return new EngineProtocolService({
    streamOperations: ops,
    connectionManager: {} as unknown as RedisConnectionManager,
    consumerName: "test-consumer",
  });
}

describe("engine-protocol event consumer poison cap (L22/L25)", () => {
  it("ACKs an event the handler processed successfully", async () => {
    const { acks, ops } = makeStreamOps(1);
    const service = makeService(ops);
    const internals = service as unknown as ServiceInternals;
    const handled: string[] = [];
    internals.eventHandler = event => {
      handled.push(event.type);
    };

    await internals.processEventMessage("1-0", failingEvent());

    expect(handled).toEqual(["COMMAND_FAILED"]);
    expect(acks).toEqual(["1-0"]);
  });

  it("leaves the event unacked while it is still under the poison threshold", async () => {
    const { acks, ops, raw } = makeStreamOps(1);
    const service = makeService(ops);
    const internals = service as unknown as ServiceInternals;
    internals.eventHandler = () =>
      Promise.reject(
        new Error("Invalid bot state transition: STOPPED -> ERROR")
      );

    await internals.processEventMessage("1-1", failingEvent());

    // Still pending: recoverPending may reclaim it once the handler is fixed.
    expect(acks).toEqual([]);
    expect(raw.markMessageProcessed).not.toHaveBeenCalled();
  });

  it("ACKs and drops the event once it reaches the poison threshold", async () => {
    const { acks, ops, raw } = makeStreamOps(PENDING_POISON_MAX_DELIVERIES);
    const service = makeService(ops);
    const internals = service as unknown as ServiceInternals;
    internals.eventHandler = () =>
      Promise.reject(
        new Error("Invalid bot state transition: STOPPED -> ERROR")
      );

    await internals.processEventMessage("1-2", failingEvent());

    expect(acks).toEqual(["1-2"]);
    // Marked processed too, so a later duplicate is deduped instead of
    // resurrecting the same failure.
    expect(raw.markMessageProcessed).toHaveBeenCalledTimes(1);
    expect(raw.getPendingDeliveries).toHaveBeenCalledWith(
      "tradebot:engine:events",
      "backend-group",
      "1-2"
    );
  });

  it.each([
    "ORDER_INTENT",
    "TRADE_EXECUTED",
    "POSITION_UPDATED",
    "PERFORMANCE_SNAPSHOT",
  ] as const)(
    "ledger event %s is left pending at the poison threshold — not marked processed or ACKed",
    async type => {
      const { acks, ops, raw } = makeStreamOps(PENDING_POISON_MAX_DELIVERIES);
      const service = makeService(ops);
      const internals = service as unknown as ServiceInternals;
      internals.eventHandler = () =>
        Promise.reject(new Error("persistence failure"));

      await internals.processEventMessage("1-2-ledger", makeLedgerEvent(type));

      expect(acks).toEqual([]);
      expect(raw.markMessageProcessed).not.toHaveBeenCalled();
      // The event stays in the PEL so pending-event recovery can redeliver it
      // once the persistence problem is fixed.
      expect(raw.getPendingDeliveries).toHaveBeenCalledWith(
        "tradebot:engine:events",
        "backend-group",
        "1-2-ledger"
      );
    }
  );

  it("retries and acknowledges a ledger event once persistence is restored", async () => {
    const { acks, ops, raw } = makeStreamOps(PENDING_POISON_MAX_DELIVERIES);
    const service = makeService(ops);
    const internals = service as unknown as ServiceInternals;

    // First delivery: persistence fails at the poison threshold. The ledger
    // event must stay pending — not marked processed, not ACKed.
    let attempts = 0;
    internals.eventHandler = () => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error("persistence failure"));
      }
      return Promise.resolve();
    };

    await internals.processEventMessage(
      "1-4-recovery",
      makeLedgerEvent("TRADE_EXECUTED")
    );

    expect(acks).toEqual([]);
    expect(raw.markMessageProcessed).not.toHaveBeenCalled();

    // Persistence restored: redelivery succeeds, so the event is marked
    // processed and acknowledged exactly once.
    await internals.processEventMessage(
      "1-4-recovery",
      makeLedgerEvent("TRADE_EXECUTED")
    );

    expect(acks).toEqual(["1-4-recovery"]);
    expect(raw.markMessageProcessed).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
  });

  it("keeps retrying when the delivery counter cannot be read (fail open)", async () => {
    const { acks, ops, raw } = makeStreamOps(1);
    raw.getPendingDeliveries.mockRejectedValue(new Error("redis down"));
    const service = makeService(ops);
    const internals = service as unknown as ServiceInternals;
    internals.eventHandler = () => Promise.reject(new Error("handler blew up"));

    await internals.processEventMessage("1-3", failingEvent());

    expect(acks).toEqual([]);
  });
});
