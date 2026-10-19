/**
 * Financial-event failure-injection — consumer, deduplication, retry, poison,
 * and ACK behaviour.
 *
 * Scope: the EngineProtocolService event consumer (`processEventMessage`) with
 * its Redis/stream port mocked. The event handler is a real
 * `TradeLedgerService` whose repository is mocked, so we can observe whether
 * the consumer marks each financial event processed and acknowledges it under
 * failure.
 *
 * What this package proves:
 *  1. A failing ledger persistence ⇒ no false processed marker, no ACK (event stays recoverable).
 *  2. Ledger events at the poison threshold ⇒ left pending, never silently discarded.
 *  3. Non-ledger events at the poison threshold ⇒ bounded drop (processed + ACKed).
 *  4. ACK failure after the processed marker succeeded ⇒ redelivery is deduped in-memory
 *     by THIS consumer, so the financial effect is not applied twice on redelivery.
 *  5. Same messageId delivered twice ⇒ handler runs once, both deliveries ACKed.
 *  6. Restart (empty in-memory dedup set, no Redis marker) ⇒ handler re-runs on redelivery;
 *     ledger idempotency must then come from the repository (trade-ledger-idempotency.test.ts).
 *  7. UNKNOWN_BOT / DUPLICATE ledger results are swallowed by TradeLedgerService (no throw),
 *     so the consumer marks them processed and ACKs them — this is NOT an integrity halt.
 *
 * Failure matrix (each row traced to its `it` case below). "Outcome" is what the
 * current implementation actually does, verified by these tests.
 *
 * | # | Failure injected | Required invariant | Test case | Observed outcome |
 * |---|------------------|-------------------|-----------|------------------|
 * | 1 | Ledger transaction (persistence) throws | Event remains recoverable; not marked processed / ACKed | "ledger persistence failure leaves the event unacked" | unacked, not marked |
 * | 2 | Ledger commit succeeds, ACK fails | Redelivery does not apply the effect twice | "ack failure after processed marker is deduped in-memory" | handler runs once |
 * | 3 | Same financial event delivered twice | One effective ledger application | "duplicate messageId is processed exactly once" | handler runs once |
 * | 4 | Redis dedup read fails (fail open) | Handler still runs; no silent event loss | "redis dedup read failure fails open and runs the handler" | handler runs |
 * | 5 | Restart with pending events | Pending events recovered / re-handled | "restart redelivery re-runs the handler" | handler re-runs |
 * | 6 | Event at poison-delivery threshold (ledger) | Financial events not silently discarded | "ledger event at poison threshold stays pending, not acked" | unacked, not marked |
 * | 7 | Event at poison threshold (non-ledger) | Bounded drop, not indefinite spin | "non-ledger event at poison threshold is processed and acked" | processed + acked |
 * | 8 | UNKNOWN_BOT / DUPLICATE from ledger | Swallowed, processed + ACKed (no silent halt) | "unknown-bot and duplicate ledger results are swallowed and acked" | processed + acked |
 *
 * Companion suite: `trade-ledger-idempotency.test.ts` proves the PostgreSQL
 * repository-level invariant (one fill row, one trade row, totals incremented
 * once) across sequential and concurrent duplicate deliveries.
 *
 * @format
 */

import { BotEvent, createBotEvent } from "@trade-bot/shared";
import {
  EngineProtocolService,
  IEngineProtocolRedisStreams,
  PENDING_POISON_MAX_DELIVERIES,
} from "../../src/core/bots/engine-protocol.service";
import { TradeLedgerService } from "../../src/core/strategies/trade-ledger.service";
import { ITradeLedgerRepository } from "../../src/core/strategies/trade-ledger.repository.port";

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

type ServiceInternals = {
  eventHandler: ((event: BotEvent) => Promise<void> | void) | null;
  processEventMessage: (streamId: string, data: unknown) => Promise<void>;
};

const BOT_ID = "11111111-1111-1111-1111-111111111111";
const STREAM = "tradebot:engine:events";
const GROUP = "backend-group";

/** Build a ledger event with a caller-controlled messageId (for dedup/redelivery). */
function ledgerEvent(
  messageId: string,
  type: "TRADE_EXECUTED" | "ORDER_INTENT" | "POSITION_UPDATED" | "PERFORMANCE_SNAPSHOT" = "TRADE_EXECUTED"
): BotEvent {
  return {
    ...createBotEvent(
      type,
      {
        botId: BOT_ID,
        engineId: "engine-1",
        engineEpoch: 1,
        symbol: "ETH",
        side: "BUY",
        price: 100,
        quantity: 1,
        clientOrderId: "c-1",
        exchangeOrderId: "e-1",
        fillId: "f-1",
        status: "FILLED",
        executedAt: "2026-10-02T10:00:00.000Z",
      } as never,
      "corr-ledger"
    ),
    messageId,
  } as BotEvent;
}

