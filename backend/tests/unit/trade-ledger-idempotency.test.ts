/**
 * Trade ledger idempotency — real PostgreSQL verification.
 *
 * Scope: `TradeLedgerRepositoryAdapter.recordFill` against a REAL Postgres
 * instance. Mocks cannot prove the durable invariant this suite targets:
 * exactly one effective ledger application per venue fill, across both
 * sequential redelivery and concurrent duplicate delivery.
 *
 * What this package proves:
 *  1. A duplicate fill (same bot/clientOrderId/exchangeOrderId/fillId) returns
 *     DUPLICATE and writes nothing — no second ledger row, no second trade row,
 *     no second totals increment, no second intent closure.
 *  2. A fresh fill returns INSERTED and writes exactly: one bot_trade_fills
 *     row, one trades display row, one intent close, one bot_instances totals
 *     increment.
 *  3. Two concurrent deliveries of the same fill yield exactly one INSERTED and
 *     one DUPLICATE, with exactly one durable row in every table (the Postgres
 *     unique constraint serializes them).
 *
 * Each case seeds its own bot + run rows and cleans them up, so cases are
 * independent and the suite leaves the database as it found it.
 *
 * Resilient to a missing database: if Postgres is unreachable the cases log a
 * warning and skip rather than fail (matches the existing integration suite).
 *
 * Failure matrix entries covered (companion to financial-event-failure-injection.test.ts):
 * | # | Failure injected | Required invariant | Test case |
 * |---|------------------|-------------------|-----------|
 * | 2b | Ledger commit succeeds, ACK fails → redelivery | No duplicate financial effect | "duplicate fill is short-circuited — one row only" |
 * | 3 | Same financial event delivered twice | One effective ledger application | "duplicate fill is short-circuited — one row only" |
 * | 4 | Redis dedup fails open → handler re-runs | DB unique constraint blocks duplicate | "duplicate fill is short-circuited — one row only" |
 * | 5 | Restart with pending events | Redelivery is idempotent at the repository | "duplicate fill is short-circuited — one row only" |
 *
 * Companion suite: `financial-event-failure-injection.test.ts` covers the
 * consumer/dedup/ACK behaviour with a mocked Redis port.
 *
 * @format
 */

