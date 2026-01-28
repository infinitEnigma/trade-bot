/** @format */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "../../../infrastructure/api/auth";
import { kodiakApi } from "../../../infrastructure/api/kodiak";
import { useAuth, updateAuthUser } from "./useAuth";
import { UserLevel } from "../../../shared/types";

interface ApiError extends Error {
    response?: {
        status?: number;
    };
}

/**
 * React Query hook for user data with caching and deduplication
 * This replaces direct API calls in components
 */
export const useUser = () => {
    const { user: authUser } = useAuth();

    return useQuery({
        queryKey: ["user", authUser?.id],
        queryFn: () => authApi.getMe(),
        enabled: !!authUser?.id, // Only fetch if we have a user ID
        staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh
        gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache
        refetchOnWindowFocus: false, // Don't refetch on window focus
        refetchOnReconnect: false, // Don't refetch on reconnect
        retry: (failureCount, error: Error) => {
            // Don't retry on 401/403 (auth errors)
            const apiError = error as ApiError;
            if (apiError?.response?.status === 401 || apiError?.response?.status === 403) {
                return false;
            }
            // Retry up to 2 times for other errors
            return failureCount < 2;
        },
    });
};

/**
 * Hook for Kodiak status with React Query caching
 * Only fetches for users who have Kodiak access (REGISTERED/VERIFIED)
 */
export const useKodiakStatus = () => {
    const { user } = useAuth();

    // Follow existing pattern: only fetch for users who have Kodiak access
    const hasKodiakAccess = user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED";

    return useQuery({
        queryKey: ["kodiak-status", user?.id],
        queryFn: () => kodiakApi.getKodiakStatus(),
        enabled: !!user?.id && hasKodiakAccess, // Skip for BASIC users
        staleTime: 2 * 60 * 1000, // 2 minutes - Kodiak status changes less frequently
        gcTime: 5 * 60 * 1000, // 5 minutes cache
        refetchInterval: 60 * 1000, // refetch every 60 seconds
        refetchIntervalInBackground: false, // Don't refetch when tab is not active
        refetchOnWindowFocus: false,
        retry: (failureCount, error: Error) => {
            // Don't retry auth errors
            const apiError = error as ApiError;
            if (apiError?.response?.status === 401 || apiError?.response?.status === 403 || apiError?.response?.status === 429) {
                return false;
            }
            return failureCount < 1; // Only retry once for Kodiak status
        },
    });
};

/**
 * Mutation hook for Kodiak connection
 */
export const useConnectKodiak = () => {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: (credentials: { accountId: string; apiKey: string; secretKey: string }) =>
            kodiakApi.connectKodiak(credentials),
        onSuccess: (response) => {
            // Invalidate React Query caches with correct query keys (including user ID)
            queryClient.invalidateQueries({ queryKey: ["user", user?.id] });
            queryClient.invalidateQueries({ queryKey: ["kodiak-status", user?.id] });

            // Directly update the Zustand store with new user level (immediate UI update)
            if (response.data?.userLevel) {
                updateAuthUser({ userLevel: response.data.userLevel as UserLevel });
            }
        },
    });
};

/**
 * Mutation hook for Kodiak disconnection
 */
export const useDisconnectKodiak = () => {
    const queryClient = useQueryClient();
    const { user, refreshUser } = useAuth();

    return useMutation({
        mutationFn: () => kodiakApi.disconnectKodiak(),
        onSuccess: () => {
            // Invalidate React Query caches with correct query keys (including user ID)
            queryClient.invalidateQueries({ queryKey: ["user", user?.id] });
            queryClient.invalidateQueries({ queryKey: ["kodiak-status", user?.id] });

            // Also refresh the Zustand auth store to update user level
            refreshUser();
        },
    });
};
