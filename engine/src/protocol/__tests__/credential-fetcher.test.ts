/** @format */

import axios from "axios";
import { fetchCredentials } from "../credential-fetcher";

jest.mock("axios");
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

describe("credential-fetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The backend route validates `req.query.correlationId` (400 without it);
  // the header is only for tracing. Pinning the query param here prevents a
  // repeat of the silent-400 that stalled BOT_START after L18.
  it("sends correlationId as a query param AND a header", async () => {
    const envelope = {
      exchange: "lighter",
      environment: "testnet",
      accountRef: "42",
      credentials: { accountIndex: 42, apiKeyIndex: 0, privateKey: "0xdead" },
    };
    mockedGet.mockResolvedValue({ data: { data: envelope } });

    const result = await fetchCredentials("bot-1", "corr-1");

    expect(mockedGet).toHaveBeenCalledTimes(1);
    const [url, config] = mockedGet.mock.calls[0];
    expect(url).toContain("/api/bot/engine/credentials/bot-1");
    expect(config?.params).toEqual({ correlationId: "corr-1" });
    expect(config?.headers).toMatchObject({
      "x-correlation-id": "corr-1",
    });
    expect(config?.headers).toHaveProperty("x-bot-engine-key");
    expect(result).toEqual(envelope);
  });

  it("rejects a malformed envelope before it reaches exchange code", async () => {
    mockedGet.mockResolvedValue({ data: { data: { exchange: "???" } } });

    await expect(fetchCredentials("bot-1", "corr-1")).rejects.toThrow(
      /malformed credential envelope/
    );
  });
});
