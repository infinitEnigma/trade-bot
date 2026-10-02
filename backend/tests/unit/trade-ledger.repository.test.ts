/**
 * TradeLedgerRepository - Phase 4 durable ledger writes.
 *
 * The pool is mocked; assertions pin the invariants: idempotent ledger insert
 * (DUPLICATE short-circuits — no display row, no totals increment), identity
 * resolved server-side, and `bot_instances` totals keyed by `id` (= bot_id),
 * never `strategy_id` (N7).
 *
 * @format
 */

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
  tradingLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { query, transaction } from "../../src/database/pool";
import {
  LedgerFill,
  TradeLedgerRepository,
} from "../../src/core/strategies/trade-ledger.repository";

const mockQuery = query as jest.Mock;
const mockTransaction = transaction as jest.Mock;

const BOT_ID = "11111111-1111-1111-1111-111111111111";

const FILL: LedgerFill = {
  botId: BOT_ID,
  clientOrderId: "bot1-00-B",
  exchangeOrderId: "idx-1",
  fillId: "sha-fill-1",
  symbol: "ETH",
  side: "BUY",
  quantity: 0.01,
  price: 2700,
  fee: 0.5,
  pnl: -1.25,
  status: "FILLED",
  executedAt: "2026-10-02T10:00:00.000Z",
};

