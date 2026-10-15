/**
 * Exchange account lookup PORT — the one account read the lifecycle service
 * needs for venue admission (C3a / 026): account existence, ACTIVE status and
 * the exchange/environment pair the strategy venue is validated against.
 *
 * Narrowed from the shared `IExchangeAccountRepository` (dependency inversion
 * — review P1, 2026-10-15): the service deliberately depends on one method,
 * not the whole adapter. The PostgreSQL/encryption implementation is
 * `infrastructure/adapters/repositories/exchange-account-repository.adapter.ts`,
 * wired at startup (`index.ts` `setExchangeAccountLookup`).
 *
 * @format
 */

import type { IExchangeAccountRepository } from "@trade-bot/shared";

export type ExchangeAccountLookup = Pick<
  IExchangeAccountRepository,
  "getAccountWithSecret"
>;
