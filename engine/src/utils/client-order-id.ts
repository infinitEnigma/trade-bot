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

export class ClientOrderIdGenerator {
  private readonly botKey: string;

  constructor(botId: string) {
    if (!botId) {
      throw new Error("ClientOrderIdGenerator requires a non-empty botId");
    }
    // The UUID's hyphens carry no information; strip them so the remaining
    // 32 hex chars fit the exchange's 36-char budget with room for the
    // level and side segments. Any other id keeps the same rule.
    const compact = botId.replace(/-/g, "");

    if (compact.length <= BOT_KEY_WIDTH) {
      this.botKey = compact;
    } else {
      // Deterministic 128-bit hash of the id, hex-encoded (32 chars) —
      // stable across restarts with no new dependencies.
      this.botKey = createHash("sha256")
        .update(botId)
        .digest("hex")
        .slice(0, BOT_KEY_WIDTH);
    }
  }

  generate(levelIndex: number, side: "BUY" | "SELL"): string {
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
    const level = levelIndex.toString(36).padStart(LEVEL_WIDTH, "0");
    const sideChar = side === "BUY" ? "B" : "S";
    const id = `${this.botKey}-${level}-${sideChar}`;
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
  generate(levelIndex: number, side: "BUY" | "SELL"): string;
}

export function createClientOrderIdGenerator(
  botId: string
): GridClientOrderIds {
  return new ClientOrderIdGenerator(botId);
}