describe("TradeLedgerRepository", () => {
  let repo: TradeLedgerRepository;
  let clientQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    clientQuery = jest.fn();
    mockTransaction.mockImplementation(
      async (cb: (c: { query: jest.Mock }) => Promise<unknown>) =>
        cb({ query: clientQuery })
    );
    repo = new TradeLedgerRepository();
  });

  describe("recordFill", () => {
    it("returns UNKNOWN_BOT without writing when bot_instances has no row", async () => {
      clientQuery.mockResolvedValueOnce({ rows: [] });

      const result = await repo.recordFill(FILL);

      expect(result).toBe("UNKNOWN_BOT");
      expect(clientQuery).toHaveBeenCalledTimes(1);
    });

    it("on a fresh ledger insert: display row + intent close + totals by bot id", async () => {
      clientQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: "user-1", strategy_id: "strat-1" }],
        }) // identity lookup
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "fill-row" }] }) // ledger
        .mockResolvedValueOnce({ rowCount: 1 }) // trades display row
        .mockResolvedValueOnce({ rowCount: 1 }) // intent state
        .mockResolvedValueOnce({ rowCount: 1 }); // bot totals

      const result = await repo.recordFill(FILL);

      expect(result).toBe("INSERTED");
      expect(clientQuery).toHaveBeenCalledTimes(5);

      const [ledgerSql, ledgerParams] = clientQuery.mock.calls[1];
      expect(ledgerSql).toContain("INSERT INTO bot_trade_fills");
      expect(ledgerSql).toContain(
        "ON CONFLICT (bot_id, client_order_id, exchange_order_id, fill_id)"
      );
      expect(ledgerSql).toContain("DO NOTHING");
      // Identity comes from the bot lookup, not the event.
      expect(ledgerParams.slice(0, 4)).toEqual([
        BOT_ID,
        "user-1",
        "strat-1",
        "bot1-00-B",
      ]);

      const [tradesSql, tradesParams] = clientQuery.mock.calls[2];
      expect(tradesSql).toContain("INSERT INTO trades");
      expect(tradesParams).toEqual([
        "user-1",
        "strat-1",
        BOT_ID,
        "idx-1",
        "ETH",
        "BUY",
        0.01,
        2700,
        0.5,
        -1.25,
        "FILLED",
        "2026-10-02T10:00:00.000Z",
      ]);

      const [totalsSql, totalsParams] = clientQuery.mock.calls[4];
      expect(totalsSql).toContain("UPDATE bot_instances");
      expect(totalsSql).toContain("total_trades = total_trades + 1");
      expect(totalsSql).toContain("total_pnl = total_pnl + $2");
      expect(totalsSql).toContain("WHERE id = $1");
      expect(totalsSql).not.toContain("strategy_id");
      expect(totalsParams).toEqual([BOT_ID, -1.25]);
    });

    it("on a duplicate: short-circuits — no display row, no totals increment", async () => {
      clientQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: "user-1", strategy_id: "strat-1" }],
        })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // conflict → DO NOTHING

      const result = await repo.recordFill(FILL);

      expect(result).toBe("DUPLICATE");
      expect(clientQuery).toHaveBeenCalledTimes(2);
    });

    it("a replay after INSERTED behaves exactly like the first delivery", async () => {
      // First delivery.
      clientQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: "user-1", strategy_id: "strat-1" }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "fill-row" }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });
      expect(await repo.recordFill(FILL)).toBe("INSERTED");

      // Replay of the same logical event (redelivery / live-gate replay).
      clientQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: "user-1", strategy_id: "strat-1" }],
        })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });
      expect(await repo.recordFill(FILL)).toBe("DUPLICATE");
    });
  });

  describe("upsertIntent", () => {
    it("upserts on (bot_id, client_order_id) and never regresses FILLED", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const known = await repo.upsertIntent({
        botId: BOT_ID,
        clientOrderId: "bot1-00-B",
        symbol: "ETH",
        side: "BUY",
        price: 2700,
        quantity: 0.01,
      });

      expect(known).toBe(true);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("INSERT INTO bot_order_intents");
      expect(sql).toContain("ON CONFLICT (bot_id, client_order_id)");
      expect(sql).toContain("WHEN bot_order_intents.state = 'FILLED'");
      expect(sql).toContain("ELSE 'INTENDED'");
      // The bot row pick drives both insert and unknown-bot detection.
      expect(sql).toContain("FROM bot_instances bi WHERE bi.id = $1");
      expect(params).toEqual([BOT_ID, "bot1-00-B", "ETH", "BUY", 2700, 0.01]);
    });

    it("returns false when the bot is unknown (nothing inserted)", async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });
      const known = await repo.upsertIntent({
        botId: BOT_ID,
        clientOrderId: "bot1-00-B",
        symbol: "ETH",
        side: "BUY",
        price: 2700,
        quantity: 0.01,
      });
      expect(known).toBe(false);
    });
  });

  describe("upsertPosition", () => {
    it("upserts latest position per (bot_id, symbol)", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const known = await repo.upsertPosition({
        botId: BOT_ID,
        symbol: "ETH",
        side: "LONG",
        quantity: 0.01,
        entryPrice: 2698.59,
        markPrice: 2710,
        pnl: 0.11,
      });

      expect(known).toBe(true);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("INSERT INTO bot_positions");
      expect(sql).toContain("ON CONFLICT (bot_id, symbol)");
      expect(sql).toContain("updated_at = CURRENT_TIMESTAMP");
    });

    it("returns false when the bot is unknown", async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });
      const known = await repo.upsertPosition({
        botId: BOT_ID,
        symbol: "ETH",
        side: "FLAT",
        quantity: 0,
        entryPrice: 0,
        markPrice: 2710,
        pnl: 0,
      });
      expect(known).toBe(false);
    });
  });

  describe("upsertPerformance", () => {
    it("upserts telemetry counters without touching bot_instances totals", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const known = await repo.upsertPerformance({
        botId: BOT_ID,
        totalTrades: 5,
        totalPnl: 1.5,
      });

      expect(known).toBe(true);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("INSERT INTO bot_performance_snapshots");
      expect(sql).toContain("ON CONFLICT (bot_id)");
      // Telemetry only: it may read the bot row to detect unknown bots, but
      // it must never write the authoritative totals.
      expect(sql).not.toContain("UPDATE bot_instances");
      expect(params.slice(0, 3)).toEqual([BOT_ID, 5, 1.5]);
    });

    it("returns false when the bot is unknown", async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });
      const known = await repo.upsertPerformance({
        botId: BOT_ID,
        totalTrades: 0,
        totalPnl: 0,
      });
      expect(known).toBe(false);
    });
  });
});
