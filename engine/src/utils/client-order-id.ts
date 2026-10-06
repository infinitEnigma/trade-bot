/** @format */

/**
 * Deterministic, exchange-acceptable client order ids.
 *
 * The grid's idempotency story rests on the same logical order deriving the
 * same id after a crash/restart or a redelivered command, while the exchange
 * rejects a second submission carrying an id that is already open.
 *
 * Exchange contract (Orderly): max 36 characters, hyphen accepted but not as
 * the first character (see ./payload.ts for the recorded facts). The previous
 * `{botId}:{levelIndex}:{side}` format violated all three constraints
 * (~44+ chars, contains colons), so it could never be accepted by the
 * exchange.
 *
 * Format (max 36 chars): `<botKey>-<levelIndex(base36)>-<B|S>`
 * - `botKey` is the bot id with `-` stripped; when longer than the 30-char
 *   segment budget (e.g. a UUID), it collapses to a 30-char sha256 prefix.
 * - `levelIndex` is the zero-padded base-36 level index (2 chars).
 * - `B` / `S` is the side.
 *
 * Slot generations (G1): a generation ≥ 1 appends `-<generation(base36)>`
 * after the side and shrinks `botKey` so the id still fits the 36-char
 * contract. Generation 0 renders byte-identical to the pre-G1 format, so ids
 * already live on an exchange keep resolving after an upgrade. A slot's
 * generation is bumped by `OrderManager.markFilled` whenever a fill books —
 * the next cycle then derives a **fresh** id (Lighter: a fresh
 * `client_order_index`), so the pre-submit lookup can never hit the venue's
 * terminal history row for the spent one. That stale row was G1: it booked a
 * phantom fill and blocked re-placement of the slot (Gate 1 report §3.1).
 *
 * Every input combination maps to a distinct id, and the same inputs always
 * produce the same id.
 */

import { createHash } from "crypto";
import { isAcceptedOrderlyClientOrderId } from "../exchanges/kodiak/payload";

/** Total length budget the exchange enforces. */
const MAX_LENGTH = 36;
/** Width of the base-36 level index segment. */
const LEVEL_WIDTH = 2;
/** Side marker segment. */
const SIDE_WIDTH = 2; // side char + '-' separator
/** Remaining budget for the bot-key segment. */
const BOT_KEY_WIDTH = MAX_LENGTH - LEVEL_WIDTH - SIDE_WIDTH - 2;
/** Highest generation: base-36 `zzz` (`-` + 3 chars is the widest suffix). */
export const CLIENT_ORDER_ID_MAX_GENERATION = 36 ** 3 - 1;

export class ClientOrderIdGenerator {
  private readonly botId: string;
  private readonly compact: string;
  /**
   * D3 sessions: per-run namespace so two runs in one session can never
   * derive the same id. `null` = legacy bot-namespaced ids (pre-D snapshots
   * keep resolving; the snapshot's migration-on-read covers the state).
   */
  private readonly namespace: string | null;

  constructor(botId: string, runId?: string) {
    if (!botId) {
      throw new Error("ClientOrderIdGenerator requires a non-empty botId");
    }
    this.botId = botId;
    // The UUID's hyphens carry no information; strip them so the remaining
    // 32 hex chars fit the exchange's 36-char budget with room for the
    // level and side segments. Any other id keeps the same rule.
    // A run namespace hashes in alongside the bot id — deterministic, so
    // ids stay restart-stable within the run.
    const scope = runId ? `${botId}/${runId}` : botId;
    this.compact = scope.replace(/-/g, "").replace(/\//g, "");
    this.namespace = runId ?? null;
  }

  /** Bot-key segment of the requested width: short ids pass through, long
   * ones collapse to a deterministic sha256 prefix (stable across restarts). */
  private botKeyFor(width: number): string {
    if (this.compact.length <= width) return this.compact;
    // Hash the full scope (bot + run namespace), not just the bot id, so
    // two runs in one session hash to different keys.
    const scope = this.namespace
      ? `${this.botId}/${this.namespace}`
      : this.botId;
    return createHash("sha256").update(scope).digest("hex").slice(0, width);
  }

  generate(levelIndex: number, side: "BUY" | "SELL", generation = 0): string {
    if (!Number.isInteger(levelIndex) || levelIndex < 0) {
      throw new Error(
        `levelIndex must be a non-negative integer, got ${levelIndex}`
      );
    }
    if (levelIndex >= 36 ** LEVEL_WIDTH) {
      throw new Error(
        `levelIndex ${levelIndex} exceeds the ${LEVEL_WIDTH}-char base-36 range`
      );
    }
    if (
      !Number.isInteger(generation) ||
      generation < 0 ||
      generation > CLIENT_ORDER_ID_MAX_GENERATION
    ) {
      throw new Error(
        `generation must be an integer in [0, ${CLIENT_ORDER_ID_MAX_GENERATION}], got ${generation}`
      );
    }
    const level = levelIndex.toString(36).padStart(LEVEL_WIDTH, "0");
    const sideChar = side === "BUY" ? "B" : "S";
    const suffix = generation === 0 ? "" : `-${generation.toString(36)}`;
    const botKey = this.botKeyFor(BOT_KEY_WIDTH - suffix.length);
    const id = `${botKey}-${level}-${sideChar}${suffix}`;
    if (!isAcceptedOrderlyClientOrderId(id)) {
      // Defensive: the construction above must always satisfy the contract.
      throw new Error(
        `generated client order id violates the exchange contract: ${id}`
      );
    }
    return id;
  }
}

/** Maximum grid levels the generator can address (36^2 = 1,296). */
export const CLIENT_ORDER_ID_MAX_LEVELS = 36 ** LEVEL_WIDTH;

export interface GridClientOrderIds {
  generate(
    levelIndex: number,
    side: "BUY" | "SELL",
    generation?: number
  ): string;
}

export function createClientOrderIdGenerator(
  botId: string,
  runId?: string
): GridClientOrderIds {
  return new ClientOrderIdGenerator(botId, runId);
}
