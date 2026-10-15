/** @format */

/**
 * Backfill strategies.exchange/environment from evidence (migration 026).
 * Order is load-bearing — later rules never override earlier ones:
 *  1. SESSION history (distinct pairs disagree → conflicting_history, write nothing)
 *  2. CATALOG unique hit over ACTIVE accounts (outage ≠ no-match, never binds)
 *  3. SPELLING is suggestion-only in the report — NEVER persisted.
 * Idempotent; --dry-run default, --apply writes, --force re-resolves set rows.
 */


import path from "path";
import { Pool } from "pg";
import dotenv from "dotenv";
import { listVenueSymbols } from "../src/infrastructure/external/venue-symbols";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

interface StrategyRow {
  id: string;
  user_id: string;
  exchange: string | null;
  environment: string | null;
  symbol: string;
}

function spellingSuggest(symbol: string): string {
  const upper = (symbol ?? "").trim().toUpperCase();
  return upper.includes("_") && !upper.includes("/") ? "kodiak" : "lighter";
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const dryRun = !process.argv.includes("--apply");
  if (dryRun) console.log("DRY RUN — no rows will be written. Pass --apply to write.\n");

  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "trade_bot",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
  });

  const { rows: strategies } = await pool.query<StrategyRow>(
    `SELECT id, user_id, exchange, environment, config->>'symbol' AS symbol
       FROM strategies ORDER BY created_at ASC`
  );
  console.log(`Found ${strategies.length} strategie(s) to consider.`);
  console.log("strategy_id\tsymbol\tproposed_ex\tproposed_env\tstatus\thistory\tsuggested\tcatalog_detail");

  let fromSession = 0;
  let fromCatalog = 0;
  let conflicting = 0;
  let stillNull = 0;
  let skipped = 0;

  for (const strategy of strategies) {
    const symbol = strategy.symbol ?? "";
    if (strategy.exchange && strategy.environment && !force) {
      skipped += 1;
      console.log(`${strategy.id}\t${symbol}\t${strategy.exchange}\t${strategy.environment}\tskipped\t\t\t`);
      continue;
    }
    // Rule 1 — session history (all pairs, newest first).
    const { rows: history } = await pool.query<{ exchange: string; environment: string }>(
      `SELECT ea.exchange, ea.environment FROM strategy_runs r
         JOIN bot_instances b ON b.id = r.bot_id
         JOIN exchange_accounts ea ON ea.id = b.exchange_account_id
        WHERE r.strategy_id = $1 ORDER BY r.created_at DESC`,
      [strategy.id]
    );
    const distinctPairs = [...new Set(history.map(h => `${h.exchange}/${h.environment}`))];
    if (distinctPairs.length > 1) {
      conflicting += 1;
      console.log(`${strategy.id}\t${symbol}\t\t\tconflicting_history\t${distinctPairs.join(",")}\t${spellingSuggest(symbol)}\t`);
      continue;
    }
    if (distinctPairs.length === 1) {
      const [exchange, environment] = distinctPairs[0].split("/");
      if (!dryRun) {
        await pool.query(
          `UPDATE strategies SET exchange = $2, environment = $3, updated_at = NOW() WHERE id = $1`,
          [strategy.id, exchange, environment]
        );
      }
      fromSession += 1;
      console.log(`${strategy.id}\t${symbol}\t${exchange}\t${environment}\tsession\t${distinctPairs[0]}\t${spellingSuggest(symbol)}\t`);
      continue;
    }
    // Rule 2 — unique catalog hit over ACTIVE accounts (outage never binds).
    const { rows: accounts } = await pool.query<{ exchange: string; environment: string }>(
      `SELECT DISTINCT exchange, environment FROM exchange_accounts WHERE user_id = $1 AND status = 'ACTIVE'`,
      [strategy.user_id]
    );
    const hits: string[] = [];
    const detail: string[] = [];
    for (const account of accounts) {
      let catalog: string[] | null = null;
      try {
        catalog = await listVenueSymbols(account.exchange, account.environment);
      } catch {
        catalog = null;
      }
      if (catalog === null) {
        detail.push(`${account.exchange}/${account.environment}=unavailable`);
        continue;
      }
      const hit = catalog.some(l => l.toUpperCase() === symbol.toUpperCase());
      detail.push(`${account.exchange}/${account.environment}=${hit ? "hit" : "miss"}`);
      if (hit) hits.push(`${account.exchange}/${account.environment}`);
    }
    const uniqueHits = [...new Set(hits)];
    if (uniqueHits.length === 1) {
      const [exchange, environment] = uniqueHits[0].split("/");
      if (!dryRun) {
        await pool.query(
          `UPDATE strategies SET exchange = $2, environment = $3, updated_at = NOW() WHERE id = $1`,
          [strategy.id, exchange, environment]
        );
      }
      fromCatalog += 1;
      console.log(`${strategy.id}\t${symbol}\t${exchange}\t${environment}\tcatalog\t\t${spellingSuggest(symbol)}\t${detail.join(";")}`);
      continue;
    }
    if (uniqueHits.length > 1) {
      conflicting += 1;
      console.log(`${strategy.id}\t${symbol}\t\t\tconflicting_history\t${uniqueHits.join(",")}\t${spellingSuggest(symbol)}\t${detail.join(";")}`);
      continue;
    }
    // Rule 3 — spelling is suggestion-only, never persisted.
    stillNull += 1;
    console.log(`${strategy.id}\t${symbol}\t\t\tstill_null\t\t${spellingSuggest(symbol)}\t${detail.join(";")}`);
  }

  console.log(
    `\nDone. ${dryRun ? "(dry-run) would-write: " : "wrote: "}` +
      `from_session=${fromSession} from_catalog=${fromCatalog} ` +
      `conflicting_history=${conflicting} still_null=${stillNull} skipped=${skipped}`
  );
  await pool.end();
}

main().catch(error => {
  console.error("Backfill failed:", error);
  process.exitCode = 1;
});
