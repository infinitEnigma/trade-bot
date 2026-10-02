/** @format */

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff, Key, Loader2, XCircle } from "lucide-react";
import { Card, MetricIcon, SectionHeader } from "../../../shared/components/ui";
import {
  accountsApi,
  AccountEnvironment,
  AccountExchange,
  ConnectAccountRequest,
  ExchangeAccountDto,
  LIGHTER_MAX_API_KEY_INDEX,
  isLighterPrivateKeyShape,
} from "../../../infrastructure/api/accounts";
import { useAuth } from "../../auth/hooks";
import { SmartToast } from "../../../shared/utils/toast";

interface FormState {
  exchange: AccountExchange;
  environment: AccountEnvironment;
  accountId: string;
  apiKey: string;
  secretKey: string;
  accountIndex: string;
  apiKeyIndex: string;
  privateKey: string;
}

const INITIAL_FORM: FormState = {
  exchange: "kodiak",
  environment: "testnet",
  accountId: "",
  apiKey: "",
  secretKey: "",
  accountIndex: "",
  apiKeyIndex: "",
  privateKey: "",
};

function apiMessage(error: unknown): string {
  const candidate = error as {
    response?: { data?: { error?: string; message?: string } };
    message?: string;
  };
  return (
    candidate?.response?.data?.error ||
    candidate?.response?.data?.message ||
    candidate?.message ||
    "Failed to connect the account"
  );
}

function secretsCleared(form: FormState): Partial<FormState> {
  return form.exchange === "kodiak"
    ? { apiKey: "", secretKey: "" }
    : { privateKey: "" };
}

interface ConnectExchangeAccountProps {
  /** Existing accounts, so an exact duplicate account can be blocked. */
  accounts?: ExchangeAccountDto[];
}

/**
 * ConnectExchangeAccount (C2) — one form for every venue the platform supports.
 *
 * The backend verifies credentials live before an account is usable, so a wrong
 * key surfaces here as an error instead of a silently unusable account. Lighter
 * verification runs through the signer sidecar and is fail-closed: if the
 * sidecar is down, the connect fails with that reason.
 */
