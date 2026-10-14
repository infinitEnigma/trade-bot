/** @format */

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ExchangeAccountDto } from "../../../infrastructure/api/accounts";
import { accountsApi } from "../../../infrastructure/api/accounts";
import { globalBalanceManager } from "../../../shared/services/balance-manager";

/**
 * Single source of truth for "which exchange account is the Dashboard
 * scoped to". Replaces the old split state — a local `portfolioAccountId`
 * (defaulting to newest ACTIVE) and a separate `?tradesAccount=` URL param —
 * with one URL-persisted `?exchangeAccountId=` selection.
 *
 * Semantics preserved from the code it replaces:
 *  - Default selection is the most-recently-created ACTIVE account (the old
 *    `portfolioAccounts[0]` deterministic default — never "kodiak first").
 *  - A stale / foreign / non-ACTIVE id in the URL falls back to the default
 *    rather than to a scoped query the user never asked for.
 *  - The param name matches the backend contract (`exchangeAccountId`).
 *
 * Legacy continuity: the previous Dashboard persisted trades scope under
 * `?tradesAccount=`. We read that as a fallback (so existing shared links /
 * bookmarks still land scoped) and strip it once `exchangeAccountId` is
 * written, leaving a single param behind. A stale / unknown id is also
 * stripped once the account list resolves, so a copied link to a deleted
 * account never leaves a dead param in the URL.
 */
const LEGACY_PARAM = "tradesAccount";
const SCOPE_PARAM = "exchangeAccountId";

export interface AccountScope {
  /** ACTIVE exchange accounts, newest-created first (selector source). */
  accounts: ExchangeAccountDto[];
  /** Resolved active account id (URL value if valid, else newest ACTIVE). */
  selectedAccountId: string;
  /** `id → "EXCHANGE (env) ref"` display label for each ACTIVE account. */
  accountLabels: Record<string, string>;
  /**
   * Set the scoped account. Persists to `?exchangeAccountId=` and clears the
   * legacy `?tradesAccount=` param. Passing the currently-defaulted value
   * still writes it explicitly (an explicit choice the user can re-share).
   */
  selectAccount: (id: string) => void;
  /** True while the account list is loading. */
  isLoading: boolean;
}

export function useAccountScope(userId: string | undefined): AccountScope {
  const [searchParams, setSearchParams] = useSearchParams();

  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", userId],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const accounts: ExchangeAccountDto[] = useMemo(
    () =>
      (accountsQuery.data?.data?.accounts ?? [])
        .filter(account => account.status === "ACTIVE")
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
    [accountsQuery.data]
  );

  const accountLabels = useMemo(
    () =>
      Object.fromEntries(
        accounts.map(a => [
          a.id,
          `${a.exchange} (${a.environment}) ${a.accountRef}`,
        ])
      ) as Record<string, string>,
    [accounts]
  );

  const urlValue = searchParams.get(SCOPE_PARAM);
  const legacyValue = searchParams.get(LEGACY_PARAM);

  // A URL id is honoured only if it maps to a known ACTIVE account; anything
  // else (stale, foreign, non-ACTIVE, missing) falls back to the newest
  // ACTIVE default — never to a scoped query the user didn't ask for.
  const selectedAccountId = useMemo(() => {
    const valid = (value: string | null) =>
      value ? (accounts.some(a => a.id === value) ? value : "") : "";
    const fromUrl = valid(urlValue);
    if (fromUrl) return fromUrl;
    const fromLegacy = valid(legacyValue);
    if (fromLegacy) return fromLegacy;
    return accounts[0]?.id ?? "";
  }, [urlValue, legacyValue, accounts]);

  const selectAccount = useCallback(
    (id: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set(SCOPE_PARAM, id);
          // Collapse the legacy param so only one scope key remains in the URL.
          next.delete(LEGACY_PARAM);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // The app-global balance widget follows the displayed account (previously a
  // page-level effect on the local `portfolioAccountId` — moved here).
  useEffect(() => {
    globalBalanceManager.setActiveExchangeAccountId(selectedAccountId || null);
  }, [selectedAccountId]);

  // URL hygiene: once the account list resolves, collapse any stale /
  // unknown id to the newest-ACTIVE default (strip), and migrate a valid
  // legacy `?tradesAccount=` to the canonical `?exchangeAccountId=` (read-
  // then-strip). Runs only when accounts are known and the selection was
  // defaulted, so an explicit user choice is never overwritten.
  const accountsLoaded = !accountsQuery.isLoading && !!accountsQuery.data;
  useEffect(() => {
    if (!accountsLoaded || accounts.length === 0) return;
    const urlValid = urlValue && accounts.some(a => a.id === urlValue);
    if (urlValid) {
      // A valid canonical value still collapses a leftover legacy param.
      if (legacyValue) {
        setSearchParams(
          prev => {
            const next = new URLSearchParams(prev);
            next.delete(LEGACY_PARAM);
            return next;
          },
          { replace: true }
        );
      }
      return;
    }
    const legacyValid = legacyValue && accounts.some(a => a.id === legacyValue);
    if (legacyValid) {
      // Migrate: promote the legacy id to the canonical param, drop legacy.
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set(SCOPE_PARAM, legacyValue);
          next.delete(LEGACY_PARAM);
          return next;
        },
        { replace: true }
      );
      return;
    }
    // No valid id anywhere — strip stale params so the URL never carries a
    // dead scope (the in-memory selection already defaulted above).
    if (urlValue || legacyValue) {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.delete(SCOPE_PARAM);
          next.delete(LEGACY_PARAM);
          return next;
        },
        { replace: true }
      );
    }
  }, [accountsLoaded, accounts, urlValue, legacyValue, setSearchParams]);

  return {
    accounts,
    selectedAccountId,
    accountLabels,
    selectAccount,
    isLoading: accountsQuery.isLoading,
  };
}