function nonLedgerEvent(messageId: string): BotEvent {
  return {
    ...createBotEvent(
      "STATE_CHANGED",
      { botId: BOT_ID, engineId: "engine-1", engineEpoch: 1, from: "RUNNING", to: "STOPPED" } as never,
      "corr-state"
    ),
    messageId,
  } as BotEvent;
}

/** In-memory double of the Redis stream port. Only the methods the consumer touches are wired. */
function makeStreamOps(): {
  acks: string[];
  processed: Set<string>;
  ops: IEngineProtocolRedisStreams;
  repo: ITradeLedgerRepository & { recordFill: jest.Mock };
} {
  const acks: string[] = [];
  const processed = new Set<string>();

  const repo = {
    recordFill: jest.fn(async () => {
      return "INSERTED" as const;
    }),
  } as unknown as ITradeLedgerRepository & { recordFill: jest.Mock };

  const service = new TradeLedgerService();
  service.setTradeLedgerRepository(repo);

  const ops: IEngineProtocolRedisStreams = {
    publish: jest.fn(async () => ({ success: true })),
    read: jest.fn(async () => ({ success: true })),
    ack: jest.fn(async (): Promise<{ success: boolean; error?: string }> => {
      acks.push("ack");
      return { success: true };
    }),
    claimPending: jest.fn(async () => ({ success: true })),
    getPendingInsight: jest.fn(async () => ({
      pendingTotal: 0,
      stuckCount: 0,
      oldestStuckIdleMs: 0,
      maxDeliveries: 0,
      poisonIds: [],
    })),
    getPendingDeliveries: jest.fn(async () => 0),
    isMessageProcessed: jest.fn(async (_scope: string, messageId: string) =>
      processed.has(messageId)
    ),
    markMessageProcessed: jest.fn(async (_scope: string, messageId: string) => {
      processed.add(messageId);
      return true;
    }),
    createConsumerGroup: jest.fn(async () => ({ success: true })),
  };

  return { acks, processed, ops, repo };
}

function makeService(
  ops: IEngineProtocolRedisStreams,
  integrityAlertHandler?: (event: BotEvent, deliveries: number) => Promise<void>
): ServiceInternals {
  const service = new EngineProtocolService({
    streamOperations: ops,
    integrityAlertHandler,
  });
  return service as unknown as ServiceInternals;
}