export const ConnectExchangeAccount: React.FC<ConnectExchangeAccountProps> = ({
  accounts = [],
}) => {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [showSecrets, setShowSecrets] = useState(false);
  const [formError, setFormError] = useState("");

  const isKodiak = form.exchange === "kodiak";

  const update =
    (field: keyof FormState) =>
    (value: string): void =>
      setForm(previous => ({ ...previous, [field]: value }));

  // Exact-account duplicate guard. The backend unique key is
  // (user_id, exchange, environment, account_ref) — one venue+environment
  // may hold several accounts (e.g. a replacement Lighter index after the
  // venue wiped the old one), so only the same account_ref blocks here.
  // Kodiak's ref is the account ID; Lighter's ref is the account index.
  const pendingRef = isKodiak
    ? form.accountId.trim()
    : /^\d+$/.test(form.accountIndex.trim())
      ? String(Number(form.accountIndex.trim()))
      : form.accountIndex.trim();

  const duplicate =
    pendingRef.length > 0 &&
    accounts.some(
      account =>
        account.exchange === form.exchange &&
        account.environment === form.environment &&
        account.accountRef === pendingRef &&
        account.status !== "REVOKED"
    );

  const duplicateVenueNotice =
    !duplicate &&
    accounts.some(
      account =>
        account.exchange === form.exchange &&
        account.environment === form.environment &&
        account.status !== "REVOKED"
    );

  const validate = (): string => {
    if (isKodiak) {
      if (!form.accountId.trim()) return "Account ID is required";
      if (!form.apiKey.trim()) return "API key is required";
      if (!form.secretKey.trim()) return "Secret key is required";
      return "";
    }
    if (!/^\d+$/.test(form.accountIndex.trim()))
      return "Account index must be a whole number";
    if (Number(form.accountIndex) < 1)
      return "Account index must be at least 1";
    if (!/^\d+$/.test(form.apiKeyIndex.trim()))
      return "API key index must be a whole number";
    if (Number(form.apiKeyIndex) > LIGHTER_MAX_API_KEY_INDEX)
      return `API key index must be ${LIGHTER_MAX_API_KEY_INDEX} or lower`;
    if (!isLighterPrivateKeyShape(form.privateKey))
      return "Private key must be 80 hex characters (40 bytes)";
    return "";
  };

  const buildRequest = (): ConnectAccountRequest =>
    isKodiak
      ? {
          exchange: "kodiak",
          environment: form.environment,
          accountId: form.accountId.trim(),
          apiKey: form.apiKey.trim(),
          secretKey: form.secretKey.trim(),
        }
      : {
          exchange: "lighter",
          environment: form.environment,
          accountIndex: Number(form.accountIndex),
          apiKeyIndex: Number(form.apiKeyIndex),
          privateKey: form.privateKey.trim(),
        };

  const connectMutation = useMutation({
    mutationFn: () => accountsApi.connectAccount(buildRequest()),
    onSuccess: response => {
      if (!response.success) {
        const message =
          response.error || response.message || "Failed to verify credentials";
        setFormError(message);
        SmartToast.error(message);
        return;
      }
      setFormError("");
      setForm(previous => ({ ...previous, ...secretsCleared(previous) }));
      SmartToast.success(
        response.message || `${form.exchange} account connected and verified`
      );
      queryClient.invalidateQueries({
        queryKey: ["exchange-accounts", user?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["kodiak-status", user?.id] });
      // The user level is recomputed server-side after a successful verify.
      refreshUser();
    },
    onError: error => {
      const message = apiMessage(error);
      setFormError(message);
      SmartToast.error(message);
    },
  });

  const secretToggle = (
    <button
      type="button"
      onClick={() => setShowSecrets(!showSecrets)}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-text"
      aria-label={showSecrets ? "Hide secrets" : "Show secrets"}
    >
      {showSecrets ? (
        <EyeOff className="w-4 h-4" />
      ) : (
        <Eye className="w-4 h-4" />
      )}
    </button>
  );

  return (
    <Card>
      <SectionHeader
        title="Connect an Exchange Account"
        subtitle="Credentials are verified live with the venue before trading is enabled"
        actions={<MetricIcon icon={Key} color="primary" />}
      />
      <form
        onSubmit={event => {
          event.preventDefault();
          const message = validate();
          if (message) {
            setFormError(message);
            return;
          }
          setFormError("");
          connectMutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Exchange
            </label>
            <select
              value={form.exchange}
              onChange={event => {
                update("exchange")(event.target.value);
                setFormError("");
              }}
              className="input w-full"
              disabled={connectMutation.isPending}
            >
              <option value="kodiak">Kodiak</option>
              <option value="lighter">Lighter</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Environment
            </label>
            <select
              value={form.environment}
              onChange={event => {
                update("environment")(event.target.value);
                setFormError("");
              }}
              className="input w-full"
              disabled={connectMutation.isPending}
            >
              <option value="testnet">Testnet</option>
              <option value="mainnet">Mainnet</option>
            </select>
          </div>
        </div>

        {isKodiak ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Account ID
              </label>
              <input
                type="text"
                value={form.accountId}
                onChange={event => update("accountId")(event.target.value)}
                className="input w-full"
                placeholder="Your Kodiak account ID"
                disabled={connectMutation.isPending}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showSecrets ? "text" : "password"}
                  value={form.apiKey}
                  onChange={event => update("apiKey")(event.target.value)}
                  className="input w-full pr-10"
                  placeholder="ed25519:…"
                  disabled={connectMutation.isPending}
                />
                {secretToggle}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text mb-2">
                Secret Key
              </label>
              <div className="relative">
                <input
                  type={showSecrets ? "text" : "password"}
                  value={form.secretKey}
                  onChange={event => update("secretKey")(event.target.value)}
                  className="input w-full pr-10"
                  placeholder="Your Kodiak secret key"
                  disabled={connectMutation.isPending}
                />
                {secretToggle}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Account Index
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={form.accountIndex}
                onChange={event => update("accountIndex")(event.target.value)}
                className="input w-full"
                placeholder="e.g. 404"
                disabled={connectMutation.isPending}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                API Key Index
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={form.apiKeyIndex}
                onChange={event => update("apiKeyIndex")(event.target.value)}
                className="input w-full"
                placeholder="indices 0-1 are reserved for the web app"
                disabled={connectMutation.isPending}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text mb-2">
                API Private Key
              </label>
              <div className="relative">
                <input
                  type={showSecrets ? "text" : "password"}
                  value={form.privateKey}
                  onChange={event => update("privateKey")(event.target.value)}
                  className="input w-full pr-10 font-mono"
                  placeholder="80 hex characters (40 bytes)"
                  disabled={connectMutation.isPending}
                />
                {secretToggle}
              </div>
            </div>
          </div>
        )}

        {duplicate && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-info/10 border border-info/20">
            <AlertCircle className="w-4 h-4 text-info shrink-0" />
            <p className="text-info text-sm">
              This {form.exchange} ({form.environment}) account &quot;
              {pendingRef}&quot; is already connected.
            </p>
          </div>
        )}

        {duplicateVenueNotice && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-white/5 border border-white/10">
            <AlertCircle className="w-4 h-4 text-textMuted shrink-0" />
            <p className="text-textMuted text-sm">
              Another {form.exchange} ({form.environment}) account is already
              connected — both can coexist; the backend keys accounts by account
              reference.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 p-4 rounded-lg bg-info/10 border border-info/20">
          <AlertCircle className="w-4 h-4 text-info shrink-0" />
          <div className="text-sm">
            <p className="text-info font-medium">Security Notice</p>
            <p className="text-textMuted mt-1">
              Credentials are encrypted with AES-256 before storage, decrypted
              in memory only when needed, and every connection change is written
              to the security audit log.
            </p>
          </div>
        </div>

        {formError && (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-danger/10 border border-danger/20">
            <XCircle className="w-4 h-4 text-danger shrink-0" />
            <p className="text-danger text-sm">{formError}</p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={connectMutation.isPending || duplicate}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {connectMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Key className="w-4 h-4" />
            )}
            Connect &amp; Verify
          </button>
        </div>
      </form>
    </Card>
  );
};
