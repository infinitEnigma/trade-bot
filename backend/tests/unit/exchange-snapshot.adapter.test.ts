/**
 * @format
 * C3b venue sync — snapshot writer for exchange_positions / exchange_balances.
 * The pool is mocked: assertions target the transaction's SQL and parameters.
 */
import { transaction } from "../../src/database/pool";
import { exchangeSnapshotAdapter } from "../../src/infrastructure/adapters/repositories/exchange-snapshot.adapter";

jest.mock("../../src/database/pool", () => ({
  transaction: jest.fn(),
}));

describe("ExchangeSnapshotAdapter (C3b venue sync)", () => {
  const client = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (transaction as jest.Mock).mockImplementation(
      async (cb: (c: typeof client) => Promise<unknown>) => cb(client)
    );
  });

  it("replaces the account's position rows in one transaction", async () => {
    await exchangeSnapshotAdapter.replacePositions("acct-1", [
      {
        symbol: "ETH-USDC",
        positionQty: 2,
        entryPrice: 3000,
        markPrice: 3100,
        unrealizedPnl: 200,
      },
    ]);

    expect(transaction).toHaveBeenCalledTimes(1);
    const calls = client.query.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain("DELETE FROM exchange_positions");
    expect(calls[0][1]).toEqual(["acct-1"]);
    expect(calls[1][0]).toContain("INSERT INTO exchange_positions");
    expect(calls[1][0]).toContain("ON CONFLICT (exchange_account_id, symbol)");
    expect(calls[1][1]).toEqual([
      "acct-1",
      ["ETH-USDC"],
      [2],
      [3000],
      [3100],
      [200],
    ]);
  });

  it("clears the snapshot when the venue reports no positions", async () => {
    await exchangeSnapshotAdapter.replacePositions("acct-1", []);

    const calls = client.query.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("DELETE FROM exchange_positions");
  });

  it("drops position rows without a symbol instead of failing", async () => {
    await exchangeSnapshotAdapter.replacePositions("acct-1", [
      {
        symbol: "",
        positionQty: 1,
        entryPrice: 1,
        markPrice: 1,
        unrealizedPnl: 0,
      },
      {
        symbol: "BTC-USDC",
        positionQty: 1,
        entryPrice: 1,
        markPrice: 1,
        unrealizedPnl: 0,
      },
    ]);

    const calls = client.query.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1][1]).toEqual(["BTC-USDC"]);
  });

  it("replaces the account's balance rows with the same semantics", async () => {
    await exchangeSnapshotAdapter.replaceBalances("acct-1", [
      { asset: "USDC", holding: 1500, frozen: 50 },
      { asset: "", holding: 1, frozen: 0 },
    ]);

    const calls = client.query.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain("DELETE FROM exchange_balances");
    expect(calls[1][0]).toContain("INSERT INTO exchange_balances");
    expect(calls[1][0]).toContain("ON CONFLICT (exchange_account_id, asset)");
    expect(calls[1][1]).toEqual(["acct-1", ["USDC"], [1500], [50]]);
  });

  it("requires an exchange account id", async () => {
    await expect(
      exchangeSnapshotAdapter.replacePositions("", [])
    ).rejects.toThrow("exchangeAccountId is required");
    await expect(
      exchangeSnapshotAdapter.replaceBalances("", [])
    ).rejects.toThrow("exchangeAccountId is required");
    expect(transaction).not.toHaveBeenCalled();
  });
});
