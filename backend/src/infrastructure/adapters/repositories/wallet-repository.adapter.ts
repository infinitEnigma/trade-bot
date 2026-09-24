/**
 * Wallet repository adapter — chain-aware multi-wallet storage (C2).
 *
 * Replaces the legacy single-row wallet table (UNIQUE(user_id)):
 * many wallets per user, closed chain set ('evm' | 'solana' | 'bitcoin'),
 * exactly one primary (`uq_wallets_primary` partial unique index), same
 * address allowed on different chains and across users.
 *
 * Address normalization rules (verify path lowercases before calling):
 * - evm: lowercase hex (0x…); - solana/bitcoin: verbatim (base58/bech32
 *   are case-sensitive — never lowercase them here).
 *
 * @format
 */

import type { ChainKind, IWalletRepository, Wallet } from "@trade-bot/shared";
import { query } from "../../../database/pool";

interface WalletRow {
  id: string;
  user_id: string;
  chain: string;
  address: string;
  label: string | null;
  is_primary: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: WalletRow): Wallet {
  return {
    id: row.id,
    userId: row.user_id,
    chain: row.chain as ChainKind,
    address: row.address,
    label: row.label,
    isPrimary: row.is_primary,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SELECT_COLS = `id, user_id, chain, address, label, is_primary, verified_at, created_at, updated_at`;

export class WalletRepositoryAdapter implements IWalletRepository {
  async listWallets(userId: string): Promise<Wallet[]> {
    const result = await query<WalletRow>(
      `SELECT ${SELECT_COLS} FROM wallets WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [userId]
    );
    return result.rows.map(mapRow);
  }

  async getPrimaryWallet(userId: string): Promise<Wallet | null> {
    const result = await query<WalletRow>(
      `SELECT ${SELECT_COLS} FROM wallets WHERE user_id = $1 AND is_primary = true`,
      [userId]
    );
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
  }

  async upsertVerified(
    userId: string,
    wallet: {
      chain: ChainKind;
      address: string;
      label?: string;
      makePrimary?: boolean;
    }
  ): Promise<Wallet> {
    // First verified wallet becomes primary; explicit makePrimary re-homes it.
    const result = await query<WalletRow>(
      `INSERT INTO wallets (user_id, chain, address, label, is_primary, verified_at, updated_at)
       VALUES ($1, $2, $3, $4,
         COALESCE($5, NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = $1)),
         now(), now())
       ON CONFLICT (user_id, chain, address) DO UPDATE SET
         label = COALESCE(EXCLUDED.label, wallets.label),
         is_primary = CASE WHEN EXCLUDED.is_primary THEN TRUE ELSE wallets.is_primary END,
         verified_at = COALESCE(wallets.verified_at, now()),
         updated_at = now()
       RETURNING ${SELECT_COLS}`,
      [
        userId,
        wallet.chain,
        wallet.address,
        wallet.label ?? null,
        wallet.makePrimary ?? null,
      ]
    );
    if (result.rows.length === 0) throw new Error("Wallet upsert failed");
    const upserted = mapRow(result.rows[0]);
    if (upserted.isPrimary) {
      await query(
        `UPDATE wallets SET is_primary = false WHERE user_id = $1 AND id <> $2`,
        [userId, upserted.id]
      );
    }
    return upserted;
  }

  async setPrimary(userId: string, walletId: string): Promise<boolean> {
    const owned = await query<{ id: string }>(
      `SELECT id FROM wallets WHERE id = $1 AND user_id = $2`,
      [walletId, userId]
    );
    if (owned.rows.length === 0) return false;
    await query(`UPDATE wallets SET is_primary = false WHERE user_id = $1`, [
      userId,
    ]);
    const result = await query(
      `UPDATE wallets SET is_primary = true, updated_at = now() WHERE id = $1 AND user_id = $2`,
      [walletId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async remove(userId: string, walletId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM wallets WHERE id = $1 AND user_id = $2`,
      [walletId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countVerified(userId: string): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM wallets WHERE user_id = $1 AND verified_at IS NOT NULL`,
      [userId]
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }
}

export const walletRepositoryAdapter = new WalletRepositoryAdapter();
