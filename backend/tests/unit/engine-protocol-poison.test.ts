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
