/** @format */

import React, { useState } from "react";
import { useAuth, useKodiakStatus, useConnectKodiak, useDisconnectKodiak } from "../../auth/hooks";
import { kodiakApi } from "../../../infrastructure/api/kodiak";
import {
  Key,
  Shield,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { SectionHeader } from "../../../shared/components/ui";
import { MetricIcon } from "../../../shared/components/ui";
import { Container, Grid } from "../../../shared/components/layout";
import { SmartToast } from "../../../lib/toast";

const Settings: React.FC = () => {
  const { user } = useAuth();
  const { data: kodiakStatus, isLoading: statusLoading } = useKodiakStatus();
  const [showSecrets, setShowSecrets] = useState(false);
  const [formData, setFormData] = useState({
    accountId: "",
    apiKey: "",
    secretKey: "",
  });

  // Connect Kodiak mutation with React Query
  const connectMutation = useConnectKodiak();

  // Disconnect Kodiak mutation with React Query
  const disconnectMutation = useDisconnectKodiak();

  const isConnected = kodiakStatus?.data?.connected || false;
  const kodiakData = kodiakStatus?.data;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate credentials format
    const validation = kodiakApi.validateCredentialsFormat(formData);
    if (!validation.isValid) {
      SmartToast.error(validation.errors[0]);
      return;
    }

    connectMutation.mutate(formData, {
      onSuccess: () => {
        // Clear form on success
        setFormData({ accountId: "", apiKey: "", secretKey: "" });
        SmartToast.success("Kodiak account connected successfully! Your user level has been upgraded.");
      },
      onError: (error: any) => {
        SmartToast.error(error?.response?.data?.error || "Failed to connect Kodiak credentials");
      },
    });
  };

  const handleDisconnect = () => {
    if (confirm("Are you sure you want to disconnect your Kodiak credentials? This will downgrade your user level.")) {
      disconnectMutation.mutate(undefined, {
        onSuccess: () => {
          SmartToast.success("Kodiak account disconnected successfully.");
        },
        onError: (error: any) => {
          SmartToast.error(error?.response?.data?.error || "Failed to disconnect Kodiak account");
        },
      });
    }
  };

  return (
    <Container
        size={{
          default: 'lg',
          xl: 'xl',
          '2xl': '2xl',
          '3xl': '3xl',
          '4xl': '4xl'
        }}
        className="py-2 space-y-4"
      >
        {/* Account Overview */}
        <Card>
          <SectionHeader title="Account Overview" />
          <Grid cols={{ default: 1, md: 3 }} gap={4}>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-white/5">
              <MetricIcon icon={Shield} color="primary" />
              <div>
                <p className="text-sm text-textMuted">User Level</p>
                <p className="font-medium text-text">
                  {user?.userLevel || "BASIC"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-white/5">
              <MetricIcon icon={CheckCircle} color="success" />
              <div>
                <p className="text-sm text-textMuted">Account Status</p>
                <p className="font-medium text-text">Active</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-white/5">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isConnected ? "bg-success/10" : "bg-warning/10"
                }`}
              >
                {statusLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-warning" />
                ) : isConnected ? (
                  <CheckCircle className="w-4 h-4 text-success" />
                ) : (
                  <XCircle className="w-4 h-4 text-warning" />
                )}
              </div>
              <div>
                <p className="text-sm text-textMuted">Kodiak Status</p>
                <p className="font-medium text-text">
                  {statusLoading
                    ? "Loading..."
                    : isConnected
                      ? "Connected"
                      : "Not Connected"}
                </p>
              </div>
            </div>
          </Grid>
          </Card>

        {/* Kodiak Credentials Section */}
        <Card>
            <SectionHeader
              title="Kodiak Trading Credentials"
              subtitle="Connect your Kodiak account to enable automated trading strategies"
              actions={<MetricIcon icon={Key} color="primary" />}
            />

            {isConnected ? (
              /* Connected State */
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
                  <CheckCircle className="w-4 h-4 text-success" />
                  <div className="flex-1">
                    <p className="font-medium text-success">
                      Kodiak Account Connected
                    </p>
                    <p className="text-sm text-textMuted">
                      Account ID: {kodiakData?.accountId}
                    </p>
                    {kodiakData?.connectedAt && (
                      <p className="text-sm text-textMuted">
                        Connected: {new Date(kodiakData.connectedAt).toLocaleDateString()}
                      </p>
                    )}
                    {kodiakData?.verified && (
                      <p className="text-sm text-green-400">
                        ✓ Credentials verified and active
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnectMutation.isPending}
                    className="btn-danger flex items-center gap-2"
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    Disconnect
                  </button>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
                  <CheckCircle className="w-4 h-4 text-success" />
                  <p className="text-success font-medium">
                    Kodiak Credentials Verified
                  </p>
                </div>
              </div>
            ) : (
              /* Not Connected State - Show Form */
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
                  <AlertCircle className="w-4 h-4 text-warning" />
                  <p className="text-warning font-medium">
                    No Credentials Provided
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-text mb-2">
                        Account ID
                      </label>
                      <input
                        type="text"
                        value={formData.accountId}
                        onChange={e =>
                          setFormData(prev => ({
                            ...prev,
                            accountId: e.target.value,
                          }))
                        }
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
                          onChange={e =>
                            setFormData(prev => ({
                              ...prev,
                              apiKey: e.target.value,
                            }))
                          }
                          className="input w-full pr-10"
                          placeholder="Your Kodiak API Key"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecrets(!showSecrets)}
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
                          onChange={e =>
                            setFormData(prev => ({
                              ...prev,
                              secretKey: e.target.value,
                            }))
                          }
                          className="input w-full pr-10"
                          placeholder="Your Kodiak Secret Key"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecrets(!showSecrets)}
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
                        Your API credentials are encrypted using AES-256 encryption before storage.
                        Credentials are only decrypted in memory when needed for API calls.
                      </p>
                    </div>
                  </div>

                  {connectMutation.isError && (
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
                      disabled={
                        connectMutation.isPending ||
                        !formData.accountId ||
                        !formData.apiKey ||
                        !formData.secretKey
                      }
                      className="btn-primary flex items-center gap-2"
                    >
                      {connectMutation.isPending ? (
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

          {/* Security Notice */}
          <Card>
            <SectionHeader
              title="Security Information"
              actions={<MetricIcon icon={Shield} color="warning" />}
            />
            <div className="space-y-3 text-sm text-textMuted">
              <p>
                • Your Kodiak API credentials are encrypted using AES-256
                encryption before storage
              </p>
              <p>
                • Credentials are only decrypted in memory when needed for API
                calls
              </p>
              <p>
                • All credential operations are logged for security auditing
              </p>
              <p>• You can disconnect your credentials at any time</p>
            </div>
          </Card>
      </Container>
  );
};

export default Settings;
