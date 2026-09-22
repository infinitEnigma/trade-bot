/** @format */

import { EngineIdentity } from "../../domain/bot-runtime";
import { BotManager } from "../bot-manager";

jest.mock("../../protocol/credential-fetcher", () => ({
  fetchCredentials: jest.fn(),
}));

jest.mock("../../exchanges/factory", () => ({
  createExchangeClient: jest.fn(),
}));

jest.mock("../../strategies/grid", () => ({
  GridTradingStrategy: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    tick: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { fetchCredentials } from "../../protocol/credential-fetcher";
import { createExchangeClient } from "../../exchanges/factory";
import { CommandError } from "../command-error";
import type { EngineCredentials } from "@trade-bot/shared";

const fetchCredentialsMock = fetchCredentials as jest.Mock;
const createExchangeClientMock = createExchangeClient as jest.Mock;

const LIGHTER: EngineCredentials = {
  exchange: "lighter",
  environment: "testnet",
  accountRef: "42",
  credentials: { accountIndex: 42, apiKeyIndex: 0, privateKey: "0xdeadbeef" },
};

function makeStreamOps(): {
  published: Array<{ type: string; payload: Record<string, unknown> }>;
  ops: {
    publish: jest.Mock;
    publishEvent?: jest.Mock;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
} {
  const published: Array<{ type: string; payload: Record<string, unknown> }> =
    [];
  const ops = {
    publish: jest.fn(
      async (_stream: string, message: Record<string, unknown>) => {
        published.push({
          type: String(message.type),
          payload: (message.payload ?? {}) as Record<string, unknown>,
        });
        return { success: true as const };
      }
    ),
  };
  return { published, ops };
}

function makeManager(): BotManager {
  return new BotManager({ engineId: "engine-1", epoch: 1 } as EngineIdentity);
}

describe("BotManager.handleStart credential-contract slice (workstream A)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts a bot against the kodiak envelope exactly as before", async () => {
    const kodiak = {
      exchange: "kodiak",
      environment: "testnet",
      accountRef: "0xabc",
      credentials: {
        accountId: "0xabc",
        accessKey: "key",
        secretKey: "secret",
      },
    };
    fetchCredentialsMock.mockResolvedValue(kodiak);
    const client = {
      getTicker: jest
        .fn()
        .mockResolvedValue({ symbol: "S", price: 100, mark_price: 100 }),
    };
    createExchangeClientMock.mockReturnValue(client);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await manager.handleStart(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ops as any,
      "bot-1",
      "user-1",
      "strategy-1",
      { symbol: "S", gridSize: 3, gridRange: 5, orderQuantity: 1 },
      "corr-1"
    );

    expect(fetchCredentialsMock).toHaveBeenCalledWith("bot-1", "corr-1");
    expect(createExchangeClientMock).toHaveBeenCalledWith(kodiak);
    expect(client.getTicker).toHaveBeenCalledWith("S");
    expect(manager.hasBot("bot-1")).toBe(true);
    expect(manager.getBotRuntimes().get("bot-1")?.exchangeClient).toBe(client);
    expect(published.map(entry => entry.type)).toContain("STATE_CHANGED");
    // No COMMAND_FAILED on the happy path.
    expect(
      published.filter(entry => entry.type === "COMMAND_FAILED")
    ).toHaveLength(0);
  });

  it("fails cleanly (COMMAND_FAILED + STATE_CHANGED to ERROR) for a lighter envelope until workstream B", async () => {
    fetchCredentialsMock.mockResolvedValue(LIGHTER);
    createExchangeClientMock.mockImplementation(() => {
      throw new CommandError(
        false,
        "UNSUPPORTED_EXCHANGE: lighter client not implemented yet (workstream B)"
      );
    });

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ops as any,
        "bot-1",
        "user-1",
        "strategy-1",
        { symbol: "S", gridSize: 3, gridRange: 5, orderQuantity: 1 },
        "corr-1"
      )
    ).rejects.toBeInstanceOf(CommandError);

    // The factory throw is a non-retryable business outcome: COMMAND_FAILED
    // is published and the bot moves STARTING -> ERROR — never an unhandled
    // throw with no control-plane signal.
    const failed = published.filter(entry => entry.type === "COMMAND_FAILED");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].payload.message)).toMatch(/UNSUPPORTED_EXCHANGE/);

    const movedToError = published.filter(
      entry =>
        entry.type === "STATE_CHANGED" &&
        entry.payload.from === "STARTING" &&
        entry.payload.to === "ERROR"
    );
    expect(movedToError).toHaveLength(1);
    expect(String(movedToError[0].payload.reason)).toMatch(
      /UNSUPPORTED_EXCHANGE/
    );
    expect(manager.hasBot("bot-1")).toBe(false);
  });
});
