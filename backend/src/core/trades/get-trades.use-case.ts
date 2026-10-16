/** @format */

/**
 * GET /api/trades use case — owns the ownership-validation policy and the
 * multi-repository read behind the Recent-Trades surfaces (Batch 1).
 *
 * The controller (`trades.routes.ts`) translates HTTP; this class owns the
 * operation: validate each optional scope id against the caller's own rows
 * (400 malformed / 404 foreign-or-missing), clamp the limit, then read the
 * ledger. Dependency inversion — external review P1, 2026-10-15: the route no
 * longer orchestrates repository adapters; `server/route-config.ts` wires them
 * into the use case.
 *
 * `resolveOwnedId` keeps its exported name and contract (unit-tested) from
 * the former route module.
 */

import { FilteredTrade } from "../types/filtered-trade";

/** The ledger read the use case needs (implemented by TradeRepositoryAdapter). */
export interface TradeLedgerReader {
  getTradesFiltered(
    userId: string,
    filters: {
      exchangeAccountId?: string;
      strategyId?: string;
      limit?: number;
    }
  ): Promise<FilteredTrade[]>;
}

/**
 * Ownership predicates. Both answer "does this id exist for THIS user?" —
 * a foreign id is indistinguishable from a missing one (no existence leak).
 * Shape only; route-config adapts the concrete repositories to it.
 */
export interface OwnedIdCheckers {
  strategyExistsForUser(strategyId: string, userId: string): Promise<boolean>;
  /** True when the account row loads for this user (no decryption needed). */
  accountExistsForUser(userId: string, accountId: string): Promise<boolean>;
}

export interface GetTradesQuery {
  userId: string;
  strategyId?: unknown;
  exchangeAccountId?: unknown;
  limit?: unknown;
}

export type GetTradesResult =
  | { ok: true; rows: FilteredTrade[] }
  | { ok: false; status: 400 | 404 | 500; error: string };

/** Loose v4 uuid shape — rows are written by gen_random_uuid(). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Validate one optional id param against the caller's own rows.
 *
 * - absent → `{ ok: true }` (no filter);
 * - malformed → `{ ok: false, status: 400 }`;
 * - unknown or foreign → `{ ok: false, status: 404 }`.
 *
 * Exported for unit tests (the 400/404 contract). `existsForUser` answers
 * ownership, so a foreign id is indistinguishable from a missing one.
 */
export async function resolveOwnedId(
  userId: string,
  raw: unknown,
  existsForUser: (userId: string, id: string) => Promise<boolean>
): Promise<{ ok: true; id?: string } | { ok: false; status: 400 | 404 }> {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
    return { ok: false, status: 400 };
  }
  const owned = await existsForUser(userId, raw);
  if (!owned) return { ok: false, status: 404 };
  return { ok: true, id: raw };
}

export class GetTradesUseCase {
  constructor(
    private readonly deps: {
      trades: TradeLedgerReader;
      checkers: OwnedIdCheckers;
    }
  ) {}

  async execute(query: GetTradesQuery): Promise<GetTradesResult> {
    const strategyScope = await resolveOwnedId(
      query.userId,
      query.strategyId,
      (userId, id) => this.deps.checkers.strategyExistsForUser(id, userId)
    );
    if (!strategyScope.ok) {
      return {
        ok: false,
        status: strategyScope.status,
        error: "Strategy not found",
      };
    }

    const accountScope = await resolveOwnedId(
      query.userId,
      query.exchangeAccountId,
      (userId, id) => this.deps.checkers.accountExistsForUser(userId, id)
    );
    if (!accountScope.ok) {
      return {
        ok: false,
        status: accountScope.status,
        error: "Exchange account not found",
      };
    }

    const rawLimit =
      typeof query.limit === "number" ? query.limit : DEFAULT_LIMIT;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const rows = await this.deps.trades.getTradesFiltered(query.userId, {
      exchangeAccountId: accountScope.id,
      strategyId: strategyScope.id,
      limit,
    });
    return { ok: true, rows };
  }
}
