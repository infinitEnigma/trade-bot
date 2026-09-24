/**
 * Exchange-account repository adapter — generic venue/environment (C2).
 *
 * Replaces the legacy single-row credentials table (UNIQUE(user_id)): many accounts per user,
 * `exchange` reuses the engine ExchangeKind vocabulary, secrets live in a
 * single versioned JSON envelope (`credentials_encrypted`, Q1 decision).
 *
 * Backfill contract (migration 012): backfilled rows carry a
 * `kodiak-legacy` wrapper envelope whose fields are the untouched legacy
 * per-field ciphertext blobs. Returned verbatim here — decryption happens
 * in the credentials provider + account service, never in this adapter.
 *
 * @format
 */

import type {
  ConnectExchangeAccountRequest,
  ExchangeAccount,
  ExchangeAccountStatus,
  ExchangeAccountWithSecret,
  IExchangeAccountRepository,
} from "@trade-bot/shared";
import { query } from "../../../database/pool";

interface ExchangeAccountRow {
  id: string;
  user_id: string;
  exchange: string;
  environment: string;
  account_ref: string;
  credentials_encrypted?: string;
  encryption_version?: number | null;
  status: string;
  verified_at: string | null;
  last_verified_at: string | null;
  meta: Record<string, unknown> | string;
  created_at: string;
  updated_at: string;
}

function parseMeta(
  meta: Record<string, unknown> | string
): Record<string, unknown> {
  if (typeof meta === "object" && meta !== null) return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

function mapRow(row: ExchangeAccountRow): ExchangeAccount {
  return {
    id: row.id,
    userId: row.user_id,
    exchange: row.exchange as ExchangeAccount["exchange"],
    environment: row.environment as ExchangeAccount["environment"],
    accountRef: row.account_ref,
    status: row.status as ExchangeAccountStatus,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
    lastVerifiedAt: row.last_verified_at
      ? new Date(row.last_verified_at)
      : null,
    meta: parseMeta(row.meta),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SELECT_COLS = `id, user_id, exchange, environment, account_ref, status,
  verified_at, last_verified_at, meta, created_at, updated_at`;

function requestCoords(request: ConnectExchangeAccountRequest): {
  exchange: string;
  environment: string;
  accountRef: string;
} {
  if (request.exchange === "kodiak") {
    return {
      exchange: "kodiak",
      environment: request.environment,
      accountRef: request.accountId,
    };
  }
  return {
    exchange: "lighter",
    environment: request.environment,
    accountRef: String(request.accountIndex),
  };
}

export class ExchangeAccountRepositoryAdapter implements IExchangeAccountRepository {
  /**
   * Optional `queryFn` lets callers such as `withCredentials` route through
   * an injected query (unit tests pass a mock without patching the pool
   * module). Every other caller keeps the module-level `query` default.
   */
  async listAccounts(
    userId: string,
    queryFn: typeof query = query
  ): Promise<ExchangeAccount[]> {
    const result = await queryFn<ExchangeAccountRow>(
      `SELECT ${SELECT_COLS} FROM exchange_accounts WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    return result.rows.map(mapRow);
  }

  async getAccountWithSecret(
    userId: string,
    accountId: string,
    queryFn: typeof query = query
  ): Promise<ExchangeAccountWithSecret | null> {
    const result = await queryFn<ExchangeAccountRow>(
      `SELECT ${SELECT_COLS}, credentials_encrypted, encryption_version
       FROM exchange_accounts WHERE id = $1 AND user_id = $2`,
      [accountId, userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...mapRow(row),
      credentialsEncrypted: row.credentials_encrypted ?? "",
      encryptionVersion: row.encryption_version ?? null,
    };
  }

  async createPending(input: {
    userId: string;
    request: ConnectExchangeAccountRequest;
    credentialsEncrypted: string;
    encryptionVersion: number | null;
  }): Promise<ExchangeAccount> {
    const coords = requestCoords(input.request);
    const result = await query<ExchangeAccountRow>(
      `INSERT INTO exchange_accounts
         (user_id, exchange, environment, account_ref, credentials_encrypted,
          encryption_version, status, meta, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', '{}', now())
       RETURNING ${SELECT_COLS}`,
      [
        input.userId,
        coords.exchange,
        coords.environment,
        coords.accountRef,
        input.credentialsEncrypted,
        input.encryptionVersion,
      ]
    );
    if (result.rows.length === 0) throw new Error("Account creation failed");
    return mapRow(result.rows[0]);
  }

  async setStatus(
    userId: string,
    accountId: string,
    status: ExchangeAccountStatus,
    verified: boolean
  ): Promise<boolean> {
    const result = await query(
      `UPDATE exchange_accounts
       SET status = $3,
           verified_at = CASE WHEN $4 AND verified_at IS NULL THEN now() ELSE verified_at END,
           last_verified_at = CASE WHEN $4 THEN now() ELSE last_verified_at END,
           updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [accountId, userId, status, verified]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async rewriteEnvelope(
    userId: string,
    accountId: string,
    credentialsEncrypted: string,
    encryptionVersion: number | null
  ): Promise<boolean> {
    const result = await query(
      `UPDATE exchange_accounts
       SET credentials_encrypted = $3, encryption_version = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [accountId, userId, credentialsEncrypted, encryptionVersion]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteAccount(userId: string, accountId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM exchange_accounts WHERE id = $1 AND user_id = $2`,
      [accountId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countActive(userId: string): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM exchange_accounts
       WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId]
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }
}

export const exchangeAccountRepositoryAdapter =
  new ExchangeAccountRepositoryAdapter();