import { query } from "../../src/database/pool";
import { TradeLedgerRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/trade-ledger-repository.adapter";
import { LedgerFill } from "../../src/core/strategies/trade-ledger.repository.port";
import logger from "../../src/core/logging/logger.service";

jest.mock("../../src/core/logging/logger.service");

describe("Trade ledger idempotency (real PostgreSQL)", () => {
  const USER_ID = "11111111-1111-1111-1111-111111111111";
  const ACCOUNT_ID = "22222222-2222-2222-2222-222222222222";
  const STRATEGY_ID = "33333333-3333-3333-3333-333333333333";
  const BOT_ID = "44444444-4444-4444-4444-444444444444";
  const RUN_ID = "55555555-5555-5555-5555-555555555555";

  let dbAvailable = false;

  beforeAll(async () => {
    try {
      // Probe that the tables the adapter touches exist (migrations applied).
      const probe = await query(
        `SELECT 1 FROM information_schema.columns
           WHERE table_name = 'bot_trade_fills' AND column_name = 'fill_id'
        UNION ALL
         SELECT 1 FROM information_schema.columns
           WHERE table_name = 'bot_instances' AND column_name = 'total_trades'
        LIMIT 1`
      );
      dbAvailable = (probe.rowCount ?? 0) > 0;
      if (!dbAvailable) {
        logger.warn(
          "Trade-ledger idempotency integration test skipped: schema not applied"
        );
      }
    } catch (error) {
      logger.warn(
        "Trade-ledger idempotency integration test skipped: no database",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  });

  const skip = () => {
    logger.warn("Trade-ledger idempotency case skipped: database unavailable");
  };

  async function seed(): Promise<void> {
    await query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'idempotency-test@trade-bot.local', 'x')
       ON CONFLICT (id) DO NOTHING`,
      [USER_ID]
    );
    await query(
      `INSERT INTO exchange_accounts
         (id, user_id, exchange, environment, account_ref, credentials_encrypted, status)
       VALUES ($1, $2, 'lighter', 'testnet', 'idempotency-acct', 'encrypted', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [ACCOUNT_ID, USER_ID]
    );
    await query(
      `INSERT INTO strategies (id, user_id, name, type, config, active, exchange, environment)
       VALUES ($1, $2, 'idempotency-strategy', 'GRID', '{}', false, NULL, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [STRATEGY_ID, USER_ID]
    );
    await query(
      `INSERT INTO bot_instances
         (id, user_id, exchange_account_id, status, actual_state, desired_state,
          total_trades, total_pnl, total_pnl_incomplete_fills)
       VALUES ($1, $2, $3, 'STOPPED', 'STOPPED', 'STOPPED', 0, 0, 0)
       ON CONFLICT (id) DO NOTHING`,
      [BOT_ID, USER_ID, ACCOUNT_ID]
    );
    await query(
      `INSERT INTO strategy_runs (id, bot_id, strategy_id, config_version, config, notional_amount, state)
       VALUES ($1, $2, $3, 1, '{}', 0, 'STOPPED')
       ON CONFLICT (id) DO NOTHING`,
      [RUN_ID, BOT_ID, STRATEGY_ID]
    );
    await query(
      `INSERT INTO bot_order_intents (id, bot_id, client_order_id, symbol, side, price, quantity, state)
       VALUES ($1, $2, $3, 'ETH', 'BUY', 2700, 0.01, 'INTENDED')
       ON CONFLICT (id) DO NOTHING`,
      ["66666666-6666-6666-6666-666666666666", BOT_ID, "bot1-00-B"]
    );
  }

  async function cleanup(): Promise<void> {
    await query(`DELETE FROM bot_trade_fills WHERE bot_id = $1`, [BOT_ID]);
    await query(`DELETE FROM trades WHERE bot_id = $1`, [BOT_ID]);
    await query(`DELETE FROM bot_order_intents WHERE bot_id = $1`, [BOT_ID]);
    await query(`DELETE FROM strategy_runs WHERE id = $1`, [RUN_ID]);
    await query(`DELETE FROM bot_instances WHERE id = $1`, [BOT_ID]);
    await query(`DELETE FROM strategies WHERE id = $1`, [STRATEGY_ID]);
    await query(`DELETE FROM exchange_accounts WHERE id = $1`, [ACCOUNT_ID]);
    await query(`DELETE FROM users WHERE id = $1`, [USER_ID]);
  }

  async function counts(): Promise<{
    fills: number;
    trades: number;
    intents: number;
    totalTrades: number;
    totalPnl: string | null;
  }> {
    const [fills, trades, intents, totals] = await Promise.all([
      query(`SELECT count(*) AS n FROM bot_trade_fills WHERE bot_id = $1`, [
        BOT_ID,
      ]),
      query(`SELECT count(*) AS n FROM trades WHERE bot_id = $1`, [BOT_ID]),
      query(`SELECT count(*) AS n FROM bot_order_intents WHERE bot_id = $1`, [
        BOT_ID,
      ]),
      query(`SELECT total_trades, total_pnl FROM bot_instances WHERE id = $1`, [
        BOT_ID,
      ]),
    ]);
    return {
      fills: Number((fills.rows[0] as { n: number })?.n ?? 0),
      trades: Number((trades.rows[0] as { n: number })?.n ?? 0),
      intents: Number((intents.rows[0] as { n: number })?.n ?? 0),
      totalTrades: Number(
        (totals.rows[0] as { total_trades: number })?.total_trades ?? 0
      ),
      totalPnl:
        (totals.rows[0] as { total_pnl: string | null })?.total_pnl ?? null,
    };
  }

  /** State of the seeded intent (client_order_id = 'bot1-00-B'). */
  async function intentState(): Promise<string | null> {
    const result = await query(
      `SELECT state FROM bot_order_intents
         WHERE bot_id = $1 AND client_order_id = 'bot1-00-B'`,
      [BOT_ID]
    );
    return (result.rows[0] as { state: string | null })?.state ?? null;
  }

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

  beforeEach(async () => {
    if (!dbAvailable) return skip();
    await seed();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    try {
      await cleanup();
    } catch {
      /* ignore cleanup errors */
    }
  });

  it("fresh fill inserts one ledger row, one trade row, and increments totals once", async () => {
    if (!dbAvailable) return skip();
    const repo = new TradeLedgerRepositoryAdapter();

    const before = await counts();
    expect(before.fills).toBe(0);
    expect(before.trades).toBe(0);
    expect(await intentState()).toBe("INTENDED"); // intent starts open

    const result = await repo.recordFill(FILL);
    expect(result).toBe("INSERTED");

    const after = await counts();
    expect(after.fills).toBe(1);
    expect(after.trades).toBe(1);
    expect(after.intents).toBe(1); // intent row exists — closed to FILLED
    expect(await intentState()).toBe("FILLED"); // intent closed exactly once
    expect(after.totalTrades).toBe(1);
    expect(after.totalPnl).toBe("-1.25000000");
  });

  it("duplicate fill is short-circuited — one row only (sequential redelivery)", async () => {
    if (!dbAvailable) return skip();
    const repo = new TradeLedgerRepositoryAdapter();

    const first = await repo.recordFill(FILL);
    expect(first).toBe("INSERTED");
    const afterFirst = await counts();
    expect(afterFirst.fills).toBe(1);
    expect(afterFirst.totalTrades).toBe(1);
    expect(await intentState()).toBe("FILLED"); // intent closed once by the insert

    const second = await repo.recordFill(FILL); // same messageId-equivalent identity
    expect(second).toBe("DUPLICATE");

    const afterSecond = await counts();
    expect(afterSecond.fills).toBe(1); // still exactly one ledger row
    expect(afterSecond.trades).toBe(1); // no duplicate display trade
    expect(afterSecond.totalTrades).toBe(1); // totals not incremented again
    expect(afterSecond.totalPnl).toBe("-1.25000000"); // pnl not added twice
    expect(await intentState()).toBe("FILLED"); // intent stays FILLED — not re-closed
  });

  it("concurrent duplicate deliveries yield exactly one INSERTED and one DUPLICATE", async () => {
    if (!dbAvailable) return skip();
    const repo = new TradeLedgerRepositoryAdapter();

    // Two concurrent deliveries of the same fill identity.
    const [r1, r2] = await Promise.all([
      repo.recordFill(FILL),
      repo.recordFill(FILL),
    ]);

    const results = [r1, r2].sort();
    expect(results).toEqual(["DUPLICATE", "INSERTED"]);

    const final = await counts();
    expect(final.fills).toBe(1); // exactly one durable ledger row
    expect(final.trades).toBe(1); // exactly one display row
    expect(final.totalTrades).toBe(1); // totals incremented once
    expect(final.totalPnl).toBe("-1.25000000");
    expect(await intentState()).toBe("FILLED"); // intent closed exactly once
  });
});
