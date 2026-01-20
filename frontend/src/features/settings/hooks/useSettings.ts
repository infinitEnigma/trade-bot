/** @format */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth";
import { settingsService } from "../services/settingsService";
import { KodiakCredentials, KodiakStatus } from "../types/settings.types";

/**
 * useSettings hook - manages Kodiak account settings and connection
 */
export const useSettings = () => {
    const { user, refreshUser } = useAuth();
    const queryClient = useQueryClient();
    const [showSecrets, setShowSecrets] = useState(false);

    // Form state for credentials
    const [formData, setFormData] = useState<KodiakCredentials>({
        accountId: "",
        apiKey: "",
        secretKey: "",
    });

    // Fetch Kodiak status
    const {
        data: kodiakStatus = { connected: false },
        isLoading: statusLoading,
        refetch: refetchStatus,
    } = useQuery({
        queryKey: ["kodiak-status"],
        queryFn: () => settingsService.getKodiakStatus(),
        staleTime: 30000, // 30 seconds
        gcTime: 300000, // 5 minutes
    });

    // Connect Kodiak mutation
    const connectMutation = useMutation({
        mutationFn: (credentials: KodiakCredentials) => settingsService.connectKodiak(credentials),
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
        mutationFn: () => settingsService.disconnectKodiak(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["kodiak-status"] });
            queryClient.invalidateQueries({ queryKey: ["profile"] });
            refetchStatus();
        },
    });

    // Helper functions
    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.accountId || !formData.apiKey || !formData.secretKey) {
            return;
        }

        // Validate credentials format
        const validation = settingsService.validateCredentials(formData);
        if (!validation.isValid) {
            // Handle validation errors (could use toast or state)
            console.error("Validation errors:", validation.errors);
            return;
        }

        connectMutation.mutate(formData);
    };

    const handleDisconnect = () => {
        if (confirm("Are you sure you want to disconnect your Kodiak credentials?")) {
            disconnectMutation.mutate();
        }
    };

    const updateFormField = (field: keyof KodiakCredentials, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // Account overview data
    const accountOverview = {
        userLevel: user?.userLevel || "BASIC",
        accountStatus: "Active",
        kodiakConnected: kodiakStatus.connected,
        lastSync: kodiakStatus.connectedAt,
    };

    return {
        // State
        kodiakStatus,
        accountOverview,
        formData,
        showSecrets,

        // Loading states
        statusLoading,
        isConnecting: connectMutation.isPending,
        isDisconnecting: disconnectMutation.isPending,

        // Errors
        connectError: connectMutation.error?.message,
        disconnectError: disconnectMutation.error?.message,

        // Actions
        handleConnect,
        handleDisconnect,
        updateFormField,
        setShowSecrets,
        refetchStatus,

        // Validation
        validateCredentials: settingsService.validateCredentials,

        // Security info
        securityInfo: settingsService.getSecurityInfo(),
    };
};