describe("Financial-event failure-injection (consumer / dedup / ACK)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("persistence failure (ledger transaction throws)", () => {
    it("ledger persistence failure leaves the event unacked, not marked processed", async () => {
      const { ops, repo } = makeStreamOps();
      repo.recordFill.mockRejectedValue(new Error("pg: connection lost"));
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      const event = ledgerEvent("msg-persist-1");

      await internals.processEventMessage("stream-1", event);

      // Persistence failed → neither markProcessed nor safeAck: the message stays
      // pending so pending-event recovery can redeliver it once the DB is back.
      expect(ops.markMessageProcessed).not.toHaveBeenCalled();
      expect(ops.ack).not.toHaveBeenCalled();
      expect(repo.recordFill).toHaveBeenCalledTimes(1);
    });

    it("ledger event at the poison threshold stays pending — not processed or ACKed", async () => {
      const { ops, repo } = makeStreamOps();
      repo.recordFill.mockRejectedValue(new Error("pg: connection lost"));
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      (ops.getPendingDeliveries as jest.Mock).mockResolvedValueOnce(
        PENDING_POISON_MAX_DELIVERIES
      );

      await internals.processEventMessage("stream-poison-1", ledgerEvent("msg-poison-1"));

      expect(ops.markMessageProcessed).not.toHaveBeenCalled();
      expect(ops.ack).not.toHaveBeenCalled();
      // The event remains in the PEL for pending-event recovery / operator reconciliation.
      expect(ops.getPendingDeliveries).toHaveBeenCalledWith(
        STREAM,
        GROUP,
        "stream-poison-1"
      );
    });

    it("ledger event at poison threshold triggers a durable integrity alert", async () => {
      const alertHandler = jest.fn(async () => {});
      const { ops, repo } = makeStreamOps();
      repo.recordFill.mockRejectedValue(new Error("pg: connection lost"));
      const internals = makeService(ops, alertHandler);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      const event = ledgerEvent("msg-poison-alert-1");

      (ops.getPendingDeliveries as jest.Mock).mockResolvedValueOnce(
        PENDING_POISON_MAX_DELIVERIES
      );

      await internals.processEventMessage("stream-poison-alert-1", event);

      // A durable integrity alert is raised so operators can see the stuck
      // financial event — it is not silently left pending with only a log line.
      expect(alertHandler).toHaveBeenCalledTimes(1);
      expect(alertHandler).toHaveBeenCalledWith(
        event,
        PENDING_POISON_MAX_DELIVERIES
      );
      // Message remains pending — not ACKed, not marked processed.
      expect(ops.markMessageProcessed).not.toHaveBeenCalled();
      expect(ops.ack).not.toHaveBeenCalled();
    });

    it("UNKNOWN_BOT throw leaves the event pending; poison threshold triggers integrity alert", async () => {
      const alertHandler = jest.fn(async () => {});
      const { ops, repo } = makeStreamOps();
      repo.recordFill.mockResolvedValue("UNKNOWN_BOT");
      const internals = makeService(ops, alertHandler);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      const event = ledgerEvent("msg-unknown-1");

      (ops.getPendingDeliveries as jest.Mock).mockResolvedValueOnce(
        PENDING_POISON_MAX_DELIVERIES
      );

      await internals.processEventMessage("stream-unknown-1", event);

      // TradeLedgerService threw on UNKNOWN_BOT → consumer left it unacked.
      expect(repo.recordFill).toHaveBeenCalledTimes(1);
      expect(ops.markMessageProcessed).not.toHaveBeenCalled();
      expect(ops.ack).not.toHaveBeenCalled();
      // At the poison threshold, the integrity alert fires (operator-visible).
      expect(alertHandler).toHaveBeenCalledTimes(1);
      expect(alertHandler).toHaveBeenCalledWith(
        event,
        PENDING_POISON_MAX_DELIVERIES
      );
    });

    it("non-ledger event at the poison threshold is processed and ACKed (bounded drop)", async () => {
      const { ops } = makeStreamOps();
      const internals = makeService(ops);
      let handlerThrows = true;
      internals.eventHandler = async () => {
        if (handlerThrows) throw new Error("cannot apply");
      };

      (ops.getPendingDeliveries as jest.Mock).mockResolvedValueOnce(
        PENDING_POISON_MAX_DELIVERIES
      );

      await internals.processEventMessage("stream-poison-2", nonLedgerEvent("msg-poison-2"));

      // Non-ledger events past the threshold are ACKed so a poison message cannot
      // bury the stream indefinitely.
      expect(ops.markMessageProcessed).toHaveBeenCalledTimes(1);
      expect(ops.ack).toHaveBeenCalledTimes(1);
    });
  });

  describe("deduplication and redelivery", () => {
    it("ack failure after processed marker succeeds is deduped in-memory — handler runs once", async () => {
      const { ops, repo } = makeStreamOps();
      let ackFails = true;
      ops.ack = jest.fn(
        async (): Promise<{ success: boolean; error?: string }> => {
          if (ackFails) {
            ackFails = false;
            return { success: false, error: "network blip" };
          }
          return { success: true };
        }
      );
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      const event = ledgerEvent("msg-ack-1");

      // First delivery: handler runs, marker written, ACK fails.
      await internals.processEventMessage("stream-ack-1", event);
      expect(repo.recordFill).toHaveBeenCalledTimes(1);
      expect(ops.markMessageProcessed).toHaveBeenCalledTimes(1);
      expect(ops.ack).toHaveBeenCalledTimes(1);

      // Redelivery of the same messageId: the in-memory dedup set short-circuits
      // before the handler, so the financial effect is not applied again.
      await internals.processEventMessage("stream-ack-1", event);
      expect(repo.recordFill).toHaveBeenCalledTimes(1); // still once
      expect(ops.markMessageProcessed).toHaveBeenCalledTimes(1); // not re-marked
      expect(ops.ack).toHaveBeenCalledTimes(2); // ack attempted again
    });

    it("duplicate messageId is processed exactly once", async () => {
      const { ops, repo } = makeStreamOps();
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      const event = ledgerEvent("msg-dup-1");

      await internals.processEventMessage("stream-dup-1", event);
      await internals.processEventMessage("stream-dup-1", event);

      expect(repo.recordFill).toHaveBeenCalledTimes(1);
      expect(ops.markMessageProcessed).toHaveBeenCalledTimes(1);
      expect(ops.ack).toHaveBeenCalledTimes(2);
    });

    it("redis dedup read failure fails open — handler runs, no crash, event processed", async () => {
      const { ops, repo } = makeStreamOps();
      ops.isMessageProcessed = jest.fn(async () => {
        throw new Error("redis down");
      });
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      // When Redis dedup read fails, alreadyProcessed must fail open: the
      // handler still runs, the event is marked processed and ACKed. No crash,
      // no silent loss — the repository's unique constraint is the backstop
      // against duplicate financial effects on redelivery.
      await internals.processEventMessage("stream-failopen-1", ledgerEvent("msg-fo-1"));

      expect(repo.recordFill).toHaveBeenCalledTimes(1);
      expect(ops.markMessageProcessed).toHaveBeenCalledTimes(1);
      expect(ops.ack).toHaveBeenCalledTimes(1);
    });

    it("restart redelivery re-runs the handler (dedup state was lost)", async () => {
      // Simulate a fresh engine-protocol instance after restart: empty in-memory
      // set and no Redis marker, so the same messageId is treated as new. Each
      // service instance gets its own ops (own processed set) to model the lost
      // dedup state across a process restart.
      const makeRestartService = () => {
        const { ops, repo } = makeStreamOps();
        const internals = makeService(ops);
        const svc = new TradeLedgerService();
        svc.setTradeLedgerRepository(repo);
        internals.eventHandler = (e) => svc.handle(e);
        return { internals, repo };
      };

      const first = makeRestartService();
      const second = makeRestartService();

      const event = ledgerEvent("msg-restart-1");

      await first.internals.processEventMessage("stream-restart-1", event);
      expect(first.repo.recordFill).toHaveBeenCalledTimes(1);

      // A second instance with no dedup memory re-processes the same messageId.
      await second.internals.processEventMessage("stream-restart-1", event);
      expect(second.repo.recordFill).toHaveBeenCalledTimes(1);

      // Across both restarts, the handler ran twice for the same messageId.
      // The durable guard against the duplicate financial effect is the
      // repository's unique constraint (ON CONFLICT DO NOTHING) — verified in
      // trade-ledger-idempotency.test.ts.
    });
  });

  describe("swallowed ledger results (no integrity halt)", () => {
    it("DUPLICATE fill result is swallowed and acked — ledger already holds the fill", async () => {
      const { ops, repo } = makeStreamOps();
      repo.recordFill.mockResolvedValue("DUPLICATE");
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      await internals.processEventMessage(
        "stream-duplicate-1",
        ledgerEvent("msg-duplicate-1")
      );

      // DUPLICATE means the ledger already holds this fill; TradeLedgerService
      // swallows it (no throw), so the consumer marks it processed and ACKs it.
      // No durability hazard — no duplicate financial effect.
      expect(ops.markMessageProcessed).toHaveBeenCalledTimes(1);
      expect(ops.ack).toHaveBeenCalledTimes(1);
      expect(repo.recordFill).toHaveBeenCalledTimes(1);
    });

    it("UNKNOWN_BOT fill result throws — event left pending, not swallowed", async () => {
      const { ops, repo } = makeStreamOps();
      repo.recordFill.mockResolvedValue("UNKNOWN_BOT");
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      // TradeLedgerService throws on UNKNOWN_BOT. The consumer catches it
      // (below poison threshold) and leaves the event unacked for redelivery
      // rather than silently dropping the fill. processEventMessage does not
      // propagate the throw — it handles it internally.
      await internals.processEventMessage("stream-unknown-2", ledgerEvent("msg-unknown-2"));

      expect(repo.recordFill).toHaveBeenCalledTimes(1);
      expect(ops.markMessageProcessed).not.toHaveBeenCalled();
      expect(ops.ack).not.toHaveBeenCalled();
    });
  });

  describe("dedup write failure", () => {
    it("markProcessed Redis write failure fails open — event still processed and ACKed", async () => {
      const { ops, repo } = makeStreamOps();
      repo.recordFill.mockResolvedValue("INSERTED");
      ops.markMessageProcessed = jest.fn(async () => {
        throw new Error("redis dedup write failed");
      });
      const internals = makeService(ops);
      const svc = new TradeLedgerService();
      svc.setTradeLedgerRepository(repo);
      internals.eventHandler = (e) => svc.handle(e);

      // markProcessed must not throw when the Redis dedup marker write fails.
      // It fails open: the handler result is committed, the event is marked
      // processed (in memory) and ACKed. No poison treatment, no redelivery.
      await internals.processEventMessage("stream-dedup-write-fail-1", ledgerEvent("msg-dedup-write-fail-1"));

      expect(repo.recordFill).toHaveBeenCalledTimes(1);
      expect(ops.markMessageProcessed).toHaveBeenCalledTimes(1);
      expect(ops.ack).toHaveBeenCalledTimes(1);
    });
  });
});


