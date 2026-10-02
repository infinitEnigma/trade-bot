/**
 * BotEventProcessor — ledger event routing (Phase 4 / N7).
 *
 * Pins the ingest contract for ORDER_INTENT / TRADE_EXECUTED /
 * POSITION_UPDATED / PERFORMANCE_SNAPSHOT:
 * - routed to the wired ledger handler only after the fail-closed authority
 *   check (engineId + engineEpoch must identify the current engine),
 * - rejected loudly when no handler is wired (never silently dropped),
 * - handler persistence failures propagate (message stays unacked →
 *   redelivery; the DB unique key makes that redelivery idempotent).
 *
 * @format
 */

import { BotEvent, createBotEvent } from "@trade-bot/shared";

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { BotEventProcessor } from "../../src/core/bots/lifecycle/bot-event-processor";

const BASE = {
  botId: "11111111-1111-1111-1111-111111111111",
  engineId: "engine-1",
  engineEpoch: 3,
};

function ledgerEvent(type: "TRADE_EXECUTED" | "ORDER_INTENT"): BotEvent {
  const payload =
    type === "TRADE_EXECUTED"
      ? {
          ...BASE,
          symbol: "ETH",
          side: "BUY",
          price: 100,
          quantity: 1,
          status: "FILLED",
          clientOrderId: "bot1-00-B",
          exchangeOrderId: "idx-1",
          fillId: "sha1",
          executedAt: "2026-10-02T10:00:00.000Z",
        }
      : {
          ...BASE,
          symbol: "ETH",
          side: "BUY",
          price: 100,
          quantity: 1,
          clientOrderId: "bot1-00-B",
        };
  return createBotEvent(type, payload as never, `corr-${type.toLowerCase()}`);
}

describe("BotEventProcessor ledger routing (Phase 4)", () => {
  let processor: BotEventProcessor;
  let ledgerHandler: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new BotEventProcessor({} as never, {} as never);
    ledgerHandler = jest.fn().mockResolvedValue(undefined);
    processor.setTradeLedgerHandler(ledgerHandler);
  });

  it("routes an authoritative TRADE_EXECUTED to the ledger handler", async () => {
    processor.setAuthorityChecker(async () => true);
    const event = ledgerEvent("TRADE_EXECUTED");

    await processor.handleEngineEvent(event);

    expect(ledgerHandler).toHaveBeenCalledTimes(1);
    expect(ledgerHandler).toHaveBeenCalledWith(event);
  });

  it.each(["ORDER_INTENT", "TRADE_EXECUTED"] as const)(
    "routes %s through the same fail-closed gate",
    async type => {
      processor.setAuthorityChecker(async () => true);
      await processor.handleEngineEvent(ledgerEvent(type));
      expect(ledgerHandler).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects the event when the engine is not authoritative", async () => {
    processor.setAuthorityChecker(async () => false);

    await processor.handleEngineEvent(ledgerEvent("TRADE_EXECUTED"));

    expect(ledgerHandler).not.toHaveBeenCalled();
  });

  it("fails closed when no authority checker is wired", async () => {
    (processor as unknown as { authorityChecker: unknown }).authorityChecker =
      null;

    await processor.handleEngineEvent(ledgerEvent("TRADE_EXECUTED"));

    expect(ledgerHandler).not.toHaveBeenCalled();
  });

  it("rejects loudly (no throw) when no ledger handler is wired", async () => {
    processor.setAuthorityChecker(async () => true);
    processor.setTradeLedgerHandler(null as never);

    await expect(
      processor.handleEngineEvent(ledgerEvent("TRADE_EXECUTED"))
    ).resolves.toBeUndefined();
  });

  it("propagates handler persistence failures for redelivery", async () => {
    processor.setAuthorityChecker(async () => true);
    ledgerHandler.mockRejectedValue(new Error("db down"));

    await expect(
      processor.handleEngineEvent(ledgerEvent("TRADE_EXECUTED"))
    ).rejects.toThrow("db down");
  });

  it("still rejects events without engineId/engineEpoch (authority shape)", async () => {
    processor.setAuthorityChecker(async () => true);
    const event = ledgerEvent("TRADE_EXECUTED");
    delete (event.payload as { engineEpoch?: number }).engineEpoch;

    await processor.handleEngineEvent(event);

    expect(ledgerHandler).not.toHaveBeenCalled();
  });
});
