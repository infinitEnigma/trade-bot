/** @format */

/**
 * Backfill `meta.walletBinding` from the venue's public account endpoints (X4).
 *
 * Idempotent: rows that already carry a `walletBinding` are reported as
 * SKIPPED (pass `--force` to re-resolve and overwrite). Per row it logs the
 * venue-asserted owner, the user's linked wallets and a MATCH / NO-OWNER /
 * NOT-LINKED verdict. Wallet-membership is NOT enforced here — the start gate
 * does that; this script only records what the venue claims.
 *
 * Run once against the live DB before deploying the enforcement build:
 *   npx ts-node scripts/backfill-wallet-bindings.ts [--force]
 */

import fs from "fs";
import path from "path";
import { Pool } from "pg";
import dotenv from "dotenv";
import { resolveVenueOwner } from "../src/infrastructure/external/exchange-accounts/venue-owner";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

interface AccountRow {
  id: string;
  user_id: string;
  exchange: string;
  environment: string;
  account_ref: string;
  meta: Record<string, unknown> | string | null;
}

function parseMeta(raw: AccountRow["meta"]): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function short(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-5)}`;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "trade_bot",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
  });

  const { rows: accounts } = await pool.query<AccountRow>(
    `SELECT id, user_id, exchange, environment, account_ref, meta
     FROM exchange_accounts
     WHERE status <> 'REVOKED'
     ORDER BY created_at ASC`
  );
  console.log(`Found ${accounts.length} account(s) to consider.`);

  let stored = 0;
  let skipped = 0;
  let noOwner = 0;
  let notLinked = 0;

  for (const account of accounts) {
    const meta = parseMeta(account.meta);
    const existing = (meta.walletBinding ?? null) as { address?: string } | null;
    const label = `${account.exchange}/${account.environment} ${account.account_ref} (${account.id})`;

    if (existing?.address && !force) {
      console.log(`SKIPPED  ${label} — already bound to ${short(existing.address)}`);
      skipped += 1;
      continue;
    }

    const owner = await resolveVenueOwner({
      exchange: account.exchange as "kodiak" | "lighter",
      environment: account.environment,
      ...(account.exchange === "kodiak"
        ? { accountId: account.account_ref }
        : { accountIndex: Number(account.account_ref) }),
    });

    if (!owner) {
      console.log(`NO-OWNER ${label} — venue returned no owner`);
      noOwner += 1;
      continue;
    }

    const { rows: wallets } = await pool.query<{ address: string }>(
      `SELECT address FROM wallets WHERE user_id = $1 AND chain = 'evm'`,
      [account.user_id]
    );
    const linkedList = wallets.map(w => w.address);
    const linked = linkedList.some(a => a.toLowerCase() === owner);
    const verdict = linked ? "MATCH" : "NOT-LINKED";
    if (!linked) notLinked += 1;

    await pool.query(
      `UPDATE exchange_accounts
       SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
             'walletBinding', $2::jsonb
           ),
           updated_at = now()
       WHERE id = $1`,
      [
        account.id,
        JSON.stringify({
          address: owner,
          verifiedAt: new Date().toISOString(),
          source: "venue",
        }),
      ]
    );
    stored += 1;
    console.log(
      `${verdict.padEnd(9)} ${label} — owner ${short(owner)}, linked wallets: ${
        linkedList.length > 0 ? linkedList.map(short).join(", ") : "(none)"
      }`
    );
  }

  console.log(
    `\nDone. stored=${stored} skipped=${skipped} no-owner=${noOwner} not-linked=${notLinked}`
  );
  await pool.end();
}

main().catch(error => {
  console.error("Backfill failed:", error);
  process.exitCode = 1;
});
