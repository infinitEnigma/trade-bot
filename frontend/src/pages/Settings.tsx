/** @format */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
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
import { Card } from "../components/ui/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
import { MetricIcon } from "../components/ui/MetricIcon";
import { AppHeader } from "../components/ui/AppHeader";

const Settings: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [showSecrets, setShowSecrets] = useState(false);
  const [formData, setFormData] = useState({
    accountId: "",
    apiKey: "",
    secretKey: "",
  });

  // Fetch Kodiak status
  const { data: kodiakStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["kodiak-status"],
    queryFn: () => api.getKodiakStatus(),
  });

  // Connect Kodiak mutation
  const connectMutation = useMutation({
    mutationFn: (data: typeof formData) => api.connectKodiak(data),
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ["kodiak-status"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      // Refresh user data to update user level
      await refreshUser();
      // Only clear form if verification was successful
      if (response.data?.verified) {
        setFormData({ accountId: "", apiKey: "", secretKey: "" });
      }
    },
  });

  // Disconnect Kodiak mutation
  const disconnectMutation = useMutation({
    mutationFn: () => api.disconnectKodiak(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kodiak-status"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.accountId || !formData.apiKey || !formData.secretKey) {
      return;
    }
    connectMutation.mutate(formData);
  };

  const handleDisconnect = () => {
    if (
      confirm("Are you sure you want to disconnect your Kodiak credentials?")
    ) {
      disconnectMutation.mutate();
    }
  };

  const isConnected = kodiakStatus?.data?.connected;

  return (
    <div className="container mx-auto px-4 py-10 space-y-10 bg-background">
      <AppHeader title="Settings" subtitle="Manage your account" />

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Account Overview */}
          <Card>
            <SectionHeader title="Account Overview" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isConnected ? "bg-success/10" : "bg-warning/10"
                  }`}
                >
                  {statusLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-warning" />
                  ) : isConnected ? (
                    <CheckCircle className="w-5 h-5 text-success" />
                  ) : (
                    <XCircle className="w-5 h-5 text-warning" />
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
            </div>
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
                  <CheckCircle className="w-5 h-5 text-success" />
                  <div className="flex-1">
                    <p className="font-medium text-success">
                      Kodiak Account Connected
                    </p>
                    <p className="text-sm text-textMuted">
                      Account ID: {kodiakStatus?.data?.accountId}
                    </p>
                    {kodiakStatus?.data?.connectedAt && (
                      <p className="text-sm text-textMuted">
                        Connected:{" "}
                        {new Date(
                          kodiakStatus.data.connectedAt
                        ).toLocaleDateString()}
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
                  <CheckCircle className="w-5 h-5 text-success" />
                  <p className="text-success font-medium">
                    Kodiak Credentials Provided
                  </p>
                </div>
              </div>
            ) : (
              /* Not Connected State - Show Status and Form */
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
                  <AlertCircle className="w-5 h-5 text-warning" />
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
                        onChange={(e) =>
                          setFormData((prev) => ({
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
                          onChange={(e) =>
                            setFormData((prev) => ({
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
                          onChange={(e) =>
                            setFormData((prev) => ({
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
                    <AlertCircle className="w-5 h-5 text-info shrink-0" />
                    <div className="text-sm">
                      <p className="text-info font-medium">Security Notice</p>
                      <p className="text-textMuted mt-1">
                        Your API credentials are encrypted and stored securely.
                        We never display your secret key after connection.
                      </p>
                    </div>
                  </div>

                  {connectMutation.isError && (
                    <div className="flex items-center gap-2 p-4 rounded-lg bg-danger/10 border border-danger/20">
                      <XCircle className="w-5 h-5 text-danger" />
                      <p className="text-danger text-sm">
                        Failed to connect Kodiak credentials. Please check your
                        credentials and try again.
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
        </div>
      </div>
    </div>
  );
};

export default Settings;
