/** @format */

import React from "react";
import { Key, AlertCircle, Eye, EyeOff, Loader2, XCircle } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { SectionHeader } from "../../../shared/components/ui";
import { KodiakCredentials as CredentialsType, KodiakStatus } from "../types/settings.types";

interface KodiakCredentialsProps {
  kodiakStatus: KodiakStatus;
  formData: CredentialsType;
  showSecrets: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  connectError?: string;
  onConnect: (e: React.FormEvent) => void;
  onDisconnect: () => void;
  onUpdateField: (field: keyof CredentialsType, value: string) => void;
  onToggleSecrets: () => void;
}

/**
 * KodiakCredentials component - handles Kodiak account connection/disconnection
 */
export const KodiakCredentials: React.FC<KodiakCredentialsProps> = ({
  kodiakStatus,
  formData,
  showSecrets,
  isConnecting,
  isDisconnecting,
  connectError,
  onConnect,
  onDisconnect,
  onUpdateField,
  onToggleSecrets,
}) => {
  return (
    <Card>
      <SectionHeader
        title="Kodiak Trading Credentials"
        subtitle="Connect your Kodiak account to enable automated trading strategies"
        actions={<Key className="w-5 h-5 text-primary" />}
      />

      {kodiakStatus.connected ? (
        /* Connected State */
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
            <div className="w-4 h-4 bg-success rounded-full"></div>
            <div className="flex-1">
              <p className="font-medium text-success">
                Kodiak Account Connected
              </p>
              <p className="text-sm text-textMuted">
                Account ID: {kodiakStatus.accountId}
              </p>
              {kodiakStatus.connectedAt && (
                <p className="text-sm text-textMuted">
                  Connected: {new Date(kodiakStatus.connectedAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <button
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="btn-danger flex items-center gap-2 disabled:opacity-50"
            >
              {isDisconnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              Disconnect
            </button>
          </div>

          <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
            <div className="w-4 h-4 bg-success rounded-full"></div>
            <p className="text-success font-medium">
              Kodiak Credentials Provided
            </p>
          </div>
        </div>
      ) : (
        /* Not Connected State - Show Status and Form */
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
            <AlertCircle className="w-4 h-4 text-warning" />
            <p className="text-warning font-medium">
              No Credentials Provided
            </p>
          </div>

          <form onSubmit={onConnect} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Account ID
                </label>
                <input
                  type="text"
                  value={formData.accountId}
                  onChange={(e) => onUpdateField("accountId", e.target.value)}
                  className="input w-full"
                  placeholder="Your Kodiak Account ID"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showSecrets ? "text" : "password"}
                    value={formData.apiKey}
                    onChange={(e) => onUpdateField("apiKey", e.target.value)}
                    className="input w-full pr-10"
                    placeholder="Your Kodiak API Key"
                    required
                  />
                  <button
                    type="button"
                    onClick={onToggleSecrets}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-text"
                  >
                    {showSecrets ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text mb-2">
                  Secret Key
                </label>
                <div className="relative">
                  <input
                    type={showSecrets ? "text" : "password"}
                    value={formData.secretKey}
                    onChange={(e) => onUpdateField("secretKey", e.target.value)}
                    className="input w-full pr-10"
                    placeholder="Your Kodiak Secret Key"
                    required
                  />
                  <button
                    type="button"
                    onClick={onToggleSecrets}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-text"
                  >
                    {showSecrets ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 p-4 rounded-lg bg-info/10 border border-info/20">
              <AlertCircle className="w-4 h-4 text-info shrink-0" />
              <div className="text-sm">
                <p className="text-info font-medium">Security Notice</p>
                <p className="text-textMuted mt-1">
                  Your API credentials are encrypted and stored securely.
                  We never display your secret key after connection.
                </p>
              </div>
            </div>

            {connectError && (
              <div className="flex items-center gap-2 p-4 rounded-lg bg-danger/10 border border-danger/20">
                <XCircle className="w-4 h-4 text-danger" />
                <p className="text-danger text-sm">
                  Failed to connect Kodiak credentials. Please check your credentials and try again.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isConnecting || !formData.accountId || !formData.apiKey || !formData.secretKey}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Key className="w-4 h-4" />
                )}
                Connect Kodiak Account
              </button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
};
